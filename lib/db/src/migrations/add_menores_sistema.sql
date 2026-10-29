-- ─────────────────────────────────────────────────────────────────────────────
-- Migration (ADITIVA): casos de menor (registo interno)
--
--   * menor_cases: um caso por conta (aberto → confirmado | arquivado). Guarda quem abriu, a descrição, a decisão, as
--     ações tomadas (contagens), a autoridade comunicada (nome, data, referência) e a cópia dos acessos (IP e user-agent das
--     sessões) feita ANTES de a suspensão as apagar. Todas as FK são RESTRICT; um gatilho recusa DELETE: o registo conserva-se.
--     `decisao_em` é a âncora do prazo de conservação.
--   * identifier_blocks.caso_id: liga cada bloqueio de identificador ao caso que o originou (origem 'menor').
--   * reports.retirada_auto: a denúncia pública que retirou o conteúdo automaticamente (conta os limites de 3 por 24 h por IP e
--     por contacto, sobre dados que a denúncia já guarda: não se grava mais nenhum IP nem email).
--   * reports.alvo_snapshot_sha256: SHA-256 da cópia do alvo guardada na denúncia (cadeia de custódia).
--
-- Não altera nem apaga dados existentes. Sem BEGIN/COMMIT.
-- APLICAR MANUALMENTE (Neon, antes do merge): psql $DATABASE_URL -f lib/db/src/migrations/add_menores_sistema.sql
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS menor_cases (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  report_id integer REFERENCES reports(id) ON DELETE RESTRICT,
  aberto_em timestamp NOT NULL DEFAULT now(),
  aberto_por integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  descricao text NOT NULL,
  estado varchar(20) NOT NULL DEFAULT 'aberto',
  decisao_em timestamp,
  decisao_por integer REFERENCES users(id) ON DELETE RESTRICT,
  decisao_motivo text,
  acoes jsonb NOT NULL DEFAULT '{}'::jsonb,
  acessos_preservados jsonb NOT NULL DEFAULT '[]'::jsonb,
  autoridade varchar(150),
  autoridade_comunicada_em timestamp,
  autoridade_referencia varchar(100),
  autoridade_registada_por integer REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT menor_cases_estado_chk CHECK (estado IN ('aberto', 'confirmado', 'arquivado')),
  CONSTRAINT menor_cases_decisao_chk CHECK ((estado = 'aberto') = (decisao_em IS NULL)),
  CONSTRAINT menor_cases_autoridade_chk CHECK (autoridade IS NULL OR autoridade_comunicada_em IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS menor_cases_um_ativo ON menor_cases (user_id) WHERE estado IN ('aberto', 'confirmado');
CREATE INDEX IF NOT EXISTS menor_cases_estado_idx ON menor_cases (estado, aberto_em);
CREATE INDEX IF NOT EXISTS menor_cases_report_idx ON menor_cases (report_id);

CREATE OR REPLACE FUNCTION menor_cases_sem_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'menor_case_protegido: %', OLD.id;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS menor_cases_sem_delete ON menor_cases;
CREATE TRIGGER menor_cases_sem_delete BEFORE DELETE ON menor_cases FOR EACH ROW EXECUTE FUNCTION menor_cases_sem_delete();

ALTER TABLE identifier_blocks ADD COLUMN IF NOT EXISTS caso_id integer REFERENCES menor_cases(id) ON DELETE RESTRICT;

ALTER TABLE reports ADD COLUMN IF NOT EXISTS retirada_auto boolean NOT NULL DEFAULT false;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS alvo_snapshot_sha256 varchar(64);
CREATE INDEX IF NOT EXISTS reports_auto_ip_idx ON reports (reporter_ip, criado_em) WHERE retirada_auto;
CREATE INDEX IF NOT EXISTS reports_auto_contacto_idx ON reports (reporter_contact, criado_em) WHERE retirada_auto;
