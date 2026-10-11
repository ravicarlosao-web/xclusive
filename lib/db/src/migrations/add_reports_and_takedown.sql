-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: denúncias reais e retirada de conteúdo (takedown)
--
--  1. Enums report_status (pendente|em_analise|procedente|improcedente) e
--     report_target_type (post|reel|story|comment|user|live); conversão de reports.status e
--     reports.target_type, mapeando os valores antigos. Valores desconhecidos fazem a migração ABORTAR.
--  2. reports: novas colunas (alvo/dono, urgente, notas do admin, ações, contacto/IP público) e
--     índices únicos (um denunciante por alvo). FKs para users passam a ON DELETE SET NULL.
--  3. Colunas de retirada (retirado_em, retirado_motivo, retirado_por) em posts, reels, stories,
--     comments e live_streams. Retirar = esconder; NADA é apagado e os ficheiros ficam retidos.
--
-- Tudo numa transação: se algo falhar, nada é alterado.
-- APLICAR MANUALMENTE:  psql $DATABASE_URL -f add_reports_and_takedown.sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Enums
DO $$ BEGIN
  CREATE TYPE report_status AS ENUM ('pendente', 'em_analise', 'procedente', 'improcedente');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE report_target_type AS ENUM ('post', 'reel', 'story', 'comment', 'user', 'live');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE reports ALTER COLUMN status DROP DEFAULT;
ALTER TABLE reports
  ALTER COLUMN status TYPE report_status
  USING (CASE status
           WHEN 'pending'   THEN 'pendente'
           WHEN 'reviewing' THEN 'em_analise'
           WHEN 'resolved'  THEN 'procedente'
           WHEN 'dismissed' THEN 'improcedente'
           ELSE status       -- já em português (ou inválido: o cast falha e a migração aborta)
         END)::report_status;
ALTER TABLE reports ALTER COLUMN status SET DEFAULT 'pendente';

ALTER TABLE reports
  ALTER COLUMN target_type TYPE report_target_type
  USING target_type::report_target_type;   -- 'message' ou outro valor desconhecido: aborta

-- 2. Novas colunas de reports
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS target_owner_id  integer REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS urgente          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_notes      text,
  ADD COLUMN IF NOT EXISTS acao_retirou     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS acao_suspendeu   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reporter_contact varchar(255),
  ADD COLUMN IF NOT EXISTS reporter_ip      varchar(45);

-- Denúncias já existentes: a categoria 'nudity_minor' passa a 'menor' e fica urgente
UPDATE reports SET reason = 'menor' WHERE reason = 'nudity_minor';
UPDATE reports SET urgente = true WHERE reason = 'menor';

-- FKs de reports -> users com ON DELETE SET NULL (apagar um utilizador não pode falhar por causa de denúncias)
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname, att.attname
      FROM pg_constraint con
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
     WHERE con.conrelid = 'reports'::regclass AND con.contype = 'f'
       AND con.confrelid = 'users'::regclass AND att.attname IN ('reporter_id', 'resolved_by')
  LOOP
    EXECUTE format('ALTER TABLE reports DROP CONSTRAINT %I', c.conname);
    EXECUTE format('ALTER TABLE reports ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES users(id) ON DELETE SET NULL', c.conname, c.attname);
  END LOOP;
END $$;

-- Um só denunciante por alvo: verificação prévia de duplicados (aborta se existirem)
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT reporter_id, target_type, target_id FROM reports
     WHERE reporter_id IS NOT NULL GROUP BY 1, 2, 3 HAVING count(*) > 1
  ) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'Existem % denúncias duplicadas (mesmo denunciante e alvo); resolver antes de criar o índice único.', n;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS reports_um_por_utilizador
  ON reports (reporter_id, target_type, target_id) WHERE reporter_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS reports_um_por_contacto
  ON reports (reporter_contact, target_type, target_id) WHERE reporter_id IS NULL AND reporter_contact IS NOT NULL;
CREATE INDEX IF NOT EXISTS reports_fila_idx ON reports (status, urgente, criado_em);

-- 3. Retirada de conteúdo (esconder, não apagar)
ALTER TABLE posts        ADD COLUMN IF NOT EXISTS retirado_em timestamp, ADD COLUMN IF NOT EXISTS retirado_motivo text, ADD COLUMN IF NOT EXISTS retirado_por integer REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE reels        ADD COLUMN IF NOT EXISTS retirado_em timestamp, ADD COLUMN IF NOT EXISTS retirado_motivo text, ADD COLUMN IF NOT EXISTS retirado_por integer REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE stories      ADD COLUMN IF NOT EXISTS retirado_em timestamp, ADD COLUMN IF NOT EXISTS retirado_motivo text, ADD COLUMN IF NOT EXISTS retirado_por integer REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE comments     ADD COLUMN IF NOT EXISTS retirado_em timestamp, ADD COLUMN IF NOT EXISTS retirado_motivo text, ADD COLUMN IF NOT EXISTS retirado_por integer REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS retirado_em timestamp, ADD COLUMN IF NOT EXISTS retirado_motivo text, ADD COLUMN IF NOT EXISTS retirado_por integer REFERENCES users(id) ON DELETE SET NULL;

COMMIT;
