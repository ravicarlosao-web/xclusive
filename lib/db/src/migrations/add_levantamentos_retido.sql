-- ─────────────────────────────────────────────────────────────────────────────
-- Migration (ADITIVA): estado "retido" nos levantamentos (Termos para Criadoras, Art. 6.º)
--
--   * withdrawal_status ganha o valor 'retido' (pendente|aprovado → retido → aprovado|rejeitado);
--   * withdrawal_requests.retido_em / retido_por / retido_motivo: quando, quem e porquê (o motivo é interno por defeito);
--   * withdrawal_requests.retido_motivo_visivel: false = a criadora não vê o motivo (restrição legal).
--
-- O valor novo NÃO é usado em nenhum índice nem CHECK deste script (o Postgres não deixa usar um valor de enum
-- acabado de criar na mesma transação). Por isso o ficheiro pode ir todo numa só colagem no SQL Editor, mesmo que
-- este o execute numa transação (Postgres 12 ou superior, o caso da Neon). Sem BEGIN/COMMIT.
-- Não altera nem apaga dados existentes.
-- APLICAR MANUALMENTE (Neon, antes do merge): psql $DATABASE_URL -f lib/db/src/migrations/add_levantamentos_retido.sql
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TYPE withdrawal_status ADD VALUE IF NOT EXISTS 'retido';

ALTER TABLE withdrawal_requests
  ADD COLUMN IF NOT EXISTS retido_em timestamp,
  ADD COLUMN IF NOT EXISTS retido_por integer REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS retido_motivo text,
  ADD COLUMN IF NOT EXISTS retido_motivo_visivel boolean NOT NULL DEFAULT true;
