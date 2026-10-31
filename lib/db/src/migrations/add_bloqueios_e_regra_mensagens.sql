-- ─────────────────────────────────────────────────────────────────────────────
-- Migration (ADITIVA): segurança das mensagens privadas — PR 1 (bloqueio + quem pode escrever)
--
--   1. tabela user_blocks (bloqueios; afetam SÓ mensagens e novas conversas);
--   2. coluna users.quem_pode_escrever ('todos' | 'seguidores_assinantes' | 'assinantes'), DEFAULT 'todos' para TODOS;
--   3. índices: messages (conversa), conversation_participants (único por conversa+utilizador), subscriptions (subscritor+criador).
--
-- Não altera nem apaga dados. Sem BEGIN/COMMIT (compatível com o Neon SQL Editor). Todas as instruções são idempotentes.
-- APLICAR MANUALMENTE (Neon, ANTES de fazer deploy do backend do PR).
--
-- PRÉ-VERIFICAÇÃO (só leitura; a primeira TEM de dar 0 antes do índice único; se der > 0, parar e avisar):
--   select count(*) from (select conversation_id, utilizador_id from conversation_participants
--                         group by 1, 2 having count(*) > 1) d;
--   select count(*) from conversations where tipo = 'grupo';   -- informativo: o código só lida com conversas 1:1
--
-- NOTA: em tabelas grandes os 2 índices de `messages` podem criar-se com CREATE INDEX CONCURRENTLY (uma instrução por execução).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id integer   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id integer   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  criado_em  timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_blocks_nao_a_si_proprio CHECK (blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx ON user_blocks (blocked_id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS quem_pode_escrever varchar(24) NOT NULL DEFAULT 'todos';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_quem_pode_escrever_chk;
ALTER TABLE users ADD CONSTRAINT users_quem_pode_escrever_chk
  CHECK (quem_pode_escrever IN ('todos', 'seguidores_assinantes', 'assinantes'));

CREATE INDEX IF NOT EXISTS messages_conversa_id_idx    ON messages (conversation_id, id);
CREATE INDEX IF NOT EXISTS messages_conversa_autor_idx ON messages (conversation_id, autor_id);
CREATE UNIQUE INDEX IF NOT EXISTS conv_participants_unico ON conversation_participants (conversation_id, utilizador_id);
CREATE INDEX IF NOT EXISTS subscriptions_subscritor_criador_idx ON subscriptions (subscritor_id, criador_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO (correr depois; só leitura)
--
--   select to_regclass('public.user_blocks');                                                  -- user_blocks
--   select column_name, data_type, column_default, is_nullable from information_schema.columns
--     where table_name = 'users' and column_name = 'quem_pode_escrever';                       -- varchar, 'todos', NO
--   select conname from pg_constraint
--     where conname in ('users_quem_pode_escrever_chk', 'user_blocks_nao_a_si_proprio');       -- 2 linhas
--   select indexname from pg_indexes where indexname in ('user_blocks_blocked_idx', 'messages_conversa_id_idx',
--     'messages_conversa_autor_idx', 'conv_participants_unico', 'subscriptions_subscritor_criador_idx'); -- 5 linhas
--   select quem_pode_escrever, count(*) from users group by 1;                                 -- só 'todos'
--   select count(*) from user_blocks;                                                          -- 0
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- DEPOIS DO FRONT (NÃO correr agora; o utilizador corre quando o PR de frontend estiver em produção):
-- passa os criadores EXISTENTES a "só seguidores e assinantes". Criadores novos já nascem assim (tornar-criador).
--
-- -- UPDATE users SET quem_pode_escrever = 'seguidores_assinantes' WHERE tipo_conta = 'criador';
-- ─────────────────────────────────────────────────────────────────────────────
