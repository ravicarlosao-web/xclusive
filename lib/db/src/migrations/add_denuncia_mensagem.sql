-- ─────────────────────────────────────────────────────────────────────────────
-- Migration (ADITIVA): denúncia de mensagem — PR 2 (backend)
--
--   1. report_target_type ganha 'mensagem' (target_id = mensagem principal; target_owner_id = o autor dessa mensagem);
--   2. messages ganha retirado_em / retirado_motivo / retirado_por (retirada pela moderação: esconde, nunca apaga);
--   3. função e trigger proteger_mensagem (BEFORE DELETE em messages): uma mensagem retirada, ou com denúncia pendente, em análise
--      ou procedente, não se apaga (nem por cascata, nem por SQL direto).
--
-- Não altera nem apaga dados. Sem BEGIN/COMMIT (compatível com o Neon SQL Editor). Idempotente.
-- APLICAR MANUALMENTE (Neon, ANTES de fazer deploy do backend do PR).
--
-- ⚠ PASSO A: o ALTER TYPE ... ADD VALUE tem de correr SOZINHO (uma instrução por execução) e ANTES do passo B.
-- ─────────────────────────────────────────────────────────────────────────────

-- PASSO A (sozinha):
ALTER TYPE report_target_type ADD VALUE IF NOT EXISTS 'mensagem';

-- PASSO B (depois, numa execução à parte):
ALTER TABLE messages ADD COLUMN IF NOT EXISTS retirado_em     timestamp;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS retirado_motivo text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS retirado_por    integer REFERENCES users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION proteger_mensagem() RETURNS trigger AS $$
BEGIN
  IF OLD.retirado_em IS NOT NULL
     OR EXISTS (SELECT 1 FROM reports r WHERE r.target_type = 'mensagem' AND r.target_id = OLD.id
                AND r.status IN ('pendente', 'em_analise', 'procedente'))
  THEN
    RAISE EXCEPTION 'prova_protegida: mensagem %', OLD.id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS proteger_prova_mensagens ON messages;
CREATE TRIGGER proteger_prova_mensagens BEFORE DELETE ON messages
  FOR EACH ROW EXECUTE FUNCTION proteger_mensagem();

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO (correr depois; só leitura)
--
--   select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
--     where t.typname = 'report_target_type' order by e.enumsortorder;          -- inclui 'mensagem'
--   select column_name, data_type from information_schema.columns
--     where table_name = 'messages' and column_name like 'retirad%' order by 1;  -- retirado_em, retirado_motivo, retirado_por
--   select tgname from pg_trigger where tgname = 'proteger_prova_mensagens';     -- 1 linha
--   select count(*) from messages where retirado_em is not null;                 -- 0
--   select count(*) from reports where target_type = 'mensagem';                 -- 0
-- ─────────────────────────────────────────────────────────────────────────────
