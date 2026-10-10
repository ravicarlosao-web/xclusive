-- ─────────────────────────────────────────────────────────────────────────────
-- Migration (ADITIVA): aceite dos Termos e da Política de Privacidade no registo
--
-- Cria user_legal_acceptances (user_id, versão dos Termos, versão da Privacidade, aceite_em, ip).
-- Escrita pelo servidor na MESMA transação em que o utilizador é criado.
-- Não altera nem apaga nada. Os utilizadores já existentes ficam sem linha (aceitaram antes
-- de existir registo); um futuro pedido de re-aceite acrescenta linhas.
--
-- APLICAR MANUALMENTE:  psql $DATABASE_URL -f add_user_legal_acceptances.sql
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_legal_acceptances (
  id                 serial PRIMARY KEY,
  user_id            integer     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  termos_versao      varchar(40) NOT NULL,
  privacidade_versao varchar(40) NOT NULL,
  aceite_em          timestamp   NOT NULL DEFAULT now(),
  ip                 varchar(45)
);

CREATE INDEX IF NOT EXISTS user_legal_acceptances_user_idx ON user_legal_acceptances (user_id);
