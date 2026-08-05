# Xclusive

Uma plataforma de monetização para criadores de conteúdo em Angola, Moçambique e África do Sul — subscriptions, conteúdo exclusivo e ganhos diretos em **Kwanza (Kz / AOA)**, sem intermediários.

## Run & Operate

- O app corre via **quatro workflows** geridos (já configurados, reinicia com `WorkflowsRestart`):
  - `artifacts/xclusive: web` — frontend web principal (Vite dev server, porta 19285)
  - `artifacts/api-server: API Server` — backend Express API (porta 8080)
  - `artifacts/admin: web` — painel de administração (Vite dev server, porta 23744)
  - `artifacts/mockup-sandbox: Component Preview Server` — pré-visualização de design no canvas
- `pnpm run typecheck` — typecheck completo em todos os packages
- `pnpm run build` — typecheck + build de todos os packages
- `pnpm --filter @workspace/api-spec run codegen` — regenera hooks e schemas Zod a partir do spec OpenAPI
- `pnpm --filter @workspace/db run push` — aplica mudanças de schema à DB (só dev)
- `pnpm --filter @workspace/scripts run seed` — insere as contas de teste (idempotente)
- Env necessário: `DATABASE_URL` (Postgres, já provisionado), `SESSION_SECRET` (JWT signing, já definido)

## Base de Dados

A base de dados PostgreSQL está **provisionada e com schema aplicado** (27 tabelas). Para re-aplicar o schema após alterações:

```bash
pnpm --filter @workspace/db run push
pnpm --filter @workspace/scripts run seed
```

### Tabelas existentes

`users`, `posts`, `post_media`, `comments`, `likes`, `saved_posts`, `follows`, `stories`, `story_views`, `highlights`, `highlight_stories`, `reels`, `conversations`, `conversation_participants`, `messages`, `notifications`, `subscription_plans`, `subscriptions`, `purchases`, `withdrawal_requests`, `reports`, `hashtags`, `post_hashtags`, `platform_settings`, `admin`, `audit_log`, `active_sessions`, `revoked_tokens`

### Schema

| Pacote | Ficheiros |
|---|---|
| Schema Drizzle | `lib/db/src/schema/` (um ficheiro por domínio) |
| Config Drizzle | `lib/db/drizzle.config.ts` |
| Script de seed | `scripts/src/seed.ts` |

## Contas de Teste (password: `password123`)

| Email | Tipo | Role |
|---|---|---|
| `fan@xclusive.ao` | Pessoal | user |
| `criador@xclusive.ao` | Criador (verificado) | user |
| `admin@xclusive.ao` | Pessoal (verificado) | admin |

## Sistema de Notificações

As notificações são criadas automaticamente nas seguintes ações:

| Ação | Tipo | Destinatário |
|---|---|---|
| Like num post | `like_post` | Autor do post |
| Comentário num post | `comentario` | Autor do post |
| Seguir um utilizador | `novo_seguidor` | Utilizador seguido |
| Nova subscrição | `nova_subscricao` | Criador subscrito |
| Gorjeta recebida | `pagamento_recebido` | Criador |

**Endpoints:**
- `GET /api/notifications` — lista paginada
- `POST /api/notifications/read-all` — marca todas como lidas
- `GET /api/notifications/unread-count` — contagem não lidas (usado no badge da barra lateral)

## Badges da Barra Lateral

Os badges de **Mensagens** e **Notificações** na barra lateral são puxados em tempo real da API (polling a cada 30 segundos):

- `GET /api/notifications/unread-count` → badge de notificações
- `GET /api/conversations/unread-count` → badge de mensagens (mensagens não lidas enviadas por outros)

Em modo mock (`isMockMode = true`) os badges ficam sempre ocultos.

## Modo offline / sem base de dados

O frontend funciona **sem base de dados** através de um sistema de mock em `localStorage`:

- Login e registo fazem fallback automático para mock quando a API não está acessível (erro de rede ou 5xx)
- Utilizadores mock ficam guardados em `localStorage` sob a chave `xclusive_mock_users`
- Posts criados localmente ficam em `xclusive_local_posts`
- Tokens mock têm o prefixo `mock_token_` e são reconhecidos automaticamente pelo `AuthContext`
- Em modo mock, os dados demonstrativos (`MOCK_FEED_POSTS`, `MOCK_STORY_GROUPS`) são usados como fallback visual

Para testar sem DB: basta usar o registo — se a API falhar, cria conta local automaticamente.

## Sistema de Criação de Conteúdo (Instagram-like)

O modal de criação (`CreatePostModal.tsx`) tem 3 passos:

1. **Selecionar** — zona de drag & drop + seletor de ficheiros (imagens e vídeos, até 10 ficheiros, máx. 100MB/ficheiro)
2. **Pré-visualização** — carousel com navegação por setas, pontos indicadores, thumbnails inferiores, suporte a vídeo com autoplay
3. **Detalhes** — legenda (2200 chars, com emojis/mentions/hashtags), localização, audiência (Todos / Seguidores / Subscritores), toggle de conteúdo exclusivo, preço em Kz

