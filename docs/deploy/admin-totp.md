# Verificação em dois passos (TOTP) dos admins — A4a (só servidor)

> # ⚠️ NÃO LIGAR O MODO OBRIGATÓRIO ANTES DO A4b
> A chave `admin_totp_obrigatorio` (tabela `platform_settings`) vem **DESLIGADA** (ausente = desligado). O painel **ainda não tem interface** de TOTP (isso é o A4b): com o modo ligado, um admin sem TOTP
> só consegue ativá-lo pela API, e **ficaria trancado fora do painel**. Não ligar, nem «para testar», até o A4b estar em produção.

## O que é
Contas `admin` e `superadmin` podem ter TOTP (RFC 6238: SHA-1, 6 dígitos, 30 s, janela ±1 passo; biblioteca `otpauth` 9.6.0). Sem interface no painel: tudo pela API (`/api/admin/totp/*`) e pelo script de emergência.
- Conta **sem** TOTP: entra como hoje (palavra-passe → sessão).
- Conta **com** TOTP: palavra-passe → **sem sessão**, só um pré-token (5 min, uso único, só serve no 2.º passo) → `POST /api/admin/auth/login/totp` com o código (ou um código de recuperação) → sessão com a marca «mfa». Uma sessão sem a marca é recusada em TODAS as rotas de admin.
- Segredos cifrados na BD (AES-256-GCM, IV aleatório, autenticado), chave só no `.env` do VPS. Códigos de recuperação (10 por conta): só o hash (bcrypt) fica guardado, uso único, mostrados uma só vez.
- Falhas de código contam para o bloqueio do login (A3: por conta e por IP, mesmos limiares da palavra-passe).

## Passos de deploy (por esta ordem)
1. **Ramo de segurança no Neon** (ponto de retorno): criar o ramo `pre-totp` a partir do principal, antes de mexer em nada.
2. **Aplicar a migração ANTES do deploy** (lição do #138: código novo sem as tabelas = erros):
   `psql "$DATABASE_URL" -f lib/db/src/migrations/add_admin_totp.sql` (idempotente; repetir não faz mal). Confirmar as 2 tabelas: `\d admin_totp`, `\d admin_totp_recuperacao`.
   Sem a migração o servidor continua a funcionar: as contas sem TOTP entram, as operações de TOTP respondem 503.
3. **Gerar a chave no VPS**, sem a mostrar no terminal partilhado nem no chat:
   ```bash
   umask 077
   printf 'ADMIN_TOTP_CHAVE=%s\n' "$(openssl rand -base64 32)" >> /caminho/da/api/.env   # NÃO executes `cat`/`echo` da chave
   chmod 600 /caminho/da/api/.env
   ```
   Guarda uma cópia da chave no teu gestor de segredos. **Se a chave se perder, os segredos TOTP existentes ficam ilegíveis** (a solução é repor o TOTP dessas contas, ver abaixo). Não a mudes depois de haver TOTP ativo.
4. `pm2 restart xclusive-api --update-env`
5. **Deploy** do código (como habitualmente).
6. **Verificações rápidas**
   - Nos registos de arranque: **não** deve aparecer o aviso «ADMIN_TOTP_CHAVE …» (`pm2 logs xclusive-api --lines 50 | grep ADMIN_TOTP`).
   - Login de admin sem TOTP continua a funcionar como antes (resposta com `token`).
   - `GET /api/admin/totp/estado` (com sessão) → `{"ativo":false,"pendente":false,"codigosRestantes":0,"obrigatorio":false,"disponivel":true}`.
   - Ativar numa conta de teste (`POST /api/admin/totp/iniciar` com a palavra-passe; ler o segredo/URI na aplicação de autenticação; `POST /api/admin/totp/confirmar` com o código; guardar os códigos de recuperação), terminar sessão e confirmar que o login pede o 2.º passo.
7. **Reverter**: (a) código: redeploy da versão anterior (as tabelas novas ficam, não atrapalham); (b) dados: `psql "$DATABASE_URL" -f lib/db/src/migrations-reversao/reverter_admin_totp.sql` (apaga as 2 tabelas; mostra antes quantas linhas tinham); (c) ou voltar ao ramo Neon `pre-totp`.
8. **Modo obrigatório: NÃO ligar antes do A4b** (ver o aviso no topo).

## Reposição de emergência
- **Um superadmin repõe outro admin** (nunca a si próprio; precisa do SEU código TOTP nesse momento): `POST /api/admin/administradores/:id/totp/repor` com `{"codigo":"123456"}`. Fica na auditoria, o admin afetado recebe um email e as sessões dele terminam.
- **O próprio superadmin (ou qualquer conta) sem acesso à aplicação de autenticação nem aos códigos de recuperação** — só pelo servidor:
  ```bash
  pnpm --filter @workspace/scripts exec tsx admin-totp-repor.mjs <utilizador>               # simulação
  pnpm --filter @workspace/scripts exec tsx admin-totp-repor.mjs <utilizador> --confirmar   # pede o nome do utilizador e repõe
  ```
  Remove o TOTP e os códigos, termina as sessões e regista `admin_totp_reposto_por_script`. A conta volta a entrar só com a palavra-passe até ativar de novo.

## Relógio do VPS (importante)
Os códigos dependem da hora: com o relógio do servidor desviado mais de ~30 s **os códigos certos falham**. Verifica: `timedatectl` (deve dizer `System clock synchronized: yes` e `NTP service: active`).
Se não: `sudo timedatectl set-ntp true`. Se os admins dizem que «o código está sempre errado», verifica primeiro o relógio (do servidor e do telemóvel).

## Nginx
O 2.º passo (`/api/admin/auth/login/totp`) não está na zona de limites do login: ver a secção 10 de `nginx-limites-admin.md` (uma linha a trocar no mapa; este PR não aplica nada).

## Auditoria e avisos
Ações no `audit_log` (sem segredos nem códigos): `admin_totp_ativacao_iniciada`, `admin_totp_ativado`, `admin_totp_desativado`, `admin_totp_login_ok`, `admin_totp_falhou`, `admin_totp_recuperacao_usada`, `admin_totp_codigos_regenerados`, `admin_totp_reposto_por_superadmin`, `admin_totp_reposto_por_script`.
Emails ao admin (máx. 5/hora por conta): TOTP ativado, desativado, reposto, código de recuperação usado. O alerta de login (A6) passa a dizer se o login foi concluído com TOTP (ou com código de recuperação).

## Proposta (não aplicada): guarda no `~/deploy.sh`
Para não repetir o #138, o `deploy.sh` podia recusar o deploy com migrações por aplicar. Ideia (não se edita o ficheiro neste PR):
```bash
# antes do pm2 restart: para cada ficheiro de lib/db/src/migrations/*.sql, o deploy exige a confirmação de que foi aplicado
for f in lib/db/src/migrations/*.sql; do grep -q "$(basename "$f")" ~/migracoes-aplicadas.txt || { echo "Migração por aplicar: $f"; exit 1; }; done
```
(com `~/migracoes-aplicadas.txt` a receber o nome do ficheiro depois de cada `psql -f` bem-sucedido).
