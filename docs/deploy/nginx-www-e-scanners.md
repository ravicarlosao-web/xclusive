# Nginx: www → xclusive.ao (301) e 404 para rotas de scanners

Duas melhorias pequenas, **só de configuração do Nginx** (sem código da aplicação, base de dados nem admin). Os exemplos versionados:

| Ficheiro | Para onde vai na VPS | Contexto |
|---|---|---|
| `docs/deploy/nginx-www-redirect.exemplo.conf` | `/etc/nginx/conf.d/xclusive-www.conf` | `http` (fora de qualquer `server { }`) |
| `docs/deploy/nginx-scanners.exemplo.conf` | `/etc/nginx/snippets/xclusive-scanners.conf` | incluído **dentro** do `server { }` HTTPS do site |

O ficheiro completo do site (`server { listen 443 ssl; … }`) **não está no repositório**: só vive na VPS (`/etc/nginx/sites-enabled/xclusive`). Por isso o «diff» abaixo diz exatamente o que acrescentar/retirar, mas o contexto (certificados, `listen`) tem de ser confirmado por quem aplica.

## 0. Confirmar na VPS (antes de mexer em nada; só leitura)

1. **O certificado cobre www.xclusive.ao?** O repositório não o diz (não tem os certificados nem o `server { }` real). O facto de https://www.xclusive.ao/ responder sem erro sugere que sim, mas confirma:
   ```bash
   nginx -T 2>/dev/null | grep -nE "server_name|listen|ssl_certificate"                      # blocos, nomes e caminho do certificado
   openssl x509 -in <o caminho do ssl_certificate> -noout -subject -ext subjectAltName       # tem de listar DNS:www.xclusive.ao
   curl -sSI https://www.xclusive.ao/ | head -1                                              # sem -k: «HTTP/… 200» sem erro de certificado
   ```
   Se o certificado **não** listar www.xclusive.ao: expandi-lo antes (por exemplo `certbot certonly … -d xclusive.ao -d www.xclusive.ao`, ou o método que usarem) — sem isso, quem abrir https://www… veria um erro de certificado em vez do redirecionamento.
2. **Que blocos mencionam www?** Na saída de `nginx -T`, procura `www.xclusive.ao` em `server_name`. Há três casos:
   - o `server_name` do bloco HTTPS e/ou do HTTP **lista** `www.xclusive.ao` → tirá-lo de lá (passo 3);
   - o bloco HTTPS é `default_server` e não lista www → o novo bloco `www` ganha por ter `server_name` explícito (não precisa de edição);
   - o novo ficheiro em `conf.d` é lido **antes** dos `sites-enabled` (é o normal, por `include /etc/nginx/conf.d/*.conf;` vir primeiro) → mesmo com www ainda listado, o Nginx só avisa «conflicting server name … ignored» e o bloco novo ganha; mas **se o bloco principal for lido primeiro, ganha ele e o redirecionamento não funciona** (testado). Por isso o passo 3 manda tirar www do `server_name`, em vez de depender da ordem.

## 1. Cópia de segurança (obrigatória)

```bash
cp -a /etc/nginx /root/nginx-backup-$(date +%F-%H%M)
ls /root/nginx-backup-*          # confirma que existe
```

## 2. Ficheiros novos

```bash
# a) www → apex (substituir os marcadores pelo certificado e chave do bloco principal; copiar para aí as outras diretivas TLS do bloco principal)
sed -e 's#__SSL_CERTIFICADO__#<ssl_certificate do bloco principal>#' \
    -e 's#__SSL_CHAVE__#<ssl_certificate_key do bloco principal>#' \
    docs/deploy/nginx-www-redirect.exemplo.conf > /etc/nginx/conf.d/xclusive-www.conf
# b) scanners → 404
cp docs/deploy/nginx-scanners.exemplo.conf /etc/nginx/snippets/xclusive-scanners.conf
```
No `xclusive-www.conf`, o bloco HTTPS tem de ter as **mesmas** diretivas TLS do bloco principal (protocolos, cifras, `include …/options-ssl-nginx.conf;`, `ssl_dhparam …;`, etc.) e o `listen` com as mesmas opções (por exemplo `http2`) se o principal as usar.

