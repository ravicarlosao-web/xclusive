-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Migration: login com o Google (PR 1: servidor).
--
--   1. users.password_definida (boolean, NOT NULL, default true): false = conta criada com o Google que ainda não definiu palavra-passe.
--      Todas as contas existentes ficam com true (comportamento igual ao de hoje). Em Postgres 11+ não reescreve a tabela.
--   2. user_google_identities: a ligação conta ↔ identidade Google (`sub`), com UNIQUE(user_id) e UNIQUE(google_sub).
--
-- ADITIVA: o código antigo ignora a coluna e a tabela. Cada instrução corre sozinha (sem BEGIN/COMMIT). Aplicar ANTES do deploy da API.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────

-- Verificação 1 (ANTES): a coluna e a tabela ainda não existem (a 1.ª consulta dá 0 linhas; a 2.ª dá NULL).
SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'password_definida';
SELECT to_regclass('public.user_google_identities') AS tabela;

-- Instrução 1 (aplicar sozinha):
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_definida boolean NOT NULL DEFAULT true;

-- Verificação 2 (DEPOIS da instrução 1): 1 linha (boolean, NO, true) e nenhuma conta existente com false (sem_password = 0).
SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'password_definida';
SELECT count(*) FILTER (WHERE NOT password_definida) AS sem_password, count(*) AS total FROM users;

-- Instrução 2 (aplicar sozinha):
CREATE TABLE IF NOT EXISTS user_google_identities (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  google_sub varchar(255) NOT NULL,
  email_google varchar(255) NOT NULL,
  ligado_em timestamptz NOT NULL DEFAULT now(),
  ultimo_login_em timestamptz,
  CONSTRAINT user_google_identities_user_uq UNIQUE (user_id),
  CONSTRAINT user_google_identities_sub_uq UNIQUE (google_sub)
);

-- Verificação 3 (DEPOIS da instrução 2): a tabela existe, está vazia e tem as duas restrições únicas (2 linhas).
SELECT to_regclass('public.user_google_identities') AS tabela;
SELECT count(*) AS linhas FROM user_google_identities;
SELECT conname FROM pg_constraint WHERE conrelid = 'user_google_identities'::regclass AND contype = 'u' ORDER BY conname;
