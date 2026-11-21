# kursiPay — carregamento automático de saldo (SANDBOX)

Estado: **só sandbox**. Nada de `kp_live_` até cumprir o **portão de produção** (fim deste documento).
Só há entradas de dinheiro: o código nunca chama endpoints de reembolso.

## Como funciona (resumo)
1. O utilizador escolhe «Multicaixa Express» ou «Referência» no ecrã de carregamento (só aparecem com a chave `topup_kursipay_ativo` ligada e a conta elegível). **O utilizador nunca sai do site** (cobrança direta da kursiPay, sem checkout externo).
2. A API cria a cobrança direta na kursiPay: **Express** envia o telemóvel do comprador (`payer.phone`, `wait: false`) e o utilizador aprova na app Multicaixa Express; **Referência** devolve entidade, referência e prazo, mostrados no ecrã (e guardados em `topup_requests.external_ref`). O ecrã consulta o estado do pedido de 5 em 5 segundos enquanto está aberto. Cartão, Pix e PayPay não existem neste fluxo. (Sem o campo `method` a API ainda cria um pagamento com checkout hospedado, por compatibilidade; o ecrã já não o usa.)
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

## Cobrança direta: ativação e privacidade
- **Sandbox:** a cobrança direta funciona em todas as contas de teste aprovadas. Telefones de teste: `+244 900 000 002` (recusado), `+244 900 000 003` (sem resposta); qualquer outro é aprovado.
- **Produção:** a kursiPay ativa a cobrança direta **conta a conta**; é preciso pedir a ativação ao suporte. Sem ela a API responde `403 forbidden` e o utilizador vê «Este método de pagamento ainda não está disponível».
- **Telemóvel do comprador (dado pessoal):** só é enviado à kursiPay no pedido Express; **nunca é guardado nem registado** (nem em base de dados, auditoria, notificações nem logs). A kursiPay devolve-o mascarado. Isto tem de constar da Política de Privacidade antes de produção (ver portão).
- A kursiPay só admite **um pedido Express à espera por telemóvel**: um segundo pedido recebe `409 conflict` («Já existe um pedido de pagamento à espera de aprovação neste telemóvel»).
- Pedidos que ficam em `a_criar` mais de 5 minutos fecham-se sozinhos, sem crédito, quando a mesma conta cria um novo pedido. Um `payment.paid` num registo sem id da kursiPay gravado vai para revisão manual (`revisao_sem_id_registado`) com alerta aos admins.

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
1. Política de Privacidade atualizada pelo advogado (tratamento por um processador de pagamentos externo, **incluindo o envio do número de telemóvel** no Multicaixa Express).
2. Verificação de conta kursiPay **aprovada**.
3. Reconciliação **limpa** (sem desvios) em sandbox.
4. Primeiro pagamento real de **valor baixo**, acompanhado e reconciliado.
5. **Cobrança direta ativada na conta de produção** pelo suporte da kursiPay (sem isso os métodos respondem «ainda não está disponível»).