## 3. O diff a aplicar no ficheiro do site (`/etc/nginx/sites-enabled/xclusive`)

O único contexto que o repositório não conhece é o conteúdo atual do ficheiro; as linhas a acrescentar/retirar são estas:

```diff
 server {                                   # bloco HTTPS do site principal
     listen 443 ssl;
-    server_name xclusive.ao www.xclusive.ao;      # SÓ se www aparecer aqui (ver o passo 0.2)
+    server_name xclusive.ao;
     ssl_certificate …;                     # (não mexer)
     …
+    include /etc/nginx/snippets/xclusive-scanners.conf;     # acrescentar em qualquer ponto do bloco (a ordem das locations não importa para isto)
     …
 }

 server {                                   # bloco HTTP do site principal (o que faz 301 http://xclusive.ao → https://xclusive.ao)
     listen 80;
-    server_name xclusive.ao www.xclusive.ao;      # SÓ se www aparecer aqui
+    server_name xclusive.ao;
     return 301 https://$host$request_uri;          # (não mexer: http://xclusive.ao/ continua a fazer 301 para https://xclusive.ao/)
 }
```
Não se mexe em limites de pedidos, cabeçalhos de segurança, `proxy_*`, `location ^~ /api/`, `location ^~ /assets/` nem no admin.

## 4. Testar e recarregar (nunca `restart`)

```bash
nginx -t                       # TEM de dizer «syntax is ok» e «test is successful»; se falhar, NÃO recarregar: ver o passo 6
systemctl reload nginx         # só depois do nginx -t; nunca `systemctl restart nginx`
```
Um aviso `conflicting server name "www.xclusive.ao" … ignored` significa que ainda há www num `server_name` do site principal (passo 3).

## 5. Verificar (resultados esperados)

```bash
# www → apex, em HTTPS e em HTTP, com o mesmo caminho e query
curl -sI "https://www.xclusive.ao/termos?x=1&y=2" | grep -iE '^(HTTP|location)'     # HTTP/… 301 · Location: https://xclusive.ao/termos?x=1&y=2
curl -sI "http://www.xclusive.ao/perfil/ana"      | grep -iE '^(HTTP|location)'     # HTTP/… 301 · Location: https://xclusive.ao/perfil/ana   (direto, sem passar por https://www)
curl -sI "https://www.xclusive.ao/"               | grep -iE '^(HTTP|location)'     # HTTP/… 301 · Location: https://xclusive.ao/
# o apex fica como estava
curl -sI "http://xclusive.ao/"                    | grep -iE '^(HTTP|location)'     # HTTP/… 301 · Location: https://xclusive.ao/
# scanners → 404 (antes: 200 com a página da app)
for p in /.env /wp-config.php /.aws/config /.npmrc /yarn.lock /package.json /composer.json /x.php /wp-login.php /backup.bak /site.old /index.html~; do
  printf '%-18s ' $p; curl -s -o /dev/null -w '%{http_code}\n' "https://xclusive.ao$p"; done                   # todos 404
# o resto não muda
for p in / /login /termos /privacidade /perfil/ana /rota-que-nao-existe; do printf '%-22s ' $p; curl -s -o /dev/null -w '%{http_code}\n' "https://xclusive.ao$p"; done   # todos 200 (fallback do SPA, como antes)
curl -sI https://xclusive.ao/robots.txt | grep -iE '^(HTTP|content-type)'           # 200 · text/plain
curl -sI https://xclusive.ao/sitemap.xml | grep -iE '^(HTTP|content-type)'          # 200 · …xml
curl -sI https://xclusive.ao/googleb842e010fcd2614c.html | head -1                  # 200
A=$(curl -s https://xclusive.ao/ | grep -oE '/assets/[^"]+\.js' | head -1); curl -sI "https://xclusive.ao$A" | head -1     # 200 (um ficheiro real de /assets/)
curl -s -o /dev/null -w '%{http_code}\n' https://xclusive.ao/assets/nao-existe.js   # 404 (como antes)
curl -s https://xclusive.ao/api/auth/legal-config | head -c 100; echo               # JSON (200), como hoje
curl -s -o /dev/null -w '%{http_code}\n' https://xclusive.ao/api/auth/me            # 401 (sem sessão), como hoje
curl -s -o /dev/null -w '%{http_code}\n' https://xclusive.ao/.well-known/acme-challenge/x   # igual ao que dava antes (o /.well-known/ não é tocado)
```
O admin (caminho secreto) não tem teste público de propósito: abre-o no browser com a sessão do costume; não deve mudar nada.

