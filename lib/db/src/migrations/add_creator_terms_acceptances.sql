-- ─────────────────────────────────────────────────────────────────────────────
-- Migration (ADITIVA): aceite dos Termos para Criadoras na ativação de criadora
--
-- Nova tabela creator_terms_acceptances: uma linha por pedido de ativação (POST /users/me/tornar-criador), gravada na
-- MESMA transação que a submissão KYC e a mudança para criadora. Guarda a versão aceite, a submissão KYC associada,
-- a data, o IP e o User-Agent (dados pessoais: só na base de dados, nunca em logs) e a origem.
--
--   * user_id           — ON DELETE RESTRICT: a prova de aceite conserva-se (não é apagada em cascata);
--   * kyc_submission_id — ON DELETE SET NULL.
--
-- Contas de criadora anteriores a esta migração ficam sem linha ("sem registo (conta anterior)"): não há reaceitação.
-- Não altera nem apaga dados existentes. Sem BEGIN/COMMIT.
-- APLICAR MANUALMENTE (Neon, antes do merge): psql $DATABASE_URL -f lib/db/src/migrations/add_creator_terms_acceptances.sql
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS creator_terms_acceptances (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  versao varchar(40) NOT NULL,
  kyc_submission_id integer REFERENCES kyc_submissions(id) ON DELETE SET NULL,
  aceite_em timestamp NOT NULL DEFAULT now(),
  ip varchar(45),
  user_agent varchar(400),
  origem varchar(20) NOT NULL DEFAULT 'tornar-criador'
);

CREATE INDEX IF NOT EXISTS creator_terms_acceptances_user_idx ON creator_terms_acceptances (user_id);
