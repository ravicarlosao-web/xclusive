-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: lives gratuitas ou pagas (bilhete)
--
-- Só ACRESCENTA — nada destrutivo. Lives existentes ficam 'gratuita' / preço 0.
--   1. Enum  live_acesso            (gratuita | paga)
--   2. Colunas live_streams.tipo e live_streams.preco (+ CHECK de coerência)
--   3. Valor 'bilhete_live' no enum purchase_tipo
--   4. Tabela live_tickets          (unique live_id + user_id)
--
-- Idempotente: pode correr mais do que uma vez.
--
-- APLICAR MANUALMENTE, ANTES do merge/deploy do código, SEM -1 / --single-transaction
-- (o ALTER TYPE ... ADD VALUE não deve correr dentro de um bloco de transação):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f add_live_tickets.sql
--
-- REVERSÃO (ver rodapé do ficheiro).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Enum live_acesso
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'live_acesso') THEN
    CREATE TYPE live_acesso AS ENUM ('gratuita', 'paga');
  END IF;
END;
$$;

-- 2. Colunas novas em live_streams
ALTER TABLE live_streams
  ADD COLUMN IF NOT EXISTS tipo  live_acesso   NOT NULL DEFAULT 'gratuita',
  ADD COLUMN IF NOT EXISTS preco NUMERIC(10, 2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'live_streams_tipo_preco_chk'
  ) THEN
    ALTER TABLE live_streams
      ADD CONSTRAINT live_streams_tipo_preco_chk
      CHECK ((tipo = 'gratuita' AND preco = 0) OR (tipo = 'paga' AND preco > 0));
  END IF;
END;
$$;

-- 3. Novo tipo de compra (fora de transação; não usado neste ficheiro)
ALTER TYPE purchase_tipo ADD VALUE IF NOT EXISTS 'bilhete_live';

-- 4. Tabela live_tickets
CREATE TABLE IF NOT EXISTS live_tickets (
  id          SERIAL PRIMARY KEY,
  live_id     INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  valor       NUMERIC(10, 2) NOT NULL,
  comissao    NUMERIC(10, 2) NOT NULL DEFAULT 0,
  purchase_id INTEGER,
  criado_em   TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT live_tickets_live_user_uniq UNIQUE (live_id, user_id),
  -- Nomes iguais aos que o drizzle-kit gera, para um futuro `db:push` ser um no-op
  CONSTRAINT live_tickets_live_id_live_streams_id_fk
    FOREIGN KEY (live_id) REFERENCES live_streams(id) ON DELETE CASCADE,
  CONSTRAINT live_tickets_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT live_tickets_purchase_id_purchases_id_fk
    FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS live_tickets_user_idx ON live_tickets (user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- REVERSÃO (só se for mesmo necessário; apaga os bilhetes vendidos):
--   DROP TABLE IF EXISTS live_tickets;
--   ALTER TABLE live_streams DROP CONSTRAINT IF EXISTS live_streams_tipo_preco_chk;
--   ALTER TABLE live_streams DROP COLUMN IF EXISTS tipo, DROP COLUMN IF EXISTS preco;
--   DROP TYPE IF EXISTS live_acesso;
--   -- O valor 'bilhete_live' em purchase_tipo é inofensivo e não se remove.
-- ─────────────────────────────────────────────────────────────────────────────