## 6. Reverter (se algo correr mal)

```bash
# 1) tirar as alterações
rm -f /etc/nginx/conf.d/xclusive-www.conf /etc/nginx/snippets/xclusive-scanners.conf
#    e no ficheiro do site: apagar a linha `include /etc/nginx/snippets/xclusive-scanners.conf;` e repor o `server_name` anterior (com www, se o tinha)
#    OU restaurar a cópia do passo 1:  cp -a /root/nginx-backup-<data>/. /etc/nginx/
nginx -t && systemctl reload nginx
# 2) confirmar: https://www.xclusive.ao/ volta a responder como antes
```
Se o `nginx -t` falhar a meio da reversão, restaura a cópia do passo 1 inteira e volta a correr `nginx -t` antes de recarregar.

## Notas

- **O que ganham as rotas de scanners:** `404` simples do Nginx (sem a página da app). Cobre: ficheiros e pastas «escondidos» (`/.env`, `/.git/…`, `/.aws/config`, `/.npmrc`, …) **exceto `/.well-known/`**; `*.php` e `/wp-*`; cópias de segurança (`.bak`, `.old`, `.save`, `.orig`, `.swp`, `~` no fim); `yarn.lock`, `package.json`, `composer.json`.
- **Porque é que não afeta o resto (precedência das locations):** as locations exatas (`= /sw.js`, `= /admin`, …) ganham sempre; um prefixo `^~` (`/assets/`, o caminho secreto do admin, `/api/`) impede a avaliação de expressões regulares; as regras novas só casam com caminhos que a app nunca serve; os nomes de utilizador só têm letras, números e «_», por isso `/perfil/<utilizador>` nunca casa. Se a vossa `location /api/` **não** for `^~`, as regras só poderiam apanhar um pedido de API com ponto-seguido-de-nome-escondido, `.php` ou `~`, que a API não usa.
- **Certificados e renovação:** se a renovação for por HTTP (`/.well-known/acme-challenge/`) e incluir o nome www, o bloco HTTP de www faz 301 também para esse caminho (o validador segue o redirecionamento para https://xclusive.ao/.well-known/…). Se a renovação passar a falhar para o nome www, acrescentar ao bloco HTTP do `xclusive-www.conf` uma `location ^~ /.well-known/acme-challenge/ { root <webroot>; }` antes do `return`.
- **SEO:** o 301 de www para o apex junta tudo no mesmo endereço (https://xclusive.ao/, que é o canónico). No Search Console, usa uma propriedade de **domínio** (cobre www e apex) ou acrescenta as duas.
- **Testes:** `nginx-www-scanners` (suite do repositório de testes) corre um Nginx real local com estes dois exemplos **junto** com os de PWA e admin e confirma tudo o que está acima (incluindo o conflito de `server_name` e a armadilha da ordem de leitura). Nada disto foi aplicado em produção.
