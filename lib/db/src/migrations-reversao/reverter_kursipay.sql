-- ─────────────────────────────────────────────────────────────────────────────
-- REVERSÃO de add_kursipay.sql: apaga as tabelas do registo dos pagamentos kursiPay e dos eventos processados.
-- ATENÇÃO: se já houve carregamentos creditados pela kursiPay, perde-se o REGISTO do pagamento e dos eventos (os carregamentos em topup_requests, o saldo e a auditoria ficam como estão);
-- a reconciliação com a kursiPay deixa de ter com que comparar. Desliga primeiro a chave topup_kursipay_ativo e confirma que não há pagamentos por pagar (estado pending).
-- ─────────────────────────────────────────────────────────────────────────────

-- Pré-verificação (ANTES): quantas linhas vão ser apagadas e quantos pagamentos ainda estão por pagar (só informação).
SELECT (SELECT count(*) FROM kursipay_pagamentos) AS pagamentos, (SELECT count(*) FROM kursipay_pagamentos WHERE estado IN ('a_criar', 'pending')) AS por_pagar, (SELECT count(*) FROM kursipay_eventos) AS eventos;

-- Instrução 1 (aplicar sozinha):
DROP TABLE IF EXISTS kursipay_eventos;

-- Instrução 2 (aplicar sozinha):
DROP TABLE IF EXISTS kursipay_pagamentos;

-- Instrução 3 (aplicar sozinha): tira o registo da migração (para a guarda voltar a exigi-la se for reaplicada).
DELETE FROM schema_migracoes WHERE nome = 'add_kursipay.sql';

-- Verificação (DEPOIS): 0 = as tabelas já não existem.
SELECT count(*) AS tabelas_ainda_existem FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('kursipay_pagamentos', 'kursipay_eventos');
