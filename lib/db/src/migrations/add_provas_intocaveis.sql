-- ─────────────────────────────────────────────────────────────────────────────
-- Migration (ADITIVA): provas intocáveis — conteúdo denunciado ou retirado não se apaga
--
--   1. índice reports_alvo_estado_idx: consulta das denúncias por alvo e estado (as verificações de eliminação e a
--      criação de denúncias consultam-no);
--   2. coluna reports.alvo_snapshot (jsonb): cópia leve do alvo (texto, chaves dos ficheiros, dono, datas) guardada
--      na própria denúncia; sobrevive a um apagamento posterior do conteúdo. Só visível ao admin; nunca em logs;
--   3. função proteger_prova() + triggers BEFORE DELETE em posts, reels, stories, comments e live_streams: impedem o
--      DELETE físico (também por cascata, por ex. ao apagar um utilizador, ou por SQL direto) de conteúdo protegido:
--         - retirado (retirado_em preenchido);
--         - com denúncia 'menor' aberta (pendente ou em_analise): nunca, nem o admin;
--         - com denúncia 'menor' procedente (bloqueio permanente);
--         - com denúncia aberta de OUTRA categoria: bloqueado, EXCETO quando a eliminação é pedida pelo admin com motivo
--           (a aplicação marca a transação com set_config('xclusive.admin_apaga', 'on', true)).
--      A aplicação faz as mesmas verificações antes e responde com mensagens claras; o trigger é a rede de segurança.
--
-- Não altera nem apaga dados existentes. Sem BEGIN/COMMIT.
-- APLICAR MANUALMENTE (Neon, antes do merge): psql $DATABASE_URL -f lib/db/src/migrations/add_provas_intocaveis.sql
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS reports_alvo_estado_idx ON reports (target_type, target_id, status);

ALTER TABLE reports ADD COLUMN IF NOT EXISTS alvo_snapshot jsonb;

CREATE OR REPLACE FUNCTION proteger_prova() RETURNS trigger AS $$
BEGIN
  IF OLD.retirado_em IS NOT NULL
     OR EXISTS (SELECT 1 FROM reports r WHERE r.target_type = TG_ARGV[0]::report_target_type
                AND r.target_id = OLD.id AND r.reason = 'menor' AND r.status IN ('pendente', 'em_analise'))
     OR EXISTS (SELECT 1 FROM reports r WHERE r.target_type = TG_ARGV[0]::report_target_type
                AND r.target_id = OLD.id AND r.reason = 'menor' AND r.status = 'procedente')
     OR (COALESCE(current_setting('xclusive.admin_apaga', true), '') <> 'on'
         AND EXISTS (SELECT 1 FROM reports r WHERE r.target_type = TG_ARGV[0]::report_target_type
                     AND r.target_id = OLD.id AND r.status IN ('pendente', 'em_analise')))
  THEN
    RAISE EXCEPTION 'prova_protegida: % %', TG_ARGV[0], OLD.id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS proteger_prova_posts ON posts;
CREATE TRIGGER proteger_prova_posts BEFORE DELETE ON posts FOR EACH ROW EXECUTE FUNCTION proteger_prova('post');
DROP TRIGGER IF EXISTS proteger_prova_reels ON reels;
CREATE TRIGGER proteger_prova_reels BEFORE DELETE ON reels FOR EACH ROW EXECUTE FUNCTION proteger_prova('reel');
DROP TRIGGER IF EXISTS proteger_prova_stories ON stories;
CREATE TRIGGER proteger_prova_stories BEFORE DELETE ON stories FOR EACH ROW EXECUTE FUNCTION proteger_prova('story');
DROP TRIGGER IF EXISTS proteger_prova_comments ON comments;
CREATE TRIGGER proteger_prova_comments BEFORE DELETE ON comments FOR EACH ROW EXECUTE FUNCTION proteger_prova('comment');
DROP TRIGGER IF EXISTS proteger_prova_live ON live_streams;
CREATE TRIGGER proteger_prova_live BEFORE DELETE ON live_streams FOR EACH ROW EXECUTE FUNCTION proteger_prova('live');
