# kursiPay — carregamento automático de saldo (SANDBOX)

Estado: **só sandbox**. Nada de `kp_live_` até cumprir o **portão de produção** (fim deste documento).
Só há entradas de dinheiro: o código nunca chama endpoints de reembolso.

## Como funciona (resumo)
1. No pop-up «Método de Pagamento» o utilizador escolhe: **Multicaixa Express** ou **Pagamento por Referência** (cobrança DIRETA, sem sair do site; só se `kursipay_direto_ativo` estiver ligada) ou **Pagar online** (checkout hospedado da kursiPay, para PayPay e outros; abre noutra página; **só aparece com a chave `kursipay_hospedado_ativo` ligada, por defeito está DESLIGADO**).
2. **Express**: `POST /wallet/topup/kursipay/express {valor, telefone}` envia o telemóvel à kursiPay (`payer.phone`, sempre `wait: false`); o utilizador aprova na app Multicaixa Express. **Referência**: `POST /wallet/topup/kursipay/referencia {valor}` devolve entidade, referência, valor e prazo (guardados em `kursipay_pagamentos`). O ecrã consulta `GET /wallet/topup/kursipay/:id/estado` (só o dono) de 3 em 3 s durante ~90 s (no Express para aí e mostra «Ainda pendente» com «Verificar agora»; na Referência e no hospedado continua a 15 s enquanto o ecrã estiver aberto). **Nunca se credita pela resposta da criação**: só pelo webhook.
3. A kursiPay chama `POST /api/webhooks/kursipay` (assinatura HMAC-SHA256, corpo cru). Cada evento é deduplicado pelo id; o `payment.paid` é **confirmado por GET** à kursiPay e comparado com o nosso pedido (valor, moeda, referência, ambiente); só então o saldo é creditado, uma única vez, com auditoria antes/depois e a notificação existente.
4. Divergências, pedidos desconhecidos e contas inativas **não creditam**: ficam em revisão manual com alerta aos administradores. `payment.refunded` nunca mexe no saldo (alerta os superadmins).

## Ordem do deploy (respeitar)
1. **Migrações na Neon ANTES do deploy** (por esta ordem; idempotentes; registam-se em `schema_migracoes`): `lib/db/src/migrations/add_kursipay.sql` e `lib/db/src/migrations/add_kursipay_direto.sql` (6 colunas novas em `kursipay_pagamentos`: `modo`, `metodo`, `entidade`, `referencia`, `valida_ate`, `telefone_mascarado`). O código novo falha ao ler o estado dos pedidos sem a segunda. Reversão da segunda: `lib/db/src/migrations-reversao/reverter_kursipay_direto.sql`. Reversão: `lib/db/src/migrations-reversao/reverter_kursipay.sql` (só se não houver pagamentos; apaga as duas tabelas).
2. Variáveis no `.env` da API (nunca em commits, tickets ou logs; **não colar o valor em lado nenhum**):
   - `KURSIPAY_SECRET_KEY` — chave secreta de teste (`kp_test_…`; nunca a pública `kp_test_pk_…`).
   - `KURSIPAY_WEBHOOK_SECRET` — segredo do endpoint (`whsec_…`).
   - Opcional `KURSIPAY_API_BASE` (só para testes; a API oficial é o valor por defeito).
   Sem estas variáveis a API arranca na mesma, regista um aviso (só com os **nomes**) e as rotas da kursiPay respondem 503.
3. Deploy normal da API e do site público (front: só `TopUpModal.tsx`). Com as chaves `kursipay_direto_ativo` e `kursipay_hospedado_ativo` ausentes, o pop-up não mostra nenhuma opção kursiPay (os cartões «Multicaixa Express» e «Referência» ficam «Brevemente», como antes da kursiPay).
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

