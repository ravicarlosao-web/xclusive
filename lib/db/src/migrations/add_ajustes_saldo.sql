-- ─────────────────────────────────────────────────────────────────────────────
-- Migration (ADITIVA): ajustes manuais de admin como linha financeira própria (tabela ajustes_saldo)
--
-- Cria a tabela dos ajustes (utilizador e admin com FK RESTRICT, campo ajustado, valor COM SINAL, saldo antes/depois, motivo, ligação ao audit_log com SET NULL).
-- Nasce VAZIA: não há backfill dos ajustes antigos do audit_log (o financeiro foi zerado antes de existir esta tabela). Não altera nem apaga dados.
-- Aplicar ANTES do deploy do código novo (a rota do ajuste e o extrato leem/escrevem esta tabela). Reversão: lib/db/src/migrations-reversao/reverter_ajustes_saldo.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- Pré-verificação (ANTES): 0 = a tabela ainda não existe.
SELECT count(*) AS tabela_ja_existe FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ajustes_saldo';

-- Instrução 1 (aplicar sozinha):
CREATE TABLE IF NOT EXISTS ajustes_saldo (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  campo varchar(10) NOT NULL,
  valor numeric(12, 2) NOT NULL,
  saldo_antes numeric(12, 2) NOT NULL,
  saldo_depois numeric(12, 2) NOT NULL,
  motivo text,
  admin_id integer NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  audit_id integer REFERENCES audit_log (id) ON DELETE SET NULL,
  criado_em timestamp NOT NULL DEFAULT now(),
  CONSTRAINT ajustes_saldo_campo_chk CHECK (campo IN ('saldo', 'ganhos')),
  CONSTRAINT ajustes_saldo_valor_chk CHECK (valor <> 0)
);

-- Instrução 2 (aplicar sozinha):
CREATE INDEX IF NOT EXISTS ajustes_saldo_user_idx ON ajustes_saldo (user_id, criado_em);

-- Verificação (DEPOIS): tabela criada, 0 linhas.
SELECT count(*) AS linhas FROM ajustes_saldo;
SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'ajustes_saldo' ORDER BY ordinal_position;
