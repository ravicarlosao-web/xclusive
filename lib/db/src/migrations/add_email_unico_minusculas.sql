-- ─────────────────────────────────────────────────────────────────────────────
-- Migration (a): email único sem distinguir maiúsculas de minúsculas.
--
--   CREATE UNIQUE INDEX sobre lower(email) em users. O registo passa a guardar o email em minúsculas (trim + minúsculas) e a
--   API compara sempre lower(users.email) com o email recebido em minúsculas, por isso funciona antes e depois desta migração
--   e de qualquer correção de dados. Cada instrução corre sozinha (sem BEGIN/COMMIT). Não altera dados.
--
-- ANTES DE APLICAR: a consulta de verificação 1 tem de dar 0 (grupos de emails repetidos ignorando a caixa); com duplicados o
--   índice não se cria (o Postgres recusa) e é preciso decidir caso a caso.
-- ─────────────────────────────────────────────────────────────────────────────

-- Verificação 1 (ANTES): grupos de emails repetidos ignorando a caixa. Tem de dar 0.
SELECT count(*) AS grupos_email_repetidos FROM (SELECT lower(email) FROM users GROUP BY lower(email) HAVING count(*) > 1) d;

-- Instrução 1 (aplicar sozinha):
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uq ON users (lower(email));

-- Verificação 2 (DEPOIS): o índice existe (1 linha) e é único.
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'users' AND indexname = 'users_email_lower_uq';

-- Verificação 3 (opcional, informativa): emails ainda com maiúsculas (não bloqueia nada: o login compara em minúsculas).
SELECT count(*) AS emails_com_maiusculas FROM users WHERE email <> lower(email);
