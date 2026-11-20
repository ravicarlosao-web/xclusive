# kursiPay — carregamento automático de saldo (SANDBOX)

Estado: **só sandbox**. Nada de `kp_live_` até cumprir o **portão de produção** (fim deste documento).
Só há entradas de dinheiro: o código nunca chama endpoints de reembolso.

## Como funciona (resumo)
1. O utilizador escolhe «Pagar online» no ecrã de carregamento (só aparece com a chave `topup_kursipay_ativo` ligada e a conta elegível).
2. A API cria o pagamento na kursiPay e devolve o URL do checkout; o utilizador paga lá.
3. A kursiPay chama `POST /api/webhooks/kursipay` (assinatura HMAC-SHA256, corpo cru). Cada evento é deduplicado pelo id; o `payment.paid` é **confirmado por GET** à kursiPay e comparado com o nosso pedido (valor, moeda, referência, ambiente); só então o saldo é creditado, uma única vez, com auditoria antes/depois e a notificação existente.
4. Divergências, pedidos desconhecidos e contas inativas **não creditam**: ficam em revisão manual com alerta aos administradores. `payment.refunded` nunca mexe no saldo (alerta os superadmins).

## Ordem do deploy (respeitar)
1. **Migração na Neon ANTES do deploy**: `lib/db/src/migrations/add_kursipay.sql` (idempotente; regista-se em `schema_migracoes`). Reversão: `lib/db/src/migrations-reversao/reverter_kursipay.sql` (só se não houver pagamentos; apaga as duas tabelas).
2. Variáveis no `.env` da API (nunca em commits, tickets ou logs; **não colar o valor em lado nenhum**):
   - `KURSIPAY_SECRET_KEY` — chave secreta de teste (`kp_test_…`; nunca a pública `kp_test_pk_…`).
   - `KURSIPAY_WEBHOOK_SECRET` — segredo do endpoint (`whsec_…`).
   - Opcional `KURSIPAY_API_BASE` (só para testes; a API oficial é o valor por defeito).
   Sem estas variáveis a API arranca na mesma, regista um aviso (só com os **nomes**) e as rotas da kursiPay respondem 503.
3. Deploy normal da API e do site público (front: só `TopUpModal.tsx`).
4. No painel de TESTE da kursiPay, criar o endpoint de webhook para `https://xclusive.ao/api/webhooks/kursipay` com os eventos `payment.paid`, `payment.failed`, `payment.expired`, `payment.refunded`. Guardar o `whsec_…` mostrado na criação em `KURSIPAY_WEBHOOK_SECRET` e reiniciar a API.
5. Conta de teste dedicada: acrescentar o id dessa conta à lista e só depois ligar a chave:
   ```sql
   -- ids das contas autorizadas a testar em sandbox (JSON: {"value": [ids]})
   INSERT INTO platform_settings (key, value) VALUES ('kursipay_sandbox_utilizadores', '{"value": [<ID_DA_CONTA_DE_TESTE>]}')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
   INSERT INTO platform_settings (key, value) VALUES ('topup_kursipay_ativo', '{"value": true}')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
   ```
   Opcional: `kursipay_valor_max` (por defeito 100 000 Kz; mínimo = o do carregamento manual, 500 Kz).
6. Fazer um pagamento de teste na conta dedicada, confirmar o crédito (saldo, auditoria `kursipay_creditado` com `sandbox: true`, notificação) e correr a reconciliação (abaixo).
7. **Zerar o saldo de teste no fim**: ajuste de saldo pelo painel (auditado), nunca por SQL. O dinheiro de sandbox não é dinheiro real.

## Reconciliação (só leitura)
```
pnpm --filter @workspace/scripts exec tsx reconciliar-kursipay.mjs [--de AAAA-MM-DD] [--ate AAAA-MM-DD] [--json]
pnpm --filter @workspace/scripts exec tsx reconciliar-saldos.mjs
```
`reconciliar-kursipay` compara os pagamentos pagos na kursiPay com os nossos créditos (pagos sem crédito, créditos sem pagamento, valores divergentes); saída 1 se houver desvios. Nunca imprime chaves. `reconciliar-saldos` continua a dar zero desvios depois de créditos kursiPay (o método `kursipay` conta como pagamento automático).

## Reverter / desligar
- **Desligar já**: `UPDATE`/`DELETE` da chave `topup_kursipay_ativo` (ausente = desligada). Só bloqueia a **criação**; o webhook continua a processar pagamentos já existentes.
- **Rollback completo**: chave desligada + redeploy da versão anterior. As tabelas ficam (inofensivas); a reversão SQL só se for mesmo necessário.
- Eventos para investigar: tabela `kursipay_eventos` (coluna `resultado`) e pedidos em `revisao_manual`.

## PORTÃO DE PRODUÇÃO — não usar `kp_live_` sem TODAS estas condições
1. Política de Privacidade atualizada pelo advogado (tratamento por um processador de pagamentos externo).
2. Verificação de conta kursiPay **aprovada**.
3. Reconciliação **limpa** (sem desvios) em sandbox.
4. Primeiro pagamento real de **valor baixo**, acompanhado e reconciliado.
