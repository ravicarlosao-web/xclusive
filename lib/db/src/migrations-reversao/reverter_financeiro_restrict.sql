-- ─────────────────────────────────────────────────────────────────────────────
-- REVERSÃO de add_financeiro_restrict.sql: volta a ON DELETE CASCADE nas 9 chaves estrangeiras (estado anterior). Idempotente. NÃO está na pasta migrations/ de propósito
-- (não corre nas bases novas). Só usar se a migração causar problemas; depois de reverter, apagar uma conta volta a apagar em cascata o dinheiro dela e das contrapartes.
-- ─────────────────────────────────────────────────────────────────────────────

-- Instrução 1 (aplicar sozinha):
  DO $$
  DECLARE r record;
  BEGIN
    FOR r IN
      SELECT c.conrelid::regclass::text AS tabela, c.conname, a.attname AS coluna, c.confrelid::regclass::text AS ref
        FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
       WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1 AND c.confdeltype <> 'c'
         AND (c.conrelid::regclass::text, a.attname, c.confrelid::regclass::text) IN (('purchases','comprador_id','users'),('purchases','vendedor_id','users'),('subscriptions','subscritor_id','users'),('subscriptions','criador_id','users'),('live_tips','remetente_id','users'),('live_tips','stream_id','live_streams'),('live_tickets','user_id','users'),('live_tickets','live_id','live_streams'),('topup_requests','user_id','users'))
    LOOP
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tabela, r.conname);
      EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %s (id) ON DELETE CASCADE', r.tabela, r.conname, r.coluna, r.ref);
    END LOOP;
  END $$;

-- Verificação (DEPOIS): as 9 linhas com regra «c».
SELECT c.conrelid::regclass AS tabela, a.attname AS coluna, c.confrelid::regclass AS referencia, c.confdeltype AS regra FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1] WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1 AND (c.conrelid::regclass::text, a.attname, c.confrelid::regclass::text) IN (('purchases','comprador_id','users'),('purchases','vendedor_id','users'),('subscriptions','subscritor_id','users'),('subscriptions','criador_id','users'),('live_tips','remetente_id','users'),('live_tips','stream_id','live_streams'),('live_tickets','user_id','users'),('live_tickets','live_id','live_streams'),('topup_requests','user_id','users')) ORDER BY 1, 2;
