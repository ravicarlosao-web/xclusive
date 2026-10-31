-- ─────────────────────────────────────────────────────────────────────────────
-- Migration (ADITIVA): gorjeta nas mensagens privadas — PR A (backend)
--
--   1. message_tipo ganha 'gorjeta' e notification_tipo ganha 'gorjeta_recebida';
--   2. tabela message_tips: liga a mensagem 'gorjeta' à transação em purchases (o ledger) e guarda a chave de idempotência.
--      ON DELETE RESTRICT: a prova financeira nunca se apaga por cascata (uma mensagem, conversa ou conta com gorjetas não se apaga).
--
-- Não altera nem apaga dados. Sem BEGIN/COMMIT (compatível com o Neon SQL Editor). Idempotente.
-- APLICAR MANUALMENTE (Neon, ANTES de fazer deploy do backend do PR).
--
-- ⚠ PASSO A: cada ALTER TYPE ... ADD VALUE tem de correr SOZINHO (uma instrução por execução) e ANTES do passo B.
-- ─────────────────────────────────────────────────────────────────────────────

-- PASSO A1 (sozinha):
ALTER TYPE message_tipo ADD VALUE IF NOT EXISTS 'gorjeta';

-- PASSO A2 (sozinha):
ALTER TYPE notification_tipo ADD VALUE IF NOT EXISTS 'gorjeta_recebida';

-- PASSO B (depois, numa execução à parte):
CREATE TABLE IF NOT EXISTS message_tips (
  id                 serial PRIMARY KEY,
  message_id         integer       NOT NULL UNIQUE REFERENCES messages(id)      ON DELETE RESTRICT,
  conversation_id    integer       NOT NULL        REFERENCES conversations(id) ON DELETE RESTRICT,
  remetente_id       integer       NOT NULL        REFERENCES users(id)         ON DELETE RESTRICT,
  criador_id         integer       NOT NULL        REFERENCES users(id)         ON DELETE RESTRICT,
  purchase_id        integer       NOT NULL UNIQUE REFERENCES purchases(id)     ON DELETE RESTRICT,
  valor              numeric(10,2) NOT NULL,
  comissao           numeric(10,2) NOT NULL,
  taxa_comissao      numeric(5,2)  NOT NULL,
  chave_idempotencia varchar(64)   NOT NULL,
  pedido_hash        varchar(64)   NOT NULL,
  criado_em          timestamp     NOT NULL DEFAULT now(),
  CONSTRAINT message_tips_remetente_chave_uq UNIQUE (remetente_id, chave_idempotencia),
  CONSTRAINT message_tips_valor_chk          CHECK (valor > 0),
  CONSTRAINT message_tips_comissao_chk       CHECK (comissao >= 0 AND comissao <= valor),
  CONSTRAINT message_tips_nao_a_si_proprio   CHECK (remetente_id <> criador_id)
);
CREATE INDEX IF NOT EXISTS message_tips_conversa_idx ON message_tips (conversation_id);
CREATE INDEX IF NOT EXISTS message_tips_criador_idx  ON message_tips (criador_id, criado_em);

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO (correr depois; só leitura)
--
--   select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
--     where t.typname in ('message_tipo', 'notification_tipo') and enumlabel in ('gorjeta', 'gorjeta_recebida');  -- 2 linhas
--   select to_regclass('public.message_tips');                                                                   -- message_tips
--   select conname from pg_constraint where conrelid = 'public.message_tips'::regclass order by 1;
--     -- message_tips_comissao_chk, _conversation_id_fkey, _criador_id_fkey, _message_id_fkey, _message_id_key, _nao_a_si_proprio,
--     -- _pkey, _purchase_id_fkey, _purchase_id_key, _remetente_chave_uq, _remetente_id_fkey, _valor_chk
--   select indexname from pg_indexes where tablename = 'message_tips' order by 1;                              -- inclui conversa_idx e criador_idx
--   select count(*) from message_tips;                                                                          -- 0
--   -- coerência (TÊM de dar 0, também depois de haver gorjetas):
--   select count(*) from message_tips t left join purchases p on p.id = t.purchase_id
--     where p.id is null or p.valor <> t.valor or p.comissao <> t.comissao;
--   select count(*) from messages m where m.tipo = 'gorjeta'
--     and not exists (select 1 from message_tips t where t.message_id = m.id);
-- ─────────────────────────────────────────────────────────────────────────────
