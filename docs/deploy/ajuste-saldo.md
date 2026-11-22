# Ajuste manual de saldo (crédito/débito) — só superadmin

Ferramenta do painel de administração para o **superadmin** creditar ou debitar o saldo de **qualquer conta de utilizador** (pessoal ou criadora), com motivo obrigatório e registo de auditoria. Sem migração: usa as tabelas que já existem (`users`, `audit_log`, `ajustes_saldo`).

## Quando usar
Correções que NÃO têm outro caminho: um carregamento creditado por engano, o estorno de uma cobrança duplicada, a anulação do dinheiro de teste (sandbox) de uma conta, uma compensação decidida pelo suporte. **Não é** para carregamentos normais (esses têm o fluxo próprio, manual ou kursiPay) nem para levantamentos.

## Quem pode
- **Só `superadmin`.** Um admin simples recebe **403** no servidor («Apenas o superadmin pode ajustar o saldo de uma conta») e o botão nem aparece no painel.
- Não se pode ajustar a **própria** conta (403 `proprio_saldo`).
- Não há novo pedido de TOTP nesta ação: vale o que já foi exigido no login do painel (o TOTP, se a conta o tem, foi pedido ao entrar).

## Como usar (passo a passo, sem programar)
1. Entra no painel de administração como **superadmin**.
2. Menu **Utilizadores** → abre a ficha da conta (pesquisa pelo `@username`).
3. Separador **Financeiro**. Vês o **Saldo atual** e, ao lado, o botão **Ajustar saldo**.
4. No diálogo escolhe **Crédito** (soma ao saldo) ou **Débito** (tira do saldo), escreve o **valor em Kz** (até 2 casas decimais) e o **motivo** (obrigatório, 10 a 500 caracteres; ex.: «Anulação do saldo de teste da kursiPay (sandbox)»). Clica **Continuar**.
5. Aparece a confirmação: **«@utilizador: saldo antes X Kz → depois Y Kz»**. Confere o valor, o tipo e o motivo. Clica **Confirmar débito/crédito de N Kz** **uma só vez** (o botão fica bloqueado enquanto envia; um duplo clique não debita duas vezes).
6. Verás «Débito registado»/«Crédito registado» e o saldo novo. Se o saldo da conta mudou entretanto (por exemplo, uma compra a meio), o painel avisa «O saldo mudou entretanto…» e **não ajusta**: volta ao formulário com o saldo atualizado.
7. Um **débito acima do saldo** é recusado («Saldo insuficiente para este débito.») e não altera nada.

## O que fica registado (tudo na mesma transação)
- **`users.saldo`** atualizado (a linha da conta é bloqueada durante o ajuste: compras/gorjetas/carregamentos em simultâneo esperam e não se perdem).
- **`audit_log`**: ação `balance_adjustment`, o admin, o IP, e nos detalhes: saldo antes/depois, valor com sinal, **motivo**, tipo de conta e a chave do pedido.
- **`ajustes_saldo`**: valor com sinal, saldo antes/depois, motivo, admin e a ligação à linha de auditoria. É esta tabela que alimenta o cartão **«Ajustes de saldo»** da ficha (data, valor, antes → depois, admin, motivo; todos os tipos de conta) e a reconciliação.
- O **extrato do utilizador** mostra apenas uma linha neutra «Ajuste de saldo» com a data e o valor (sem motivo nem admin).
- Se qualquer um dos passos falhar, **nada** fica (o saldo não muda).

## Como se audita
- **No painel:** ficha da conta → Financeiro → «Ajustes de saldo»; e **Registo de auditoria** (ação `balance_adjustment`).
- **Por reconciliação:** `scripts/reconciliar-saldos.mjs` conta estes ajustes como movimento legítimo (saldo calculado = carregamentos aprovados − compras + Σ `ajustes_saldo`). Uma conta ajustada pelo painel **não** aparece em desvio; um saldo alterado à mão por SQL, sem ajuste, aparece.
- Um erro corrige-se com **outro ajuste** (de sinal contrário, com o motivo a explicar); os ajustes não se apagam.

## API (para quem precisar)
`POST /api/admin/users/:id/balance-adjustment` com `{ "valor": -5000, "motivo": "…", "chave": "<identificador do pedido>", "saldoEsperado": 9000 }` (`chave` e `saldoEsperado` opcionais; o painel envia-os sempre). A rota antiga `POST /api/admin/creators/:id/balance-adjustment` continua a funcionar (o mesmo comportamento). Respostas: 200 `{ success, novoSaldo, saldoAnterior, repetido? }`; 400 (valor ou motivo inválidos, `motivo_invalido`); 403 (não é superadmin / conta própria); 404; 409 (`saldo_insuficiente` ou `saldo_mudou`).
