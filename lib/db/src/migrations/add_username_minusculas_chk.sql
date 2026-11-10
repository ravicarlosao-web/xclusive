-- ─────────────────────────────────────────────────────────────────────────────
-- Migration (b), SEPARADA da (a): CHECK que obriga o username a estar em minúsculas.
--
--   SÓ APLICAR se a verificação 1 der 0. O registo já guarda o username em minúsculas; esta restrição é a rede de segurança.
--   Cada instrução corre sozinha (sem BEGIN/COMMIT). Não altera dados. Se houver linhas a violar, o Postgres recusa a instrução 1.
-- ─────────────────────────────────────────────────────────────────────────────

-- Verificação 1 (ANTES): usernames com maiúsculas. Tem de dar 0 para aplicar.
SELECT count(*) AS usernames_com_maiusculas FROM users WHERE username <> lower(username);

-- Instrução 1 (aplicar sozinha):
ALTER TABLE users ADD CONSTRAINT users_username_minusculas_chk CHECK (username = lower(username));

-- Verificação 2 (DEPOIS): a restrição existe (1 linha).
SELECT conname, pg_get_constraintdef(oid) AS definicao FROM pg_constraint WHERE conname = 'users_username_minusculas_chk';

-- Verificação 3 (DEPOIS): continua a 0.
SELECT count(*) AS usernames_com_maiusculas FROM users WHERE username <> lower(username);
