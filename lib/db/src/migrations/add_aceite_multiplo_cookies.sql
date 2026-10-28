-- ─────────────────────────────────────────────────────────────────────────────
-- Migration (ADITIVA): aceite múltiplo de documentos legais e cookies no registo
--
-- Estende user_legal_acceptances com as versões dos restantes documentos aceites e o aceite de cookies:
--   * conteudo_versao, direitos_autor_versao, reembolsos_versao — versões aceites (text);
--   * cookies_aceites — aceite de cookies e armazenamento local (true no registo novo).
-- Todas anuláveis: as linhas anteriores ficam NULL (aceites antes de existirem estes documentos/esta caixa).
-- Não apaga nem altera linhas. Sem BEGIN/COMMIT.
-- APLICAR MANUALMENTE (Neon, antes do merge): psql $DATABASE_URL -f lib/db/src/migrations/add_aceite_multiplo_cookies.sql
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE user_legal_acceptances ADD COLUMN IF NOT EXISTS conteudo_versao text;
ALTER TABLE user_legal_acceptances ADD COLUMN IF NOT EXISTS direitos_autor_versao text;
ALTER TABLE user_legal_acceptances ADD COLUMN IF NOT EXISTS reembolsos_versao text;
ALTER TABLE user_legal_acceptances ADD COLUMN IF NOT EXISTS cookies_aceites boolean;
