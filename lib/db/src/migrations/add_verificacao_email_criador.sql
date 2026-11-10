-- ─────────────────────────────────────────────────────────────────────────────
-- Migration (ADITIVA): verificação de email para quem quer ser CRIADOR
--
--   * users.email_verificado_em (timestamptz, NULL por omissão): quando o email da conta foi verificado.
--     NULL = não verificado. SEM preenchimento retroativo: todas as contas existentes ficam NULL
--     (os criadores existentes nunca são bloqueados; veem apenas um aviso para verificar).
--
-- A tabela email_tokens (migração da PR 6B) JÁ aceita tipo = 'verificar_email': não é alterada.
-- Uma única instrução, a correr SOZINHA (sem BEGIN/COMMIT).
-- Ordem: aplicar ESTA migração ANTES de fazer o deploy do código (o código novo lê a coluna).
-- ─────────────────────────────────────────────────────────────────────────────

-- Verificação 1 (ANTES): a coluna ainda não existe (esperado: 0).
SELECT count(*) AS coluna_ja_existe FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'email_verificado_em';

-- Instrução 1 (aplicar sozinha):
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verificado_em timestamptz;

-- Verificação 2 (DEPOIS): a coluna existe (esperado: 1) e é timestamptz.
SELECT count(*) AS coluna_existe, max(data_type) AS tipo FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'email_verificado_em';

-- Verificação 3 (DEPOIS): nenhuma conta ficou verificada (esperado: 0).
SELECT count(*) AS contas_verificadas FROM users WHERE email_verificado_em IS NOT NULL;
