# Mensagem automática de boas-vindas (PR 1: servidor e base de dados)

A criadora (verificada) configura UMA mensagem (só texto, ou imagem com texto opcional). Quando um utilizador começa a seguir essa criadora, a mensagem é entregue
automaticamente na conversa criadora→seguidor, como mensagem normal da criadora. Este PR não tem interface (vem no PR 2); o vídeo fica para um PR próprio.

## Estado inicial: DESLIGADO
O envio só funciona quando existe, em `platform_settings`, a linha `boas_vindas_ativas` com o valor JSON `{"value": true}`. Sem a linha (ou com qualquer outro valor) não se
enfileira nem se envia nada; a configuração das criadoras funciona na mesma. **A migração e este PR não ligam o interruptor.**

```sql
-- LIGAR (só quando decidires):
INSERT INTO platform_settings (key, value) VALUES ('boas_vindas_ativas', '{"value": true}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
-- DESLIGAR (pára já; o que está em espera fica parado e descarta-se ao fim de 24 h):
DELETE FROM platform_settings WHERE key = 'boas_vindas_ativas';
```

## Ordem do deploy
1. Rever e aplicar `lib/db/src/migrations/add_boas_vindas.sql` no Neon (cria 2 tabelas novas e vazias; regista-se em `schema_migracoes`). Reversão: `lib/db/src/migrations-reversao/reverter_boas_vindas.sql`.
2. Deploy do código (a guarda de migrações recusa se a migração não estiver aplicada).
3. Só depois, se quiseres, ligar o interruptor.

## Regras
- **Quem configura:** criadoras com `tipo_conta = criador` e `verificado = true` (as outras recebem 403). API: `GET/PUT/DELETE /api/creator/boas-vindas` e `PATCH /api/creator/boas-vindas/ativa`.
- **Texto:** até 1000 caracteres, sem HTML (as etiquetas e os `<` `>` são retirados), sem caracteres de controlo. **Imagem:** a mesma regra das imagens de mensagens (CDN próprio, pasta da própria criadora,
  jpg/png/webp, verificada no CDN) com limite de **5 MB**; nunca ficheiros pagos/exclusivos. A imagem fica guardada UMA vez: todas as mensagens apontam para o mesmo URL e nada se apaga do CDN.
- **Edição:** só vale para novos seguidores (cada envio guarda o texto/imagem do momento em que a pessoa começou a seguir).
- **Uma vez por par, para sempre:** `boas_vindas_envios` tem restrição única (criadora, seguidor). Deixar de seguir e voltar a seguir não reenvia.
- **O seguir nunca falha nem demora por causa disto:** o pedido só grava uma linha de fila (e só com o interruptor ligado); o envio faz-se fora do pedido.
- **Não recebe:** conta inativa (suspensa, encerrada, em fecho, banida) da criadora ou do seguidor; bloqueio em qualquer sentido; seguidor sem data de nascimento válida com 18 anos ou mais, sem linha de aceitação
  com `maioridade_confirmada = true` ou sem email verificado; mensagem desativada (pela criadora ou por um admin); contas admin; a própria criadora; quem já não segue; a regra «quem pode escrever» do destinatário.
  Cada caso fica registado em `boas_vindas_envios.estado/motivo` (códigos, sem dados pessoais).
- **Mensagem automática:** é uma linha normal em `messages` (autor = criadora). Sabe-se que é automática pela ligação `boas_vindas_envios.message_id`. A tabela `messages` e o enum de tipos NÃO foram alterados.
- **Notificação:** a normal de nova mensagem: a conversa aparece na lista do seguidor e o contador de não lidas sobe 1 (as mensagens privadas não têm tempo real; o cliente consulta de 30 em 30 s).

## Limites anti-abuso (constantes em `artifacts/api-server/src/lib/boasVindas.ts`, objeto `BOAS_VINDAS`)
| Limite | Valor |
|---|---|
| Por seguidor (somando todas as criadoras) | 10 por hora, 30 por dia |
| Por criadora | 60 por minuto, 5 000 por dia |
| Em espera | o excedente NÃO se perde: fica `pendente` com o motivo `limite_…` e entrega-se quando a janela libertar; descarta-se após **24 h** |
| Erros técnicos | até 5 tentativas (espera crescente); depois `falhada` e pára |
| Trabalho | lote de 50 a cada 5 s, um trabalhador de cada vez (lock na BD) |

## Admin
Admin e superadmin vêem a mensagem de uma criadora e podem **desativá-la** (motivo de 10 a 500 caracteres, registado em `audit_log` com a ação `boas_vindas_desativada`):
- `GET  /api/admin/creators/:id/boas-vindas`
- `POST /api/admin/creators/:id/boas-vindas/desativar` com `{ "motivo": "…" }`

A criadora não a reativa (nem apagando e criando de novo). Não há reativação por este caminho (se for preciso, é uma decisão a tomar à parte). Sem interface de admin neste PR.

## Contas apagadas
As duas tabelas referenciam `users` com `ON DELETE CASCADE`: os scripts `apagar-contas-teste` e `zerar-financeiro` não precisam de alteração.

## Contagem (SÓ LEITURA) das contas que ficam de fora — para correres no Neon
Antes de ligar o interruptor, vê quantas contas ativas não cumpririam o requisito (idade ≥ 18 com data válida, aceitação com maioridade confirmada, email verificado):

```sql
WITH c AS (
  SELECT u.id,
    COALESCE(u.data_nascimento ~ '^\d{4}-\d{2}-\d{2}$' AND u.data_nascimento <= to_char(current_date - interval '18 years', 'YYYY-MM-DD'), false) AS idade_ok,
    EXISTS (SELECT 1 FROM user_legal_acceptances a WHERE a.user_id = u.id AND a.maioridade_confirmada = true) AS aceitou,
    (u.email_verificado_em IS NOT NULL) AS email_ok
  FROM users u WHERE u.ativo AND u.role NOT IN ('admin', 'superadmin')
)
SELECT count(*)                                              AS contas_ativas_de_utilizador,
       count(*) FILTER (WHERE idade_ok AND aceitou AND email_ok)     AS elegiveis,
       count(*) FILTER (WHERE NOT (idade_ok AND aceitou AND email_ok)) AS ficam_de_fora,
       count(*) FILTER (WHERE NOT idade_ok)                  AS sem_data_valida_ou_menores,
       count(*) FILTER (WHERE NOT aceitou)                   AS sem_aceitacao_com_maioridade,
       count(*) FILTER (WHERE NOT email_ok)                  AS email_por_verificar
FROM c;
```
(A coluna `data_nascimento` é texto: a query compara-a como texto `AAAA-MM-DD`; uma data impossível como `2000-02-31` passa nesta contagem mas o servidor recusa-a.)
