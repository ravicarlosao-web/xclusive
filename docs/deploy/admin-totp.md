# Verificação em dois passos (TOTP) dos admins — A4a (só servidor)

> # ⚠️ ESTADO DO MODO OBRIGATÓRIO
> A interface do painel (A4b, página «Segurança» e passo do código no login) já existe, mas a chave `admin_totp_obrigatorio` (tabela `platform_settings`) **continua DESLIGADA por defeito** (ausente = desligado).
> **Só se liga depois de TODOS os admins terem TOTP** (ver «Ligar o modo obrigatório» abaixo): ligado, quem não tiver TOTP fica preso na página de ativação e não faz mais nada. **Não há interruptor no painel: liga-se por SQL.**

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
8. **Modo obrigatório**: fica desligado; só se liga seguindo a secção «Ligar o modo obrigatório».

## Ligar o modo obrigatório (só quando todos os admins já tiverem TOTP)
1. **Consulta prévia — admins sem TOTP ativo** (a lista TEM de ficar vazia, ou aceitar conscientemente que essas contas só poderão ativar):
   ```sql
   select u.id, u.username, u.email, u.role
   from users u
   left join admin_totp t on t.user_id = u.id and t.ativado_em is not null
   where u.role in ('admin','superadmin') and u.ativo and t.id is null
   order by u.id;
   ```
   Cada um destes admins ativa em «Segurança» (menu lateral ou menu da conta) com a aplicação de autenticação no telemóvel. Peça a todos para guardarem os códigos de recuperação.
2. **Teste de saída**: confirme que há pelo menos DOIS superadmins com TOTP e que sabe usar o script de reposição (abaixo).
3. **Ligar** (no `psql` da base de produção):
   ```sql
   insert into platform_settings (key, value) values ('admin_totp_obrigatorio', '{"value": true}')
   on conflict (key) do update set value = excluded.value, updated_at = now();
   ```
   Efeito imediato (sem reiniciar): quem tem TOTP não nota nada; quem não tem, no próximo pedido fica só com a página de ativação até concluir; ninguém consegue desativar o TOTP.
4. **Desligar em emergência** (por exemplo, se muitos admins ficarem presos):
   ```sql
   delete from platform_settings where key = 'admin_totp_obrigatorio';
   ```
   (Também desliga qualquer valor que não seja exatamente `{"value": true}`.) Efeito imediato.

## Quem perdeu o telemóvel
1. **Tem códigos de recuperação**: no login escolha «Usar um código de recuperação» e introduza um (cada um só funciona uma vez; o servidor avisa a conta por email). Depois, em «Segurança», gere códigos novos e **configure a aplicação de autenticação no telemóvel novo**: desative o TOTP (palavra-passe + código) e ative-o de novo, ou peça uma reposição.
2. **Não tem códigos nem telemóvel — é um admin normal**: um superadmin faz «Repor TOTP» na página «Administradores» (pede o código TOTP do próprio superadmin). O admin fica sem sessões, é avisado por email, entra só com a palavra-passe e ativa de novo.
3. **Não tem códigos nem telemóvel — é um superadmin** (ou não há outro superadmin): só pelo servidor, com o script `admin-totp-repor.mjs <utilizador>` (secção «Reposição de emergência»). Com o modo obrigatório ligado, a conta fica na página de ativação no login seguinte.
4. Depois de qualquer reposição, confirme a identidade da pessoa por outro canal antes de lhe entregar o acesso (a reposição por superadmin e por script ficam na auditoria).

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

## Guarda de migrações no `~/deploy.sh`
Para não repetir o #138 (código em produção antes da migração), o deploy passa a recusar quando há migrações por aplicar: ver `docs/deploy/guarda-migracoes.md` (tabela `schema_migracoes`, `scripts/verificar-migracoes.mjs`, exemplo `deploy.exemplo.sh` e o comando único para a instalar). A migração do TOTP (`add_admin_totp.sql`) é anterior à guarda e entra no baseline.
