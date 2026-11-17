# Limite de pedidos a /api/admin/* no Nginx — guia (VPS de produção)

Segunda camada de proteção do painel: além do bloqueio de contas e de IPs que a aplicação já faz, o Nginx limita a taxa de pedidos **por IP** a `/api/admin/*` (e, mais
apertado, ao login do painel). Não muda código da aplicação nem o painel; não escreve o caminho secreto do painel (a API do admin não está debaixo dele).

## 1. Cópia de segurança (antes de mexer em nada)
```bash
sudo cp -a /etc/nginx/sites-enabled/xclusive /root/nginx-xclusive.antes-dos-limites.$(date +%F-%H%M)
sudo nginx -T > /root/nginx-completo.antes-dos-limites.$(date +%F-%H%M).txt 2>&1     # configuração completa (para comparar)
```

## 2. Zonas, chaves e estado 429 (contexto `http`)
```bash
sudo cp docs/deploy/nginx-limites-admin.exemplo.conf /etc/nginx/conf.d/xclusive-limites.conf
```
(o ficheiro está comentado com a justificação dos números: geral 20 pedidos/s com burst 40; login 10 pedidos/minuto com burst 5; 429 e aviso no `error.log`).

## 3. Ligar ao `location /api/` que já existe (SÓ estas 2 linhas; não criar outro `location`, não tocar no `proxy_pass`, nos `proxy_set_header` nem nos tempos limite)
Em `/etc/nginx/sites-enabled/xclusive`, dentro do `location /api/ { … }` existente, no fim do bloco:
```nginx
    limit_req zone=xcl_admin_geral burst=40 nodelay;
    limit_req zone=xcl_admin_login burst=5  nodelay;
```
O resto de `/api/` não é afetado: nas duas zonas a chave é vazia para qualquer pedido que não comece por `/api/admin/`, e o Nginx **não limita pedidos com chave vazia**.

## 4. Testar e recarregar
```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 5. Confirmar que o Nginx vê o IP real do cliente (importante: a chave é `$binary_remote_addr`)
Se houver outro proxy à frente (por exemplo uma CDN), o Nginx veria o IP DELE e todos os administradores partilhariam o mesmo saldo (e o IP do bloqueio da aplicação também seria errado).
1. Num `server { }` de teste (ou temporariamente no do site) acrescenta, e recarrega:
   ```nginx
   location = /__meu-ip { default_type text/plain; return 200 "$remote_addr\n"; }
   ```
2. Do teu computador/telemóvel (fora da VPS): `curl -s https://xclusive.ao/__meu-ip` e compara com o teu IP público (`curl -4 -s ifconfig.me`). **Têm de ser iguais.**
3. Confirma no acesso: `sudo tail -n 5 /var/log/nginx/access.log` — o 1.º campo é o `$remote_addr`.
4. Se for o IP de uma CDN/proxy (e não o teu), NÃO uses estes limites tal como estão: diz-me e acrescentamos `set_real_ip_from <rede do proxy>; real_ip_header <cabeçalho>;` (só com a lista oficial de redes do proxy).
5. **Apaga o `location = /__meu-ip`** e recarrega.

## 6. Validar (sem credenciais; funciona sem sessão: o limite corta antes da aplicação)
```bash
# geral: 120 pedidos rápidos ao admin → os primeiros ~41 chegam à aplicação (401) e o resto leva 429
for i in $(seq 1 120); do curl -s -o /dev/null -w "%{http_code}\n" https://xclusive.ao/api/admin/dashboard/kpis; done | sort | uniq -c
# login: as primeiras 6 chegam à aplicação (401), as seguintes levam 429
for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code}\n" -X POST -H 'Content-Type: application/json' -d '{"email":"x@y.z","password":"x"}' https://xclusive.ao/api/admin/auth/login; done | sort | uniq -c
# o resto da API e o site NÃO são limitados: 200 respostas, nenhum 429
for i in $(seq 1 200); do curl -s -o /dev/null -w "%{http_code}\n" https://xclusive.ao/api/auth/legal-config; done | sort | uniq -c
# no servidor:
sudo grep -c 'limiting requests' /var/log/nginx/error.log
```
(esperas a 429 passar sozinha em segundos: o geral recupera 20 pedidos/s; o login 1 tentativa a cada 6 s.)