Formatos suportados: JPG, PNG, WEBP, GIF, MP4, MOV, e outros formatos nativos do browser.

## Registo de Conta

O registo é feito em **2 passos**:

**Passo 1:** Nome, username, data de nascimento, email, password (com indicador de força)

**Passo 2:**
- Seleção de **país**: Angola 🇦🇴, Moçambique 🇲🇿, África do Sul 🇿🇦, Portugal 🇵🇹, Brasil 🇧🇷, Outro
- **Telefone** (opcional) com prefixo do país automático
- **Tipo de conta**: Fã/Pessoal ou Criador
- Aceitação dos Termos

## Moeda

Toda a plataforma usa **Kwanza angolano (Kz / AOA)**:
- Subscriptions: ex. `4.990 Kz/mês`
- PPV (pay-per-view): ex. `2.990 Kz`
- Ganhos no painel criador: formatados como `1.305.000 Kz` ou `405K Kz`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validação: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (a partir do spec OpenAPI em `lib/api-spec/openapi.yaml`)
- Build: esbuild (bundle CJS)
- Animações: Framer Motion
- UI: Shadcn/ui + Tailwind CSS

## Onde ficam as coisas

| Área | Ficheiro / Path |
|---|---|
| Schema da DB | `lib/db/src/schema/` |
| Spec OpenAPI | `lib/api-spec/openapi.yaml` |
| Hooks gerados (React Query) | `lib/api-client-react/src/generated/api.ts` |
| Frontend pages | `artifacts/xclusive/src/pages/` |
| Componentes partilhados | `artifacts/xclusive/src/components/shared/` |
| Autenticação / mock mode | `artifacts/xclusive/src/contexts/AuthContext.tsx` |
| Layout principal (badges) | `artifacts/xclusive/src/layouts/AppLayout.tsx` |
| Criação de conteúdo | `artifacts/xclusive/src/components/shared/CreatePostModal.tsx` |
| Painel do criador | `artifacts/xclusive/src/pages/monetization.tsx` |
| Registo | `artifacts/xclusive/src/pages/register.tsx` |
| Rotas API — utilizadores | `artifacts/api-server/src/routes/users.ts` |
| Rotas API — posts/feed | `artifacts/api-server/src/routes/posts.ts` |
| Rotas API — notificações | `artifacts/api-server/src/routes/notifications.ts` |
| Rotas API — mensagens | `artifacts/api-server/src/routes/messages.ts` |
| Rotas API — painel criador | `artifacts/api-server/src/routes/creator.ts` |

## Architecture decisions

- **Mock fallback antes de DB** — AuthContext tenta API real, faz fallback para localStorage mock em erros de rede/5xx; garante que o app funciona sem DB.
- **Upload local por object URLs** — ficheiros enviados no CreatePostModal ficam como `URL.createObjectURL()` para pré-visualização imediata; para persistência real é necessário implementar upload multipart para object storage (ver skill `object-storage`).
- **Kwanza como moeda base** — todos os valores monetários são em AOA; sem conversão dinâmica para outras moedas por agora.
- **3 países-alvo** — Angola (principal), Moçambique, África do Sul; prefixos telefónicos pré-configurados para estes mercados.
- **Notificações por inserção direta** — as notificações são inseridas na DB diretamente pelas rotas que disparam a ação (like, comentário, follow), sem queue ou sistema de eventos assíncrono.
- **Taxa de retenção real** — calculada como `subscritores_ativos / total_histórico * 100`; sem valores aleatórios.

## User preferences

- Responder sempre em português.

## Gotchas

- `pnpm run build` pode falhar fora dos workflows geridos se `PORT` e `BASE_PATH` não estiverem definidos (os workflows injetam estas variáveis automaticamente).
- Object URLs (`blob:`) criados por `URL.createObjectURL()` são válidos apenas durante a sessão do browser — posts guardados em `localStorage` com esses URLs não sobrevivem ao refresh.
- Para uploads reais persistentes, é necessário implementar upload multipart para object storage (ver skill `object-storage`).
- O erro HMR "useAuth must be used within an AuthProvider" que aparece nos logs do Vite durante hot reload é transitório e não afeta a app em page load normal; é causado pela invalidação do módulo AuthContext durante o ciclo de HMR.
- `onConflictDoNothing()` nas inserções de notificações só suprime erros de constraint — a tabela `notifications` não tem unique constraint, por isso podem existir notificações duplicadas se a mesma ação for repetida. Para evitar duplicados a nível de negócio, verificar existência antes de inserir.

## Pointers

- Ver a skill `pnpm-workspace` para estrutura do workspace, setup TypeScript e detalhes dos packages
- Ver a skill `object-storage` para implementar upload real de ficheiros
- Ver a skill `database` para queries SQL diretas e gestão de schema
