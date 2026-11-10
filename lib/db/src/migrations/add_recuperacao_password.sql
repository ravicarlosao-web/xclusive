-- ─────────────────────────────────────────────────────────────────────────────
-- Migration (ADITIVA): recuperação de palavra-passe
--
--   * users.password_alterada_em: quando a palavra-passe foi alterada pela última vez. Qualquer token (acesso ou refresh) emitido
--     nesse segundo ou antes deixa de valer. NULL = nunca alterada (nada muda para as contas existentes).
--   * email_tokens: tokens de uso único enviados por email. Guarda SÓ o hash SHA-256 (o token em claro só existe no email).
--     tipo = 'recuperar_password' | 'verificar_email' (este para a PR de verificação de email).
--
-- Não altera nem apaga dados existentes. Cada instrução corre SOZINHA (sem BEGIN/COMMIT).
-- A API nova só precisa destas duas alterações para a recuperação funcionar; o código antigo ignora-as.
-- ─────────────────────────────────────────────────────────────────────────────

-- Verificação 1 (ANTES, não há conflito): tudo a 0 / vazio.
SELECT count(*) AS coluna_ja_existe FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'password_alterada_em';
SELECT to_regclass('public.email_tokens') AS tabela_ja_existe;

-- Instrução 1 (aplicar sozinha):
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_alterada_em timestamp;

-- Instrução 2 (aplicar sozinha):
CREATE TABLE IF NOT EXISTS email_tokens (id serial PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE, tipo varchar(30) NOT NULL, token_hash varchar(64) NOT NULL, email varchar(255) NOT NULL, criado_em timestamp NOT NULL DEFAULT now(), expira_em timestamp NOT NULL, usado_em timestamp, ip varchar(45), CONSTRAINT email_tokens_tipo_chk CHECK (tipo IN ('recuperar_password', 'verificar_email')));

-- Instrução 3 (aplicar sozinha):
CREATE UNIQUE INDEX IF NOT EXISTS email_tokens_token_hash_uq ON email_tokens (token_hash);

-- Instrução 4 (aplicar sozinha):
CREATE INDEX IF NOT EXISTS email_tokens_user_tipo_idx ON email_tokens (user_id, tipo);

-- Instrução 5 (aplicar sozinha):
CREATE INDEX IF NOT EXISTS email_tokens_email_tipo_criado_idx ON email_tokens (email, tipo, criado_em);

-- Verificação 2 (DEPOIS): a coluna existe (1) e continua a NULL em todas as contas (a contagem de NÃO nulos tem de dar 0).
SELECT count(*) AS coluna_existe FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'password_alterada_em';
SELECT count(*) AS contas_com_password_alterada_em FROM users WHERE password_alterada_em IS NOT NULL;

-- Verificação 3 (DEPOIS): a tabela existe e está vazia; os 3 índices e a restrição existem (esperado: 0, 4 e 1).
SELECT count(*) AS tokens FROM email_tokens;
SELECT count(*) AS indices FROM pg_indexes WHERE tablename = 'email_tokens' AND indexname IN ('email_tokens_pkey', 'email_tokens_token_hash_uq', 'email_tokens_user_tipo_idx', 'email_tokens_email_tipo_criado_idx');
SELECT count(*) AS restricao_tipo FROM pg_constraint WHERE conname = 'email_tokens_tipo_chk';