## 7. O que acontece a quem é limitado
- O Nginx responde 429 e **a aplicação nem vê o pedido**: não conta como falha de login, não bloqueia a conta nem o IP, não gera registo de auditoria. É só esperar uns segundos e repetir.
- O painel de admin não parte (testado com o Nginx real, suite `nginx-limites`): as páginas de dados (ex.: Utilizadores) repetem sozinhas o pedido e carregam logo que o saldo reabastece (segundos); Carregamentos e o dashboard voltam a atualizar sozinhos; o **login** mostra o aviso «Erro de Autenticação — HTTP 429» com o formulário utilizável (basta esperar uns segundos e voltar a carregar em Entrar).
  O texto «HTTP 429» é o do painel actual (não se mexeu no painel); se quiseres uma mensagem em português, é uma alteração à parte no painel ou um `error_page 429` com corpo JSON no site.

## 8. Ajustar (se der falsos 429 ao uso normal)
Vê `sudo grep 'limiting requests' /var/log/nginx/error.log | tail` (o IP e o pedido aparecem). Sobe `rate=` na zona e o `burst=` na linha `limit_req` (ficheiro do passo 2 e passo 3), `nginx -t && systemctl reload nginx`.

## 9. Reverter em 30 segundos
```bash
sudo cp -a /root/nginx-xclusive.antes-dos-limites.<data> /etc/nginx/sites-enabled/xclusive   # volta o site como estava
sudo rm /etc/nginx/conf.d/xclusive-limites.conf
sudo nginx -t && sudo systemctl reload nginx
```
(Alternativa mais rápida: comentar as 2 linhas `limit_req` no site e recarregar; os limites deixam de se aplicar.)

## 10. Verificação em dois passos (A4a/A4b): o 2.º passo do login passa para a zona do login — NADA APLICADO, UM SÓ COMANDO
O 2.º passo do login (TOTP) é `POST /api/admin/auth/login/totp`. O mapa `xcl_admin_login_chave` só apanhava `/api/admin/auth/login` (a regra acabava em `(\?|$)`), por isso o 2.º passo ficava só na zona geral
(20 pedidos/s) e não na do login (10/min). O exemplo `docs/deploy/nginx-limites-admin.exemplo.conf` já traz a regra nova: `~*^/api/admin/auth/login(/totp)?(\?|$)`.
No servidor, o ficheiro instalado é `/etc/nginx/conf.d/xclusive-limites.conf`. **UM comando** (copia de segurança com data → troca a regra → confirma que a troca ficou → `nginx -t` → recarrega SÓ se o teste passar; se algo falhar, não recarrega e repõe a cópia automaticamente):
```bash
F=/etc/nginx/conf.d/xclusive-limites.conf; B=/root/xclusive-limites.antes-do-totp.$(date +%F-%H%M).conf; sudo cp -a "$F" "$B" && sudo perl -0pi -e 's#auth/login\(\\\?\|\$\)#auth/login(/totp)?(\\?|\$)#' "$F" && sudo grep -q 'auth/login(/totp)?' "$F" && sudo nginx -t && sudo systemctl reload nginx && echo "OK: login/totp na zona do login (cópia em $B)" || { echo "FALHOU: nada foi recarregado; a repor a cópia"; sudo cp -a "$B" "$F"; }
```
É seguro repetir (se a regra já estiver trocada, nada muda). Teste (sem credenciais): 12 pedidos seguidos a `POST /api/admin/auth/login/totp` com corpo `{}` → os primeiros ~6 chegam à aplicação (401) e os seguintes levam 429 do Nginx:
```bash
for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code}\n" -X POST -H 'Content-Type: application/json' -d '{}' https://xclusive.ao/api/admin/auth/login/totp; done | sort | uniq -c
```
(Os restantes caminhos de TOTP — `/api/admin/totp/*` e `/api/admin/administradores/:id/totp/repor` — estão debaixo de `/api/admin/` e ficam na zona geral.)

## 11. Reverter a troca da secção 10 (só se for preciso)
```bash
F=/etc/nginx/conf.d/xclusive-limites.conf; sudo cp -a "$(ls -t /root/xclusive-limites.antes-do-totp.*.conf | head -1)" "$F" && sudo nginx -t && sudo systemctl reload nginx
```
(repõe a cópia mais recente feita pelo comando da secção 10).
