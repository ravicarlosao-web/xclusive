-- ─────────────────────────────────────────────────────────────────────────────
-- Migration (ADITIVA): troca de palavra-passe obrigatória (admin)
--
--   * users.troca_password_obrigatoria: boolean NOT NULL DEFAULT false. true = a conta tem de trocar a palavra-passe no próximo acesso
--     (os endpoints de admin recusam tudo, exceto a troca, enquanto estiver ativa). As contas existentes ficam com false.
--
-- Não altera nem apaga dados. Aplicar ANTES do deploy do código novo (o código novo lê esta coluna). Uma instrução, corre sozinha.
-- ─────────────────────────────────────────────────────────────────────────────

-- Verificação (ANTES): 0 = a coluna ainda não existe.
SELECT count(*) AS coluna_ja_existe FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'troca_password_obrigatoria';

-- Instrução 1 (aplicar sozinha):
ALTER TABLE users ADD COLUMN IF NOT EXISTS troca_password_obrigatoria boolean NOT NULL DEFAULT false;

-- Verificação (DEPOIS): 1 linha (boolean, NO, false) e 0 contas marcadas.
SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'troca_password_obrigatoria';
SELECT count(*) AS contas_marcadas FROM users WHERE troca_password_obrigatoria;
