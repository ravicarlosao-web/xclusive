-- ─────────────────────────────────────────────────────────────────────────────
-- Migration (ADITIVA): infrações da regra do conteúdo +18 (PR A: base no servidor)
--
-- Regista cada vez que um admin marca como +18 conteúdo que a criadora não tinha marcado.
--   1.ª e 2.ª infração ativa = aviso; da 3.ª em diante = suspensão da conta (n >= 3).
--   Os avisos não caducam; só o admin as pode anular (ficam registadas, deixam de contar).
--
-- Regras de integridade:
--   * UMA infração ativa por conteúdo (índice único parcial): o mesmo conteúdo não conta duas vezes.
--   * `numero` = nº de infrações ativas da criadora DEPOIS desta (não é único: anular e voltar a contar repete-o).
--   * A atomicidade da contagem vem do lock da linha da criadora (FOR UPDATE) feito pela aplicação.
--
-- Sem BEGIN/COMMIT (cada instrução é idempotente). Pode correr-se mais de uma vez.
-- APLICAR MANUALMENTE:  psql $DATABASE_URL -f add_infracoes_mais18.sql
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS infracoes_mais18 (
  id             serial       PRIMARY KEY,
  user_id        integer      NOT NULL REFERENCES users(id),
  tipo_conteudo  varchar(10)  NOT NULL CHECK (tipo_conteudo IN ('post', 'reel', 'story', 'live')),
  conteudo_id    integer      NOT NULL,
  admin_id       integer      NOT NULL REFERENCES users(id),
  report_id      integer      REFERENCES reports(id) ON DELETE SET NULL,
  origem         varchar(10)  NOT NULL CHECK (origem IN ('admin', 'denuncia')),
  numero         integer      NOT NULL CHECK (numero >= 1),
  acao           varchar(10)  NOT NULL CHECK (acao IN ('aviso', 'suspensao')),
  motivo         text,
  criada_em      timestamp    NOT NULL DEFAULT now(),
  anulada_em     timestamp,
  anulada_por    integer      REFERENCES users(id),
  anulada_motivo text
);

CREATE INDEX IF NOT EXISTS infracoes_mais18_user_idx ON infracoes_mais18 (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS infracoes_mais18_uma_ativa_por_conteudo
  ON infracoes_mais18 (tipo_conteudo, conteudo_id)
  WHERE anulada_em IS NULL;
