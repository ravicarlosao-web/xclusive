-- ─────────────────────────────────────────────────────────────────────────────
-- REVERSÃO de add_schema_migracoes.sql: apaga a tabela de registo das migrações (schema_migracoes).
-- Nada da aplicação depende dela (só o script scripts/verificar-migracoes.mjs a consulta; sem a tabela a guarda recusa o deploy e diz como a instalar,
-- ou usa-se PULAR_GUARDA_MIGRACOES=1 numa emergência). Perde-se só o REGISTO (que ficheiros foram aplicados), nunca dados da plataforma.
-- ─────────────────────────────────────────────────────────────────────────────

-- Pré-verificação (ANTES): quantas linhas de registo vão ser apagadas (só informação).
SELECT count(*) AS linhas_de_registo FROM schema_migracoes;

-- Instrução 1 (aplicar sozinha):
DROP TABLE IF EXISTS schema_migracoes;

-- Verificação (DEPOIS): 0 = a tabela já não existe.
SELECT count(*) AS tabela_ainda_existe FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schema_migracoes';
