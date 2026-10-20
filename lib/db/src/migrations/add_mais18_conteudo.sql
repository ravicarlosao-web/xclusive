-- ─────────────────────────────────────────────────────────────────────────────
-- Migration (ADITIVA): marcação de conteúdo +18 (PR 2: filtro no servidor)
--
-- Acrescenta mais18 boolean NOT NULL a posts, reels, stories e live_streams.
--
--  * TODO o conteúdo que já existe fica mais18 = true (decisão: conservador; as criadoras desmarcam
--    mais tarde). Faz-se criando a coluna com DEFAULT true (o Postgres preenche as linhas existentes)
--    e passando logo o DEFAULT para false: conteúdo NOVO nasce com false até ao PR 3 (marcação pela criadora).
--  * Idempotente: se a coluna já existir, não faz nada (por isso correr duas vezes NÃO volta a marcar
--    como +18 o conteúdo que uma criadora já tenha desmarcado).
--
-- ATENÇÃO: depois desta migração, quem não escolheu "ver" (preferência nula ou "filtrar") deixa de ver o
-- conteúdo existente (a autora vê sempre o seu; admin vê tudo).
--
-- APLICAR MANUALMENTE:  psql $DATABASE_URL -f add_mais18_conteudo.sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['posts', 'reels', 'stories', 'live_streams'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = t AND column_name = 'mais18'
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN mais18 boolean NOT NULL DEFAULT true', t);
      EXECUTE format('ALTER TABLE %I ALTER COLUMN mais18 SET DEFAULT false', t);
    END IF;
  END LOOP;
END $$;

COMMIT;
