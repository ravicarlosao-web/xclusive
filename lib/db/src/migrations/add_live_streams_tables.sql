-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: criar tabelas live_streams e live_tips
--
-- CONTEXTO: A Fase 1 de Live+Gorjetas foi implementada no schema Drizzle
-- (lib/db/src/schema/live.ts) e aplicada localmente via `pnpm db:push`,
-- mas nunca migrada para a base de dados de produção (Neon).
--
-- Esta migration cria:
--   1. O enum  live_stream_status  (agendado | ao_vivo | terminado)
--   2. A tabela live_streams       (uma linha por transmissão em directo)
--   3. A tabela live_tips          (gorjetas enviadas durante uma live)
--
-- É idempotente: usa IF NOT EXISTS em todos os objectos, pelo que pode
-- ser executada mais do que uma vez sem efeitos secundários.
--
-- APLICAR MANUALMENTE na Neon com:
--   psql $DATABASE_URL -f add_live_streams_tables.sql
--   ou via painel SQL do Neon Dashboard
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. Enum de estado da live ─────────────────────────────────────────────────
-- Drizzle: pgEnum("live_stream_status", ["agendado", "ao_vivo", "terminado"])
-- Nota: DO $$ ... $$ garante idempotência — o CREATE TYPE falha se o enum
-- já existir, pelo que verificamos primeiro.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'live_stream_status'
  ) THEN
    CREATE TYPE live_stream_status AS ENUM ('agendado', 'ao_vivo', 'terminado');
  END IF;
END;
$$;


-- ── 2. Tabela live_streams ────────────────────────────────────────────────────
-- Drizzle: liveStreamsTable = pgTable("live_streams", { ... })
--
--   id                 SERIAL PRIMARY KEY
--   criador_id         INTEGER NOT NULL → users.id CASCADE DELETE
--   stream_key         UUID NOT NULL UNIQUE   (chave RTMP gerada na criação)
--   status             live_stream_status NOT NULL DEFAULT 'agendado'
--   total_visualizadores INTEGER NOT NULL DEFAULT 0
--   iniciado_em        TIMESTAMP  (nullable — preenchido quando status→ao_vivo)
--   terminado_em       TIMESTAMP  (nullable — preenchido quando status→terminado)
--   criado_em          TIMESTAMP NOT NULL DEFAULT NOW()

CREATE TABLE IF NOT EXISTS live_streams (
  id                   SERIAL PRIMARY KEY,
  criador_id           INTEGER       NOT NULL
                         REFERENCES users(id) ON DELETE CASCADE,
  stream_key           UUID          NOT NULL,
  status               live_stream_status NOT NULL DEFAULT 'agendado',
  total_visualizadores INTEGER       NOT NULL DEFAULT 0,
  iniciado_em          TIMESTAMP,
  terminado_em         TIMESTAMP,
  criado_em            TIMESTAMP     NOT NULL DEFAULT NOW()
);

-- Índice único em stream_key (equivalente a .unique() no Drizzle)
CREATE UNIQUE INDEX IF NOT EXISTS live_streams_stream_key_unique
  ON live_streams (stream_key);


-- ── 3. Tabela live_tips ───────────────────────────────────────────────────────
-- Drizzle: liveTipsTable = pgTable("live_tips", { ... })
--
--   id            SERIAL PRIMARY KEY
--   stream_id     INTEGER NOT NULL → live_streams.id CASCADE DELETE
--   remetente_id  INTEGER NOT NULL → users.id CASCADE DELETE
--   valor         INTEGER NOT NULL  (valor em Kz, inteiro)
--   mensagem      TEXT              (nullable — mensagem opcional)
--   criado_em     TIMESTAMP NOT NULL DEFAULT NOW()

CREATE TABLE IF NOT EXISTS live_tips (
  id            SERIAL   PRIMARY KEY,
  stream_id     INTEGER  NOT NULL
                  REFERENCES live_streams(id) ON DELETE CASCADE,
  remetente_id  INTEGER  NOT NULL
                  REFERENCES users(id) ON DELETE CASCADE,
  valor         INTEGER  NOT NULL,
  mensagem      TEXT,
  criado_em     TIMESTAMP NOT NULL DEFAULT NOW()
);


-- ── 4. Verificações opcionais ─────────────────────────────────────────────────
-- Descomenta para confirmar que os objectos foram criados:

-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--   AND table_name IN ('live_streams', 'live_tips');

-- SELECT typname, enumlabel FROM pg_enum
--   JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
--   WHERE typname = 'live_stream_status'
--   ORDER BY enumsortorder;
