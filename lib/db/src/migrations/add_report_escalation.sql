-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: marcadores de escalada de denúncias urgentes
--
--  reports.escalada_1h_em / escalada_24h_em: preenchidos pelo job (lib/reportEscalation.ts) quando
--  avisa os admins de que uma denúncia urgente (categoria 'menor') continua 'pendente' ao fim de
--  1 h / 24 h. Garantem um único aviso por nível (idempotência).
--  reports.alerta_externo_em: preenchido quando o webhook externo foi entregue com sucesso; o job
--  reenvia as urgentes pendentes que ainda não o têm. Só ADICIONA colunas e um índice.
--
-- APLICAR MANUALMENTE:  psql $DATABASE_URL -f add_report_escalation.sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS escalada_1h_em  timestamp,
  ADD COLUMN IF NOT EXISTS escalada_24h_em timestamp,
  ADD COLUMN IF NOT EXISTS alerta_externo_em timestamp;

-- Fila de urgentes por tratar (acelera o job e o contador do dashboard)
CREATE INDEX IF NOT EXISTS reports_urgentes_pendentes_idx
  ON reports (criado_em)
  WHERE urgente = true AND status = 'pendente';

COMMIT;
