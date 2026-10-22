-- ─────────────────────────────────────────────────────────────────────────────
-- Migration (ADITIVA): evidência do registo em user_legal_acceptances
--
-- Estende a tabela que já guarda o aceite dos Termos e da Privacidade (versões, data e IP) com:
--   * user_agent             — User-Agent do pedido de registo (cortado a 400 caracteres pelo servidor);
--   * maioridade_confirmada  — o utilizador declarou ter 18 anos ou mais (true no registo novo; NULL nas linhas
--                              anteriores a esta migração, que não tinham a declaração);
--   * origem                 — de onde vem o aceite ('registo' agora; futuros re-aceites usam outro valor).
--
-- Escrita pelo servidor na MESMA transação em que a conta é criada. O IP vem só de req.ip (nunca do corpo).
-- Prazo de retenção a definir pelo advogado (ip e user_agent são dados pessoais). Não apaga nem altera linhas.
--
-- Sem BEGIN/COMMIT (cada instrução é idempotente). Pode correr-se mais de uma vez.
-- APLICAR MANUALMENTE:  psql $DATABASE_URL -f add_registo_evidencia.sql
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE user_legal_acceptances ADD COLUMN IF NOT EXISTS user_agent varchar(400);
ALTER TABLE user_legal_acceptances ADD COLUMN IF NOT EXISTS maioridade_confirmada boolean;
ALTER TABLE user_legal_acceptances ADD COLUMN IF NOT EXISTS origem varchar(20) NOT NULL DEFAULT 'registo';
