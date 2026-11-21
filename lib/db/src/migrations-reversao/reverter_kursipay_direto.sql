-- ────────────────────────────────────────────────────────────────────────────────
-- REVERSÃO de add_kursipay_direto.sql: tira as 6 colunas da cobrança direta de kursipay_pagamentos.
-- ATENÇÃO: perdem-se os dados da Referência (entidade, referência, prazo) e o telefone mascarado dos pagamentos diretos já feitos; o saldo, os pedidos e a auditoria não mudam.
-- Desliga primeiro a chave kursipay_direto_ativo e confirma que não há pagamentos diretos por pagar (estado pending).
-- ────────────────────────────────────────────────────────────────────────────────

-- Pré-verificação (ANTES): pagamentos diretos existentes e por pagar (só informação).
SELECT count(*) FILTER (WHERE modo = 'direto') AS diretos, count(*) FILTER (WHERE modo = 'direto' AND estado IN ('a_criar', 'pending')) AS por_pagar FROM kursipay_pagamentos;

-- Instrução 1 (aplicar sozinha):
ALTER TABLE kursipay_pagamentos DROP CONSTRAINT IF EXISTS kursipay_pagamentos_modo_chk, DROP CONSTRAINT IF EXISTS kursipay_pagamentos_metodo_chk;

-- Instrução 2 (aplicar sozinha):
ALTER TABLE kursipay_pagamentos
  DROP COLUMN IF EXISTS modo, DROP COLUMN IF EXISTS metodo, DROP COLUMN IF EXISTS entidade,
  DROP COLUMN IF EXISTS referencia, DROP COLUMN IF EXISTS valida_ate, DROP COLUMN IF EXISTS telefone_mascarado;

-- Instrução 3 (aplicar sozinha): tira o registo da migração (para a guarda voltar a exigi-la se for reaplicada).
DELETE FROM schema_migracoes WHERE nome = 'add_kursipay_direto.sql';

-- Verificação (DEPOIS): 0 = as colunas já não existem.
SELECT count(*) AS colunas_ainda_existem FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'kursipay_pagamentos' AND column_name IN ('modo', 'metodo', 'entidade', 'referencia', 'valida_ate', 'telefone_mascarado');
