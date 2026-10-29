-- ─────────────────────────────────────────────────────────────────────────────
-- Migration (ADITIVA): encerramento de conta pelo próprio utilizador
--
--   * users.encerrada_em: conta encerrada (sempre com ativo = false; a CHECK impede reativá-la sem a reabrir);
--   * account_closures: fila de encerramento (uma linha por encerramento). `apagar_apos` = encerrada_em + 30 dias,
--     calculado na aplicação: fim da janela de arrependimento. A purga real é do PR de retenção.
--     user_id ON DELETE RESTRICT: a prova do encerramento conserva-se.
--
-- Não altera nem apaga dados existentes (todas as linhas existentes cumprem a CHECK). Sem BEGIN/COMMIT.
-- APLICAR MANUALMENTE (Neon, antes do merge): psql $DATABASE_URL -f lib/db/src/migrations/add_encerramento_conta.sql
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE users ADD COLUMN IF NOT EXISTS encerrada_em timestamp;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_encerrada_inativa_chk') THEN
    ALTER TABLE users ADD CONSTRAINT users_encerrada_inativa_chk CHECK (encerrada_em IS NULL OR ativo = false);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS account_closures (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  encerrada_em timestamp NOT NULL DEFAULT now(),
  origem varchar(20) NOT NULL DEFAULT 'utilizador',
  tipo_conta varchar(20) NOT NULL,
  ip varchar(45),
  user_agent varchar(400),
  apagar_apos timestamp NOT NULL,
  estado varchar(20) NOT NULL DEFAULT 'pendente',
  reaberta_em timestamp,
  reaberta_por integer REFERENCES users(id) ON DELETE SET NULL,
  reaberta_motivo text,
  processada_em timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS account_closures_um_pendente ON account_closures (user_id) WHERE estado = 'pendente';
CREATE INDEX IF NOT EXISTS account_closures_fila_idx ON account_closures (estado, apagar_apos);
