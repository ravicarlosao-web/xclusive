-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: levantamentos reais das criadoras
--
--  1. Enum withdrawal_status (pendente | aprovado | rejeitado | pago) e conversão de
--     withdrawal_requests.status (varchar → enum), mapeando os valores antigos em inglês.
--  2. Tabela creator_payout_accounts (IBAN por criadora).
--  3. CHECK users.ganhos >= 0 — ABORTA se existirem ganhos negativos.
--  4. Índice único parcial: um só pedido 'pendente' por criadora.
--
-- Os ganhos são reservados (debitados) ao criar o pedido e devolvidos na rejeição.
-- Valores de status desconhecidos fazem a conversão FALHAR (nada é alterado, é uma transação).
--
-- APLICAR MANUALMENTE:  psql $DATABASE_URL -f add_real_withdrawals.sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 3a. Verificação prévia de ganhos negativos
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM users WHERE ganhos < 0;
  IF n > 0 THEN
    RAISE EXCEPTION 'Existem % utilizadores com ganhos negativos; corrigir antes de criar o CHECK.', n;
  END IF;
END $$;

-- 1. Enum + conversão dos estados antigos
DO $$ BEGIN
  CREATE TYPE withdrawal_status AS ENUM ('pendente', 'aprovado', 'rejeitado', 'pago');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE withdrawal_requests ALTER COLUMN status DROP DEFAULT;
ALTER TABLE withdrawal_requests
  ALTER COLUMN status TYPE withdrawal_status
  USING (CASE status
           WHEN 'pending'  THEN 'pendente'
           WHEN 'approved' THEN 'aprovado'
           WHEN 'rejected' THEN 'rejeitado'
           WHEN 'paid'     THEN 'pago'
           ELSE status       -- já em português (ou inválido: o cast falha e a migração aborta)
         END)::withdrawal_status;
ALTER TABLE withdrawal_requests ALTER COLUMN status SET DEFAULT 'pendente';

-- 2. Dados de pagamento da criadora
CREATE TABLE IF NOT EXISTS creator_payout_accounts (
  user_id       integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  iban          varchar(34)  NOT NULL,
  nome_titular  varchar(150) NOT NULL,
  banco         varchar(100) NOT NULL,
  atualizado_em timestamp    NOT NULL DEFAULT now()
);

-- 3b. CHECK de ganhos
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_ganhos_nao_negativo;
ALTER TABLE users ADD CONSTRAINT users_ganhos_nao_negativo CHECK (ganhos >= 0);

-- 4. Um só pedido pendente por criadora (verificação prévia de duplicados)
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT creator_id FROM withdrawal_requests WHERE status = 'pendente' GROUP BY creator_id HAVING count(*) > 1
  ) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'Existem % criadoras com mais de um levantamento pendente; resolver antes de criar o índice.', n;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_requests_um_pendente
  ON withdrawal_requests (creator_id) WHERE status = 'pendente';

COMMIT;
