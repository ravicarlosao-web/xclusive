-- ─────────────────────────────────────────────────────────────────────────────
-- Migration (ADITIVA): proteção do login de admin + sessões de admin com expiração por inatividade
--
--   * admin_login_controlo: contadores de falhas e bloqueios temporários por conta (chave = SHA-256 do email) e por IP.
--     Substitui o limitador em memória (que se perdia a cada reinício do pm2).
--   * admin_sessoes: uma linha por login de admin (jti, último uso, expiração absoluta) para a expiração por inatividade.
--
-- Não altera nem apaga dados existentes; não mexe em tabelas atuais. Aplicar ANTES do deploy do código novo
-- (o login de admin recusa com 503 se estas tabelas não existirem: falha fechada).
-- Cada instrução corre SOZINHA (sem BEGIN/COMMIT).
-- ─────────────────────────────────────────────────────────────────────────────

-- Verificação (ANTES, não há conflito): ambas a NULL.
SELECT to_regclass('public.admin_login_controlo') AS controlo_ja_existe, to_regclass('public.admin_sessoes') AS sessoes_ja_existe;

-- Instrução 1 (aplicar sozinha):
CREATE TABLE IF NOT EXISTS admin_login_controlo (tipo varchar(5) NOT NULL, chave varchar(64) NOT NULL, falhas integer NOT NULL DEFAULT 0, janela_inicio timestamp NOT NULL DEFAULT now(), bloqueado_ate timestamp, nivel integer NOT NULL DEFAULT 0, atualizado_em timestamp NOT NULL DEFAULT now(), CONSTRAINT admin_login_controlo_pk PRIMARY KEY (tipo, chave), CONSTRAINT admin_login_controlo_tipo_chk CHECK (tipo IN ('conta', 'ip')));

-- Instrução 2 (aplicar sozinha):
CREATE INDEX IF NOT EXISTS admin_login_controlo_atualizado_idx ON admin_login_controlo (atualizado_em);

-- Instrução 3 (aplicar sozinha):
CREATE TABLE IF NOT EXISTS admin_sessoes (jti varchar(64) PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE, criada_em timestamp NOT NULL DEFAULT now(), ultimo_uso timestamp NOT NULL DEFAULT now(), expira_em timestamp NOT NULL);

-- Instrução 4 (aplicar sozinha):
CREATE INDEX IF NOT EXISTS admin_sessoes_expira_idx ON admin_sessoes (expira_em);

-- Verificação (DEPOIS): as duas tabelas existem.
SELECT to_regclass('public.admin_login_controlo') AS controlo, to_regclass('public.admin_sessoes') AS sessoes;
