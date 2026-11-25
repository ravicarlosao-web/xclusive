# Seguir automaticamente a conta oficial (contas novas)

Toda a conta NOVA (registo por palavra-passe ou com o Google) segue a conta oficial da plataforma (por defeito `xclusive`), para ter conteúdo no feed e receber a mensagem de boas-vindas automática. **Não há migração**: usa duas chaves de `platform_settings`.

## Interruptor e conta (platform_settings)
| Chave | Valor | Por defeito |
|---|---|---|
| `seguir_oficial_ativo` | `{"value": true}` / `{"value": false}` | ausente = **DESLIGADO** |
| `conta_oficial_username` | `{"value": "xclusive"}` | ausente = `xclusive` |

Normalmente liga-se no painel de admin (Definições → «Conta oficial»; só superadmin; fica no `audit_log` com `conta_oficial_update`: quem, quando, valor anterior e novo). Em SQL (equivalente, sem auditoria):
```sql
INSERT INTO platform_settings (key, value) VALUES ('seguir_oficial_ativo', '{"value": true}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now();
```

## O que acontece no registo
- Depois de a conta estar criada (a resposta do registo não espera), a conta nova passa pelo MESMO caminho de «seguir» da app (`lib/seguir.ts`), **sem** a notificação de «novo seguidor» para a conta oficial. Isso enfileira a mensagem de boas-vindas (se a conta oficial tiver uma ativa e o interruptor geral das boas-vindas estiver ligado).
- Falha do seguir automático nunca falha o registo (log `seguir_oficial_falhou`, sem dados pessoais).
- Com o interruptor desligado, ou a conta oficial inexistente/inativa/de administração: o registo não faz nada extra.
- Nunca volta a seguir sozinho quem deixou de seguir (só corre no registo). Excluídos: contas admin, a própria conta oficial, contas inativas/suspensas, e pares bloqueados.

## Requisitos da conta oficial (importante)
- Tem de existir, estar **ativa** e **não** ser `admin`/`superadmin` (a app recusa seguir contas de administração).
- Para os posts dela aparecerem no feed, tem de ser `tipo_conta = 'criador'` (o feed só mostra publicações de criadoras públicas); posts exclusivos/pagos só aparecem a quem tem acesso.
- Para ter o Painel do Criador e a mensagem de boas-vindas tem de ser criadora **verificada** (`verificado = true`).

## Mensagem de boas-vindas e email
A condição «email verificado» foi **retirada** da elegibilidade da boas-vindas (um utilizador acabado de registar tem o email por verificar). Ficam: data de nascimento válida ≥ 18, aceitação com maioridade confirmada, bloqueios, contas suspensas, limites anti-abuso e o interruptor geral. Ver `boas-vindas.md`.

## Contas já existentes (script de uso único)
`scripts/seguir-oficial-existentes.mjs` — **simulação por defeito**; só com `--confirmar` grava. Não executar em produção sem rever.
```
pnpm --filter @workspace/scripts exec tsx seguir-oficial-existentes.mjs              # simulação: quantas seguiria e quais exclui
pnpm --filter @workspace/scripts exec tsx seguir-oficial-existentes.mjs --confirmar  # executa
```
- Usa a conta de `conta_oficial_username`; não depende do interruptor do registo.
- Exclui admin, a própria oficial, contas inativas/suspensas/encerradas, bloqueios e quem já a segue (não duplica).
- Mesmo caminho de seguir (boas-vindas com limites: 60/minuto e 5 000/dia por criadora; o excedente espera e caduca ao fim de 24 h, por isso, com mais de ~5 000 contas, nem todas recebem a boas-vindas).
- Idempotente: no fim de uma execução completa guarda `seguir_oficial_script_ate_id` em `platform_settings`; execuções seguintes só olham para ids superiores (não volta a seguir quem deixou de seguir). Para repetir do zero: apagar essa chave.
