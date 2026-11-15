-- ─────────────────────────────────────────────────────────────────────────────
-- REVERSÃO de add_ajustes_saldo.sql. NÃO está em migrations/ de propósito. ATENÇÃO: apaga a tabela e os ajustes que ela tiver; confirma ANTES que está vazia ou que já
-- guardaste o conteúdo (o código novo deixa de funcionar sem ela: reverter também o deploy).
-- ─────────────────────────────────────────────────────────────────────────────

-- Pré-verificação (ANTES): quantos ajustes serão perdidos.
SELECT count(*) AS ajustes_que_serao_perdidos FROM ajustes_saldo;

-- Instrução 1 (aplicar sozinha):
DROP TABLE IF EXISTS ajustes_saldo;
