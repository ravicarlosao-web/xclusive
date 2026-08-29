-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: adicionar coluna comissao à tabela purchases
--
-- CONTEXTO: A partir desta migração, cada transacção (gorjeta, subscrição,
-- gorjeta na live) regista a taxa retida pela plataforma.
--
--   purchases.valor    = valor total pago pelo fã (imutável — não muda)
--   purchases.comissao = taxa retida pela plataforma (ex: 200 Kz se rate=20%)
--   valorCriador       = valor - comissao (não armazenado — calculado em runtime)
--
-- DEFAULT 0: registos anteriores a esta migração têm comissao=0, o que é
-- historicamente correcto (o criador recebia 100% antes desta correcção).
--
-- APLICAR MANUALMENTE na Neon com:
--   psql $DATABASE_URL -f add_commission_to_purchases.sql
--   ou via painel SQL do Neon Dashboard
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS comissao NUMERIC(10, 2) NOT NULL DEFAULT 0;

-- Verificação opcional: confirmar que a coluna foi criada
-- SELECT column_name, data_type, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'purchases' AND column_name = 'comissao';
