-- ─────────────────────────────────────────────────────────────────────────────
-- Migration (ADITIVA): preferência de conteúdo +18 do utilizador (PR 1; nada é filtrado ainda)
--
--  1. users.preferencia_mais18 (texto, NULL = ainda não escolheu): 'ver' | 'filtrar' (CHECK).
--     NULL conta como 'filtrar' no servidor. Utilizadores existentes ficam com NULL.
--  2. users.preferencia_mais18_em (timestamp): quando foi feita a última escolha.
--  3. user_mais18_choices: histórico append-only de cada escolha (valor, versão do texto do
--     cartão, data e IP). Escrita pelo servidor na MESMA transação do UPDATE em users.
--     O IP só existe aqui, nunca em logs.
--
-- Não altera nem apaga dados existentes. Idempotente (pode correr mais de uma vez).
--
-- APLICAR MANUALMENTE:  psql $DATABASE_URL -f add_user_mais18_preferencia.sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS preferencia_mais18    text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferencia_mais18_em timestamp;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_preferencia_mais18_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_preferencia_mais18_check
      CHECK (preferencia_mais18 IN ('ver', 'filtrar'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS user_mais18_choices (
  id            serial PRIMARY KEY,
  user_id       integer     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  valor         text        NOT NULL CHECK (valor IN ('ver', 'filtrar')),
  texto_versao  varchar(40) NOT NULL,
  escolhida_em  timestamp   NOT NULL DEFAULT now(),
  ip            varchar(45)
);

CREATE INDEX IF NOT EXISTS user_mais18_choices_user_idx ON user_mais18_choices (user_id, escolhida_em);

COMMIT;
