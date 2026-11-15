# Financeiro: reconciliação, ajustes e regra operacional

## Como o saldo é explicado (fórmula única)

`scripts/financeiro-formula.mjs` é a única definição (usada por `zerar-financeiro.mjs` e `reconciliar-saldos.mjs`):

- **saldo** = Σ carregamentos aprovados − Σ compras como comprador + Σ ajustes do admin (`campo = 'saldo'`)
- **ganhos** = Σ vendas líquidas (valor − comissão) − Σ levantamentos não rejeitados + Σ ajustes do admin (`campo = 'ganhos'`)

## Ajustes manuais de admin (`ajustes_saldo`)

O ajuste manual do admin é uma linha financeira própria (conta ajustada e admin com chave RESTRICT, campo, valor com sinal, saldo antes/depois, motivo, ligação ao `audit_log`), escrita na **mesma transação** do UPDATE do saldo. O `audit_log` continua a registar a ação, mas pode ser apagado; a tabela não. Aparece no extrato do utilizador como «Ajuste de saldo» (só data e valor) e no separador Financeiro da conta, no painel de admin.

**Sem backfill:** a tabela começou vazia de propósito. Os ajustes antigos só existem no `audit_log` e o financeiro foi zerado antes de a tabela existir. A fórmula **não** conta esses ajustes antigos; quem quiser investigá-los usa `reconciliar-saldos.mjs --incluir-audit-legado`.

## Histórico protegido contra CASCADE

Apagar uma conta já não apaga, em cascata, o dinheiro dela nem o das contrapartes: as chaves estrangeiras das tabelas financeiras para `users` (e para `live_streams`) são `RESTRICT`. Só o script `apagar-contas-teste.mjs` apaga contas (a rota de admin só desativa); ele apaga primeiro as linhas financeiras da conta, na ordem certa e na mesma transação, e mantém as travas (recusa se houver linhas com contas fora da lista).

## `reconciliar-saldos.mjs` (só de leitura)

```
pnpm --filter @workspace/scripts exec tsx reconciliar-saldos.mjs            # tabela legível
pnpm --filter @workspace/scripts exec tsx reconciliar-saldos.mjs --json     # JSON
```

Corre numa transação `READ ONLY`: a base de dados recusa qualquer escrita. Código de saída: 0 = tudo certo, 1 = há desvios ou achados, 2 = erro de uso, 3 = erro de ligação. Aponta contas em desvio (guardado, calculado, diferença), saldos/ganhos negativos, carregamentos aprovados sem marca de aprovação e linhas financeiras que apontam para contas ou lives inexistentes.

**Quando correr:** (1) **antes de aceitar dinheiro real** (tem de dar 0), (2) depois de qualquer intervenção manual na base de dados e (3) periodicamente (por exemplo, diariamente). Um desvio não se «corrige» a gosto: investiga-se primeiro (a linha do tempo da conta, o `audit_log`, as linhas apagadas) e só depois se decide.

## Regra operacional

**Nada de `UPDATE users SET saldo/ganhos` nem de `DELETE`/`UPDATE` em tabelas financeiras diretamente na Neon** (`purchases`, `subscriptions`, `live_tips`, `live_tickets`, `message_tips`, `topup_requests`, `withdrawal_requests`, `ajustes_saldo`). Tudo passa pela aplicação (rotas do painel, que deixam linha e auditoria) ou por um script com trava (`zerar-financeiro.mjs`, `apagar-contas-teste.mjs`). Nesta fase não há triggers que o imponham: é uma regra de operação, e a reconciliação é o que deteta uma violação.
