-- ─────────────────────────────────────────────────────────────────────────────
-- Migration (ADITIVA): autenticação em dois passos (TOTP) das contas de admin e superadmin (A4a, só servidor)
--
-- Cria 2 tabelas NOVAS e vazias: admin_totp (segredo TOTP CIFRADO com AES-256-GCM: segredo_cifrado, iv, tag e chave_versao; ativado_em NULL = ativação pendente; ultimo_passo_usado
-- para a anti-repetição) e admin_totp_recuperacao (10 códigos de recuperação por conta, só como hash bcrypt, de uso único). FKs para users com ON DELETE RESTRICT (como #138).
-- Não altera nem apaga nada que já exista; sem esta migração as contas SEM TOTP continuam a entrar (o servidor trata «tabela em falta» como «sem TOTP»), mas as rotas de TOTP respondem 503.
-- Aplicar ANTES do deploy do código novo (lição do #138). Reversão: lib/db/src/migrations-reversao/reverter_admin_totp.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- Pré-verificação (ANTES): 0 = as tabelas ainda não existem.
SELECT count(*) AS tabelas_ja_existem FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('admin_totp', 'admin_totp_recuperacao');

-- Instrução 1 (aplicar sozinha):
CREATE TABLE IF NOT EXISTS admin_totp (
  id serial PRIMARY KEY,
  user_id integer NOT NULL UNIQUE REFERENCES users (id) ON DELETE RESTRICT,
  segredo_cifrado text NOT NULL,
  iv varchar(64) NOT NULL,
  tag varchar(64) NOT NULL,
  chave_versao varchar(16) NOT NULL,
  ativado_em timestamp,
  ultimo_passo_usado bigint,
  criado_em timestamp NOT NULL DEFAULT now()
);

-- Instrução 2 (aplicar sozinha):
CREATE TABLE IF NOT EXISTS admin_totp_recuperacao (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  codigo_hash varchar(100) NOT NULL,
  usado_em timestamp,
  criado_em timestamp NOT NULL DEFAULT now()
);

-- Instrução 3 (aplicar sozinha):
CREATE INDEX IF NOT EXISTS admin_totp_recuperacao_user_idx ON admin_totp_recuperacao (user_id);

-- Verificação (DEPOIS): as 2 tabelas existem e estão vazias.
SELECT (SELECT count(*) FROM admin_totp) AS totp, (SELECT count(*) FROM admin_totp_recuperacao) AS recuperacao;
SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name IN ('admin_totp', 'admin_totp_recuperacao') ORDER BY table_name, ordinal_position;
