-- ─────────────────────────────────────────────────────────────────────────────
-- Migration (ADITIVA): banimento permanente
--
--   * users.banida_em: conta banida de forma permanente (sempre com ativo = false; a CHECK impede reativá-la);
--   * identifier_blocks: bloqueios de identificadores. Guarda SÓ HASHES (HMAC-SHA256 com o pepper BAN_HASH_PEPPER),
--     nunca o email nem o número de documento em claro. `tipo` = 'email' | 'documento'. `origem` = 'banimento' | 'menor'
--     (a mesma tabela serve o PR dos menores). Índice único (tipo, hash): o mesmo identificador só é bloqueado uma vez.
--     user_id ON DELETE RESTRICT: a prova do bloqueio conserva-se.
--
-- Não altera nem apaga dados existentes (todas as linhas existentes cumprem a CHECK). Sem BEGIN/COMMIT.
-- APLICAR MANUALMENTE (Neon, antes do merge): psql $DATABASE_URL -f lib/db/src/migrations/add_banimento_permanente.sql
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE users ADD COLUMN IF NOT EXISTS banida_em timestamp;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_banida_inativa_chk') THEN
    ALTER TABLE users ADD CONSTRAINT users_banida_inativa_chk CHECK (banida_em IS NULL OR ativo = false);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS identifier_blocks (
  id serial PRIMARY KEY,
  tipo varchar(20) NOT NULL,
  hash varchar(64) NOT NULL,
  origem varchar(20) NOT NULL DEFAULT 'banimento',
  user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  banida_por integer REFERENCES users(id) ON DELETE SET NULL,
  motivo text,
  criada_em timestamp NOT NULL DEFAULT now(),
  CONSTRAINT identifier_blocks_tipo_chk CHECK (tipo IN ('email', 'documento')),
  CONSTRAINT identifier_blocks_origem_chk CHECK (origem IN ('banimento', 'menor'))
);

CREATE UNIQUE INDEX IF NOT EXISTS identifier_blocks_tipo_hash_uq ON identifier_blocks (tipo, hash);
CREATE INDEX IF NOT EXISTS identifier_blocks_user_idx ON identifier_blocks (user_id);
