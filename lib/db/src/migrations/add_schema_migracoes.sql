-- ─────────────────────────────────────────────────────────────────────────────
-- Migration (ADITIVA): registo das migrações aplicadas (schema_migracoes) — a «guarda de migrações» do deploy
--
-- Cria 1 tabela NOVA e vazia: schema_migracoes (nome do ficheiro .sql, data em que foi aplicado). A APLICAÇÃO NÃO a lê nem a escreve: só o script de leitura
-- scripts/verificar-migracoes.mjs (chamado pelo deploy ANTES do build e do pm2 restart) a consulta, para recusar o deploy quando há ficheiros em lib/db/src/migrations que não estão registados
-- (lição do #138: o código foi para produção antes de a migração estar aplicada). Não altera nem apaga nada que já exista.
-- Procedimento completo (baseline das migrações antigas, instalação no deploy): docs/deploy/guarda-migracoes.md. Reversão: lib/db/src/migrations-reversao/reverter_schema_migracoes.sql.
--
-- CONVENÇÃO (obrigatória para as migrações NOVAS, verificada por um teste): cada ficheiro .sql de migração termina com
--   INSERT INTO schema_migracoes (nome) VALUES ('<nome-do-ficheiro>.sql') ON CONFLICT DO NOTHING;
-- (esta migração é a primeira a cumpri-la).
-- ─────────────────────────────────────────────────────────────────────────────

-- Pré-verificação (ANTES): 0 = a tabela ainda não existe.
SELECT count(*) AS tabela_ja_existe FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schema_migracoes';

-- Instrução 1 (aplicar sozinha):
CREATE TABLE IF NOT EXISTS schema_migracoes (
  nome text PRIMARY KEY,
  aplicada_em timestamptz NOT NULL DEFAULT now()
);

-- Instrução 2 (aplicar sozinha): regista-se a si própria (convenção).
INSERT INTO schema_migracoes (nome) VALUES ('add_schema_migracoes.sql') ON CONFLICT DO NOTHING;

-- Verificação (DEPOIS): a tabela existe e tem, pelo menos, esta linha.
SELECT nome, aplicada_em FROM schema_migracoes ORDER BY aplicada_em, nome;
