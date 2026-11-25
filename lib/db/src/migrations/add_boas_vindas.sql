-- ─────────────────────────────────────────────────────────────────────────────
-- Migration (ADITIVA): mensagem automática de boas-vindas da criadora (PR 1 de 2: servidor).
--
-- Cria 2 tabelas NOVAS e vazias: boas_vindas_config (uma por criadora) e boas_vindas_envios (um envio por par criadora-seguidor, para sempre;
-- serve também de fila e de registo do resultado). NÃO altera nem apaga nenhuma tabela ou linha existente (nem a de mensagens).
-- O envio está DESLIGADO por omissão: só funciona quando platform_settings tiver ('boas_vindas_ativas', '{"value": true}') — esta migração NÃO o cria.
-- Aplicar ANTES do deploy do código novo (o seguir passa a escrever em boas_vindas_envios quando o interruptor estiver ligado; com ele desligado o código
-- só LÊ platform_settings). Reversão: lib/db/src/migrations-reversao/reverter_boas_vindas.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- Pré-verificação (ANTES): 0 e 0 = as tabelas ainda não existem.
SELECT count(*) FILTER (WHERE table_name = 'boas_vindas_config') AS config_ja_existe,
       count(*) FILTER (WHERE table_name = 'boas_vindas_envios') AS envios_ja_existe
FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('boas_vindas_config', 'boas_vindas_envios');

-- Instrução 1 (aplicar sozinha): a configuração da criadora.
CREATE TABLE IF NOT EXISTS boas_vindas_config (
  criadora_id integer PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  texto text NOT NULL DEFAULT '',
  midia_tipo varchar(10) NOT NULL DEFAULT 'nenhuma',
  midia_url text,
  ativa boolean NOT NULL DEFAULT false,
  desativada_admin_em timestamp,
  desativada_admin_por integer REFERENCES users (id) ON DELETE SET NULL,
  desativada_admin_motivo text,
  criado_em timestamp NOT NULL DEFAULT now(),
  atualizado_em timestamp NOT NULL DEFAULT now(),
  CONSTRAINT boas_vindas_config_texto_chk CHECK (char_length(texto) <= 1000),
  CONSTRAINT boas_vindas_config_midia_chk CHECK (midia_tipo IN ('nenhuma', 'imagem') AND ((midia_tipo = 'nenhuma') = (midia_url IS NULL))),
  CONSTRAINT boas_vindas_config_conteudo_chk CHECK (ativa = false OR texto <> '' OR midia_tipo <> 'nenhuma')
);

-- Instrução 2 (aplicar sozinha): os envios (fila + resultado). UNIQUE (criadora, seguidor) = uma só mensagem por par, para sempre.
CREATE TABLE IF NOT EXISTS boas_vindas_envios (
  id serial PRIMARY KEY,
  criadora_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  seguidor_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  estado varchar(12) NOT NULL DEFAULT 'pendente',
  motivo varchar(40),
  tentativas integer NOT NULL DEFAULT 0,
  texto text NOT NULL DEFAULT '',
  midia_url text,
  proxima_em timestamp NOT NULL DEFAULT now(),
  message_id integer REFERENCES messages (id) ON DELETE SET NULL,
  criado_em timestamp NOT NULL DEFAULT now(),
  enviado_em timestamp,
  CONSTRAINT boas_vindas_envios_par_uq UNIQUE (criadora_id, seguidor_id),
  CONSTRAINT boas_vindas_envios_estado_chk CHECK (estado IN ('pendente', 'enviada', 'ignorada', 'falhada', 'descartada')),
  CONSTRAINT boas_vindas_envios_par_chk CHECK (criadora_id <> seguidor_id)
);

-- Instrução 3 (aplicar sozinha): índices (fila, limites por seguidor e por criadora, ligação à mensagem).
CREATE INDEX IF NOT EXISTS boas_vindas_envios_pendentes_idx ON boas_vindas_envios (proxima_em) WHERE estado = 'pendente';
CREATE INDEX IF NOT EXISTS boas_vindas_envios_seguidor_idx ON boas_vindas_envios (seguidor_id, enviado_em) WHERE estado = 'enviada';
CREATE INDEX IF NOT EXISTS boas_vindas_envios_criadora_idx ON boas_vindas_envios (criadora_id, enviado_em) WHERE estado = 'enviada';
CREATE INDEX IF NOT EXISTS boas_vindas_envios_message_idx ON boas_vindas_envios (message_id);

-- Instrução 4 (aplicar sozinha): registo da migração (guarda de migrações do deploy).
INSERT INTO schema_migracoes (nome) VALUES ('add_boas_vindas.sql') ON CONFLICT DO NOTHING;

-- Verificação (DEPOIS): as duas tabelas existem, vazias; o interruptor continua ausente (= desligado).
SELECT (SELECT count(*) FROM boas_vindas_config) AS configs, (SELECT count(*) FROM boas_vindas_envios) AS envios,
       (SELECT count(*) FROM platform_settings WHERE key = 'boas_vindas_ativas') AS interruptor_existe;
SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name IN ('boas_vindas_config', 'boas_vindas_envios') ORDER BY table_name, ordinal_position;
