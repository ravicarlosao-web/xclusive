-- ────────────────────────────────────────────────────────────────────────────────
-- Migration (ADITIVA): cobrança DIRETA da kursiPay (Multicaixa Express e Referência) em kursipay_pagamentos
--
-- Acrescenta 6 colunas NOVAS (todas com valor por defeito ou NULL; nenhuma linha existente muda de significado):
--   modo                'hospedado' (checkout externo, o que já existe) | 'direto' (sem sair do site)           NOT NULL DEFAULT 'hospedado'
--   metodo              'multicaixa_express' | 'reference' (só no modo direto)                                    NULL
--   entidade, referencia, valida_ate   dados da Referência (para mostrar ao utilizador)                         NULL
--   telefone_mascarado  o telefone MASCARADO devolvido pela kursiPay (ex. «+244 9•• ••• 789»); o telefone completo NUNCA se guarda   NULL
-- Não altera nem apaga nada. O código só preenche as colunas novas quando a chave kursipay_direto_ativo estiver ligada.
-- Aplicar ANTES do deploy do código novo (lição do #138; a guarda de migrações recusa se faltar). Reversão: lib/db/src/migrations-reversao/reverter_kursipay_direto.sql.
-- ────────────────────────────────────────────────────────────────────────────────

-- Pré-verificação (ANTES): 0 = as colunas ainda não existem.
SELECT count(*) AS colunas_ja_existem FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'kursipay_pagamentos' AND column_name IN ('modo', 'metodo', 'entidade', 'referencia', 'valida_ate', 'telefone_mascarado');

-- Instrução 1 (aplicar sozinha):
ALTER TABLE kursipay_pagamentos
  ADD COLUMN IF NOT EXISTS modo varchar(10) NOT NULL DEFAULT 'hospedado',
  ADD COLUMN IF NOT EXISTS metodo varchar(24),
  ADD COLUMN IF NOT EXISTS entidade varchar(12),
  ADD COLUMN IF NOT EXISTS referencia varchar(24),
  ADD COLUMN IF NOT EXISTS valida_ate timestamp,
  ADD COLUMN IF NOT EXISTS telefone_mascarado varchar(24);

-- Instrução 2 (aplicar sozinha): restrições (idempotentes).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kursipay_pagamentos_modo_chk') THEN
    ALTER TABLE kursipay_pagamentos ADD CONSTRAINT kursipay_pagamentos_modo_chk CHECK (modo IN ('hospedado', 'direto'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kursipay_pagamentos_metodo_chk') THEN
    ALTER TABLE kursipay_pagamentos ADD CONSTRAINT kursipay_pagamentos_metodo_chk CHECK (metodo IS NULL OR metodo IN ('multicaixa_express', 'reference'));
  END IF;
END $$;

-- Instrução 3 (aplicar sozinha): regista-se a si própria (convenção da guarda de migrações).
INSERT INTO schema_migracoes (nome) VALUES ('add_kursipay_direto.sql') ON CONFLICT DO NOTHING;

-- Verificação (DEPOIS): as 6 colunas existem; todas as linhas antigas ficam em «hospedado».
SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'kursipay_pagamentos' AND column_name IN ('modo', 'metodo', 'entidade', 'referencia', 'valida_ate', 'telefone_mascarado') ORDER BY column_name;
SELECT modo, count(*) FROM kursipay_pagamentos GROUP BY modo;
