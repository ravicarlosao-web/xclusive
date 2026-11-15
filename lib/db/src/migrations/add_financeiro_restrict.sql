-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: histórico financeiro protegido contra CASCADE (ON DELETE CASCADE → ON DELETE RESTRICT)
--
-- Apagar uma conta deixa de apagar, em cascata, as linhas de dinheiro (dela e das contrapartes). FKs alteradas (tabela.coluna → referência: antes → depois):
--   purchases.comprador_id        → users          CASCADE → RESTRICT
--   purchases.vendedor_id         → users          CASCADE → RESTRICT
--   subscriptions.subscritor_id   → users          CASCADE → RESTRICT
--   subscriptions.criador_id      → users          CASCADE → RESTRICT
--   live_tips.remetente_id        → users          CASCADE → RESTRICT
--   live_tips.stream_id           → live_streams   CASCADE → RESTRICT
--   live_tickets.user_id          → users          CASCADE → RESTRICT
--   live_tickets.live_id          → live_streams   CASCADE → RESTRICT
--   topup_requests.user_id        → users          CASCADE → RESTRICT
-- Já estavam protegidas (não mudam): message_tips.* (RESTRICT); withdrawal_requests.creator_id/processed_by e topup_requests.processado_por (NO ACTION, que também recusa).
-- Não mudam (não são linhas de dinheiro): notificações, subscription_plans, creator_payout_accounts, kyc_submissions, retido_por (SET NULL), live_tickets.purchase_id (SET NULL).
--
-- Não altera dados. Idempotente (só mexe numa FK que ainda não é RESTRICT; encontra-a pela tabela/coluna, não pelo nome). Uma instrução; bloqueia brevemente cada tabela
-- (ALTER TABLE) e valida as linhas existentes. Aplicar fora de picos. Reversão: lib/db/src/migrations-reversao/reverter_financeiro_restrict.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- Pré-verificação 1 (ANTES): regra atual de cada FK (c = CASCADE, r = RESTRICT, a = NO ACTION, n = SET NULL). Esperado antes: c nas 9; depois: r nas 9.
SELECT c.conrelid::regclass AS tabela, a.attname AS coluna, c.confrelid::regclass AS referencia, c.conname, c.confdeltype AS regra
  FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
 WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1
   AND (c.conrelid::regclass::text, a.attname, c.confrelid::regclass::text) IN (
       ('purchases','comprador_id','users'),('purchases','vendedor_id','users'),('subscriptions','subscritor_id','users'),('subscriptions','criador_id','users'),('live_tips','remetente_id','users'),('live_tips','stream_id','live_streams'),('live_tickets','user_id','users'),('live_tickets','live_id','live_streams'),('topup_requests','user_id','users'))
 ORDER BY 1, 2;

-- Pré-verificação 2 (ANTES): linhas órfãs, isto é, a apontar para contas ou lives que já não existem. Esperado: TODAS a 0 (se não, o ADD CONSTRAINT falha e nada muda).
SELECT 'purchases.comprador_id' AS fk, count(*) AS orfas FROM purchases p WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p.comprador_id)
UNION ALL SELECT 'purchases.vendedor_id', count(*) FROM purchases p WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p.vendedor_id)
UNION ALL SELECT 'subscriptions.subscritor_id', count(*) FROM subscriptions s WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = s.subscritor_id)
UNION ALL SELECT 'subscriptions.criador_id', count(*) FROM subscriptions s WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = s.criador_id)
UNION ALL SELECT 'live_tips.remetente_id', count(*) FROM live_tips t WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t.remetente_id)
UNION ALL SELECT 'live_tips.stream_id', count(*) FROM live_tips t WHERE NOT EXISTS (SELECT 1 FROM live_streams l WHERE l.id = t.stream_id)
UNION ALL SELECT 'live_tickets.user_id', count(*) FROM live_tickets t WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t.user_id)
UNION ALL SELECT 'live_tickets.live_id', count(*) FROM live_tickets t WHERE NOT EXISTS (SELECT 1 FROM live_streams l WHERE l.id = t.live_id)
UNION ALL SELECT 'topup_requests.user_id', count(*) FROM topup_requests t WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t.user_id);

-- Instrução 1 (aplicar sozinha):
  DO $$
  DECLARE r record;
  BEGIN
    FOR r IN
      SELECT c.conrelid::regclass::text AS tabela, c.conname, a.attname AS coluna, c.confrelid::regclass::text AS ref
        FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
       WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1 AND c.confdeltype <> 'r'
         AND (c.conrelid::regclass::text, a.attname, c.confrelid::regclass::text) IN (('purchases','comprador_id','users'),('purchases','vendedor_id','users'),('subscriptions','subscritor_id','users'),('subscriptions','criador_id','users'),('live_tips','remetente_id','users'),('live_tips','stream_id','live_streams'),('live_tickets','user_id','users'),('live_tickets','live_id','live_streams'),('topup_requests','user_id','users'))
    LOOP
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tabela, r.conname);
      EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %s (id) ON DELETE RESTRICT', r.tabela, r.conname, r.coluna, r.ref);
    END LOOP;
  END $$;

-- Verificação (DEPOIS): as 9 linhas com regra «r».
SELECT c.conrelid::regclass AS tabela, a.attname AS coluna, c.confrelid::regclass AS referencia, c.confdeltype AS regra
  FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
 WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1
   AND (c.conrelid::regclass::text, a.attname, c.confrelid::regclass::text) IN (('purchases','comprador_id','users'),('purchases','vendedor_id','users'),('subscriptions','subscritor_id','users'),('subscriptions','criador_id','users'),('live_tips','remetente_id','users'),('live_tips','stream_id','live_streams'),('live_tickets','user_id','users'),('live_tickets','live_id','live_streams'),('topup_requests','user_id','users'))
 ORDER BY 1, 2;
