-- ─────────────────────────────────────────────────────────────────────────────
-- Migration (ADITIVA): idempotência das gorjetas de posts e de lives
--
--   purchases ganha chave_idempotencia e pedido_hash (ambas opcionais) e um índice único PARCIAL por (comprador, chave):
--   a mesma chave devolve a compra original sem nova cobrança; a mesma chave em contas diferentes é permitida.
--   Só as gorjetas de posts e de lives passam a gravar estas colunas; todas as linhas existentes ficam com NULL (nada é alterado).
--
-- Sem BEGIN/COMMIT (compatível com o Neon SQL Editor). Idempotente (IF NOT EXISTS).
-- APLICAR MANUALMENTE (Neon), ANTES de fazer deploy do backend do PR: o backend lê estas colunas.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS chave_idempotencia varchar(64);
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS pedido_hash varchar(64);

CREATE UNIQUE INDEX IF NOT EXISTS purchases_comprador_chave_uq
  ON purchases (comprador_id, chave_idempotencia)
  WHERE chave_idempotencia IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO (correr depois; só leitura)
--
--   select column_name, data_type, character_maximum_length, is_nullable from information_schema.columns
--     where table_name = 'purchases' and column_name in ('chave_idempotencia', 'pedido_hash') order by 1;   -- 2 linhas, varchar(64), YES
--   select indexdef from pg_indexes where indexname = 'purchases_comprador_chave_uq';                        -- UNIQUE ... (comprador_id, chave_idempotencia) WHERE (chave_idempotencia IS NOT NULL)
--   select count(*) from purchases where chave_idempotencia is not null or pedido_hash is not null;         -- 0 (nenhuma linha existente alterada)
-- ─────────────────────────────────────────────────────────────────────────────
