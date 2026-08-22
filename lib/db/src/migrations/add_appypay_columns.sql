-- ─────────────────────────────────────────────────────────────────────────────
-- Migração: Adicionar colunas AppyPay à tabela topup_requests
-- Data: 2026-08-22
-- ─────────────────────────────────────────────────────────────────────────────

-- Expandir comprimento da coluna status (era 20, agora 30 para acomodar
-- 'aguardando_pagamento' — 20 caracteres)
ALTER TABLE topup_requests
  ALTER COLUMN status TYPE varchar(30);

-- Método de pagamento: 'manual' | 'gpo' | 'ref'
ALTER TABLE topup_requests
  ADD COLUMN IF NOT EXISTS payment_method varchar(10) NOT NULL DEFAULT 'manual';

-- ID do charge no AppyPay (para lookup no webhook)
ALTER TABLE topup_requests
  ADD COLUMN IF NOT EXISTS external_charge_id varchar(120);

-- Dados extra em formato JSON:
--   REF: { entity, referenceNumber, dueDate }
--   GPO: null
ALTER TABLE topup_requests
  ADD COLUMN IF NOT EXISTS external_ref jsonb;

-- Comentário nas colunas para documentação no banco
COMMENT ON COLUMN topup_requests.payment_method   IS 'manual | gpo | ref';
COMMENT ON COLUMN topup_requests.external_charge_id IS 'ID do charge no AppyPay, para lookup no webhook';
COMMENT ON COLUMN topup_requests.external_ref      IS 'Dados REF: {entity, referenceNumber, dueDate}';
