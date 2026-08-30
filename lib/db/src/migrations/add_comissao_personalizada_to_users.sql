-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: adicionar coluna comissao_personalizada à tabela users
--
-- CONTEXTO: Permite ao admin definir uma taxa de comissão personalizada por
-- criador, que sobrepõe a taxa global (platform_settings.commission_rate)
-- exclusivamente para esse criador.
--
--   comissao_personalizada = NULL  →  usa taxa global (comportamento actual,
--                                      retrocompatível com todos os registos
--                                      existentes)
--   comissao_personalizada = 15    →  este criador paga 15% de comissão,
--                                      independentemente da taxa global
--
-- DEFAULT implícito: NULL (sem override) — não é necessário DEFAULT explícito.
-- Todos os criadores existentes continuam a usar a taxa global sem qualquer
-- impacto nos pagamentos já processados.
--
-- APLICAR MANUALMENTE na Neon com:
--   psql $DATABASE_URL -f add_comissao_personalizada_to_users.sql
--   ou via painel SQL do Neon Dashboard
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS comissao_personalizada NUMERIC(5, 2)
  CHECK (comissao_personalizada >= 0 AND comissao_personalizada <= 100);

-- Verificação opcional: confirmar que a coluna foi criada
-- SELECT column_name, data_type, is_nullable, numeric_precision, numeric_scale
-- FROM information_schema.columns
-- WHERE table_name = 'users' AND column_name = 'comissao_personalizada';
