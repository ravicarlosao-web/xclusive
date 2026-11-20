-- ─────────────────────────────────────────────────────────────────────────────
-- Migration (ADITIVA): carregamento automático de saldo pela kursiPay (só entradas)
--
-- Cria 2 tabelas NOVAS e vazias: kursipay_pagamentos (um pagamento kursiPay por pedido de carregamento: id pay_… único, ambiente, valor em CÊNTIMOS INTEIROS, moeda, estado)
-- e kursipay_eventos (webhooks já processados; o id evt_… é a chave única). FKs RESTRICT para users e topup_requests (como as outras tabelas financeiras).
-- Não altera nem apaga nada que já exista (topup_requests.payment_method é varchar(10) e passa a poder valer «kursipay», sem alteração de esquema). O código só usa estas tabelas
-- quando a definição topup_kursipay_ativo estiver ligada ou houver pagamentos kursiPay para o webhook processar.
-- Aplicar ANTES do deploy do código novo (lição do #138; a guarda de migrações do deploy recusa se faltar). Reversão: lib/db/src/migrations-reversao/reverter_kursipay.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- Pré-verificação (ANTES): 0 = as tabelas ainda não existem.
SELECT count(*) AS tabelas_ja_existem FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('kursipay_pagamentos', 'kursipay_eventos');

-- Instrução 1 (aplicar sozinha):
CREATE TABLE IF NOT EXISTS kursipay_pagamentos (
  id serial PRIMARY KEY,
  topup_request_id integer NOT NULL UNIQUE REFERENCES topup_requests (id) ON DELETE RESTRICT,
  user_id integer NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  kursipay_id varchar(40) UNIQUE,
  ambiente varchar(12) NOT NULL CHECK (ambiente IN ('sandbox', 'production')),
  valor_centimos bigint NOT NULL CHECK (valor_centimos > 0),
  moeda varchar(3) NOT NULL,
  estado varchar(24) NOT NULL DEFAULT 'a_criar',
  checkout_url text,
  criado_em timestamp NOT NULL DEFAULT now(),
  atualizado_em timestamp NOT NULL DEFAULT now(),
  pago_em timestamp
);

-- Instrução 2 (aplicar sozinha):
CREATE INDEX IF NOT EXISTS kursipay_pagamentos_user_idx ON kursipay_pagamentos (user_id);

-- Instrução 3 (aplicar sozinha):
CREATE TABLE IF NOT EXISTS kursipay_eventos (
  evento_id varchar(40) PRIMARY KEY,
  tipo varchar(40) NOT NULL,
  kursipay_pagamento_id varchar(40),
  ambiente varchar(12),
  resultado varchar(30) NOT NULL,
  recebido_em timestamp NOT NULL DEFAULT now()
);

-- Instrução 4 (aplicar sozinha): regista-se a si própria (convenção da guarda de migrações).
INSERT INTO schema_migracoes (nome) VALUES ('add_kursipay.sql') ON CONFLICT DO NOTHING;

-- Verificação (DEPOIS): as 2 tabelas existem e estão vazias.
SELECT (SELECT count(*) FROM kursipay_pagamentos) AS pagamentos, (SELECT count(*) FROM kursipay_eventos) AS eventos;
SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name IN ('kursipay_pagamentos', 'kursipay_eventos') ORDER BY table_name, ordinal_position;
