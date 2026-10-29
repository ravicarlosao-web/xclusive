-- ─────────────────────────────────────────────────────────────────────────────
-- Migration (ADITIVA): enquetes (posts com pergunta e 2 a 4 opções)
--
-- Uma enquete é um post de texto (posts.tipo = 'texto') com uma linha em `enquetes`; a pergunta é a legenda do post.
--   enquetes         1:1 com o post (post_id único), audiência ('todos' | 'seguidores') e fim (termina_em).
--   enquete_opcoes   2 a 4 opções por enquete (ordem 0 a 3, texto de 1 a 60 caracteres; o número mínimo/máximo é validado na aplicação).
--   enquete_votos    um voto por conta e enquete (UNIQUE enquete_id + user_id); a FK composta garante que a opção
--                    pertence à enquete. user_id fica NULL se a conta for apagada (os totais mantêm-se, o voto fica anónimo).
-- Ao apagar o post (cascata) apagam-se a enquete, as opções e os votos; o trigger proteger_prova continua a bloquear o
-- apagamento de posts protegidos, por isso nada disto se perde por cascata. Não há triggers novos.
-- Não altera nem apaga dados existentes. Sem BEGIN/COMMIT. Idempotente.
-- APLICAR MANUALMENTE (Neon, antes do merge): psql $DATABASE_URL -f lib/db/src/migrations/add_enquetes.sql
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS enquetes (
  id          serial PRIMARY KEY,
  post_id     integer NOT NULL UNIQUE REFERENCES posts(id) ON DELETE CASCADE,
  audiencia   text NOT NULL DEFAULT 'todos',
  termina_em  timestamp NOT NULL,
  criado_em   timestamp NOT NULL DEFAULT now(),
  CONSTRAINT enquetes_audiencia_check CHECK (audiencia IN ('todos', 'seguidores'))
);

CREATE TABLE IF NOT EXISTS enquete_opcoes (
  id          serial PRIMARY KEY,
  enquete_id  integer NOT NULL REFERENCES enquetes(id) ON DELETE CASCADE,
  ordem       integer NOT NULL,
  texto       text NOT NULL,
  CONSTRAINT enquete_opcoes_ordem_unica UNIQUE (enquete_id, ordem),
  CONSTRAINT enquete_opcoes_id_enquete_unica UNIQUE (id, enquete_id),
  CONSTRAINT enquete_opcoes_ordem_check CHECK (ordem BETWEEN 0 AND 3),
  CONSTRAINT enquete_opcoes_texto_check CHECK (char_length(texto) BETWEEN 1 AND 60)
);

CREATE TABLE IF NOT EXISTS enquete_votos (
  id          serial PRIMARY KEY,
  enquete_id  integer NOT NULL,
  opcao_id    integer NOT NULL,
  user_id     integer REFERENCES users(id) ON DELETE SET NULL,
  criado_em   timestamp NOT NULL DEFAULT now(),
  CONSTRAINT enquete_votos_unico UNIQUE (enquete_id, user_id),
  CONSTRAINT enquete_votos_opcao_fk FOREIGN KEY (opcao_id, enquete_id)
    REFERENCES enquete_opcoes (id, enquete_id) ON DELETE CASCADE,
  CONSTRAINT enquete_votos_enquete_fk FOREIGN KEY (enquete_id)
    REFERENCES enquetes (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS enquete_votos_opcao_idx ON enquete_votos (opcao_id);
CREATE INDEX IF NOT EXISTS enquete_votos_user_idx  ON enquete_votos (user_id) WHERE user_id IS NOT NULL;
