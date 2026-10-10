-- ─────────────────────────────────────────────────────────────────────────────
-- Migration (ADITIVA): expiração de subscrições + tipo de subscrição da criadora
--
--  1. subscription_estado ganha o valor 'expirada'.
--  2. users.tipo_subscricao ('gratuita' | 'paga'), DEFAULT 'paga' = comportamento atual.
--  3. Índice único parcial: no máximo uma subscrição 'ativa' por (subscritor, criador).
--
-- As subscrições existentes NÃO são alteradas: expiram na data que já têm em renovacao_em
-- (sem período de graça e sem cobrança); o job de expiração passa-as a 'expirada'.
--
-- APLICAR MANUALMENTE (cada passo é independente; o passo 1 não pode correr dentro de
-- uma transação que use o novo valor):
--   psql $DATABASE_URL -f add_subscription_expiry_and_type.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Novo valor do enum
ALTER TYPE subscription_estado ADD VALUE IF NOT EXISTS 'expirada';

-- 2. Tipo de subscrição da criadora
DO $$ BEGIN
  CREATE TYPE tipo_subscricao AS ENUM ('gratuita', 'paga');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tipo_subscricao tipo_subscricao NOT NULL DEFAULT 'paga';

-- 3. Verificação prévia de duplicados: ABORTA se existirem pares com mais de uma 'ativa'.
--    Se abortar, resolver à mão (manter a mais recente, cancelar as outras) e voltar a correr.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT subscritor_id, criador_id
      FROM subscriptions
     WHERE estado = 'ativa'
     GROUP BY subscritor_id, criador_id
    HAVING count(*) > 1
  ) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'Existem % pares (subscritor, criador) com mais de uma subscrição ativa; resolver antes de criar o índice único.', n;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_unica_ativa
  ON subscriptions (subscritor_id, criador_id)
  WHERE estado = 'ativa';