## Checkout hospedado («Pagar online»): chave própria, desligado por defeito
- **Chave `kursipay_hospedado_ativo`** (ausente = desligada). Desligada: o pop-up **não mostra «Pagar online»** e `POST /wallet/topup/kursipay` responde 403 `metodo_indisponivel` **sem chamar a kursiPay** (sem criar pedido). `GET /wallet/topup/kursipay/config` devolve `hospedado: false`.
- **A cobrança direta NÃO depende dela**: usa só `topup_kursipay_ativo` + `kursipay_direto_ativo` + a lista do sandbox. Ligar/desligar uma não altera a outra.
- Os pagamentos hospedados já criados continuam a ser processados pelo webhook (com a chave desligada ou ligada); a reconciliação cobre os dois modos.
- Para voltar a ligar o hospedado:
  ```sql
  INSERT INTO platform_settings (key, value) VALUES ('kursipay_hospedado_ativo', '{"value": true}')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  ```
  Para desligar: apagar a linha ou pôr `false`.

## Cobrança direta: chave, ativação, limites e privacidade
- **Chave própria `kursipay_direto_ativo`** (ausente = desligada, em sandbox **e em produção**; não confundir com `topup_metodos_automaticos_ativos`, que é da AppyPay). A cobrança direta exige TAMBÉM `topup_kursipay_ativo` e, em sandbox, a conta na lista `kursipay_sandbox_utilizadores`. Para ligar na conta de teste:
  ```sql
  INSERT INTO platform_settings (key, value) VALUES ('kursipay_direto_ativo', '{"value": true}')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  ```
  Para desligar: apagar a linha ou pôr `false`. Só bloqueia a CRIAÇÃO; o webhook processa sempre os pagamentos existentes.
- **Limites de abuso** (em memória no processo da API; reiniciar a API repõe-nos): **5 pagamentos diretos por hora por utilizador** e, por telefone, um **intervalo mínimo de 60 s** (variável opcional `KURSIPAY_COOLDOWN_TELEFONE_S`, 1 a 3600) e **3 pedidos por hora**. O telefone só entra aí como um HMAC irreversível com uma chave que só existe na memória do processo. Recusas respondem 429 com `Retry-After` e ficam no log com `codigo: kursipay_limite_direto` e o motivo (`utilizador_hora`, `telefone_cooldown` ou `telefone_hora`), sem telefone. Se a API passar a correr em vários processos, estes limites passam a ser por processo.
- **Sandbox:** a cobrança direta funciona em todas as contas de teste aprovadas. Telefones de teste: `+244 900 000 002` (recusado), `+244 900 000 003` (sem resposta); qualquer outro é aprovado.
- **Produção:** a kursiPay ativa a cobrança direta **conta a conta**; é preciso pedir a ativação ao suporte. Sem ela a API responde `403 forbidden`: fica no log (`kursipay_criacao_falhou`, `motivo: forbidden`, `httpKursipay: 403`) e o utilizador vê «O pagamento direto ainda não está disponível. Usa a transferência bancária.». A kursiPay pode **desativar a cobrança direta automaticamente** em contas com muitas recusas ou muitos telefones diferentes sem pagamentos: o sintoma é este mesmo 403.
- **Telemóvel do comprador (dado pessoal):** só é enviado à kursiPay no pedido Express. **O número completo nunca é guardado nem registado** (nem em base de dados, auditoria, notificações nem logs): só se guarda a versão MASCARADA que a kursiPay devolve (`telefone_mascarado`, ex. «+244 9•• ••• 789»; se vier com 9 ou mais dígitos, não se guarda nada). Isto tem de constar da Política de Privacidade antes de produção (ver portão).
- A kursiPay só admite **um pedido Express à espera por telemóvel**: um segundo pedido recebe `409 conflict` («Já tens um pedido pendente no telemóvel…»).
- Pedidos que ficam em `a_criar` mais de 5 minutos fecham-se sozinhos, sem crédito, quando a mesma conta cria um novo pedido. Um `payment.paid` num registo sem id da kursiPay gravado vai para revisão manual (`revisao_sem_id_registado`) com alerta aos admins.

## Reconciliação (só leitura)
`reconciliar-kursipay` cobre os dois modos (`direto` e `hospedado`): cada linha dos relatórios leva `[modo/método]` e o resumo conta os pagamentos pagos por modo.
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
