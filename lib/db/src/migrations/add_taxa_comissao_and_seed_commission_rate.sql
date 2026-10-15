-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: comissão sempre vinda da base de dados
--
--  1. purchases.taxa_comissao (numeric(5,2), NULL): taxa aplicada em cada compra NOVA. As compras antigas
--     ficam com NULL (só têm o montante em `comissao`) e não são alteradas.
--  2. platform_settings.commission_rate: insere a taxa inicial SÓ SE AINDA NÃO EXISTIR (ON CONFLICT DO
--     NOTHING: nunca sobrescreve o que o admin já guardou). O código deixou de ter qualquer taxa por
--     omissão: sem esta linha, as compras respondem 503 e nada é cobrado.
--
-- O valor inicial NÃO está no ficheiro: passa-se na linha de comandos (percentagem 0-100). Sem ele, ou
-- fora do intervalo, a migração aborta ANTES de alterar o que quer que seja.
--
-- APLICAR MANUALMENTE:  psql $DATABASE_URL -v taxa=<0-100> -f add_taxa_comissao_and_seed_commission_rate.sql
-- ─────────────────────────────────────────────────────────────────────────────

\set ON_ERROR_STOP on

\if :{?taxa}
\else
  \echo 'ERRO: indica a taxa inicial (percentagem 0-100):  psql $DATABASE_URL -v taxa=<0-100> -f <este ficheiro>'
  DO $$ BEGIN RAISE EXCEPTION 'taxa em falta: nada foi alterado'; END $$;
\endif

SELECT ((:'taxa')::numeric BETWEEN 0 AND 100 AND (:'taxa')::numeric = round((:'taxa')::numeric, 2)) AS taxa_ok \gset
\if :taxa_ok
\else
  \echo 'ERRO: a taxa tem de estar entre 0 e 100 (no máximo 2 casas decimais).'
  DO $$ BEGIN RAISE EXCEPTION 'taxa fora de 0-100 (ou com mais de 2 casas): nada foi alterado'; END $$;
\endif

BEGIN;

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS taxa_comissao numeric(5,2);

INSERT INTO platform_settings (key, value)
VALUES ('commission_rate', jsonb_build_object('value', (:'taxa')::numeric))
ON CONFLICT (key) DO NOTHING;

COMMIT;
