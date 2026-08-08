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

### Armazenamento de media em produção

Os uploads reais usam um bucket privado Backblaze B2 através da API S3. A entrega
é feita pelo BunnyCDN Pull Zone; o backend nunca devolve o endpoint B2 ao
utilizador. Preenche estas variáveis no ambiente de produção:

| Variável | Valor a colocar |
|---|---|
| `B2_KEY_ID` | O **Key ID** de uma Application Key do Backblaze B2 com acesso ao bucket |
| `B2_APPLICATION_KEY` | O segredo da mesma Application Key (não usar a Master Application Key) |
| `B2_BUCKET_NAME` | O nome exacto do bucket privado B2 |
| `B2_ENDPOINT` | O endpoint S3 da região do bucket, por exemplo `https://s3.<região>.backblazeb2.com` |
| `BUNNY_CDN_HOSTNAME` | O hostname público do Pull Zone BunnyCDN, sem `https://` e sem `/` final |

Configura o Pull Zone BunnyCDN para usar o bucket B2 como origem S3 (não uma
Bunny Storage Zone separada). A Application Key precisa de permissões de
leitura/escrita/remoção nesse bucket; o hostname Bunny deve conseguir fazer
pull da origem B2. Depois de adicionar as variáveis, reinicia o workflow
`artifacts/api-server: API Server`.

## Base de Dados

A base de dados PostgreSQL está **provisionada e com schema aplicado** (27 tabelas). Para re-aplicar o schema após alterações:

```bash
pnpm --filter @workspace/db run push
pnpm --filter @workspace/scripts run seed
```

### Schema

| Pacote | Ficheiros |
|---|---|
| Schema Drizzle | `lib/db/src/schema/` (um ficheiro por domínio) |
| Config Drizzle | `lib/db/drizzle.config.ts` |
| Script de seed | `scripts/src/seed.ts` |

### Tabelas (27 no total)

#### 👤 Utilizadores & Autenticação

**`users`** — conta de utilizador  
`id`, `username` (único), `email` (único), `password_hash`, `nome_exibicao`, `bio`, `avatar_url`, `capa_url`, `link`, `tipo_conta` (`pessoal`|`criador`), `verificado`, `privado`, `data_nascimento`, `ativo`, `role` (`user`|`admin`|`superadmin`), `saldo` (Kz, ≥ 0), `ganhos` (Kz), `criado_em`

**`active_sessions`** — sessões JWT activas (refresh tokens)  
`id`, `user_id` → users, `refresh_jti` (único), `user_agent`, `ip`, `criada_em`, `expires_at`  
> Usado para limitar sessões simultâneas (máx. 10) e "logout de todos os dispositivos"

**`revoked_tokens`** — tokens JWT revogados (logout / conta suspensa)  
`jti` (PK), `user_id` → users, `expires_at`, `revoked_at`

---

#### 📸 Conteúdo (Posts, Media, Interacções)

**`posts`** — publicações de um criador  
`id`, `autor_id` → users, `legenda`, `localizacao`, `tipo` (`imagem`|`video`|`carrossel`|`texto`), `exclusivo` (bool), `preco_desbloqueio` (Kz), `criado_em`  
> `tipo = 'texto'` — post apenas de texto (estilo X/Twitter); sem media associada. `legenda` é o conteúdo principal (obrigatória para este tipo). Os restantes tipos (`imagem`, `video`, `carrossel`) requerem pelo menos um registo em `post_media`.

**`post_media`** — ficheiros de cada post (imagens/vídeos)  
`id`, `post_id` → posts, `url`, `tipo` (`imagem`|`video`), `ordem`  
> Não existe para posts do tipo `texto`.

**`comments`** — comentários e respostas  
`id`, `post_id` → posts, `autor_id` → users, `comentario_pai_id` (para respostas), `texto`, `criado_em`

**`likes`** — curtidas em posts, reels e comentários  
`id`, `utilizador_id` → users, `alvo_tipo` (`post`|`reel`|`comentario`), `alvo_id`, `criado_em`  
> Unique constraint em `(utilizador_id, alvo_tipo, alvo_id)` — sem duplicados

**`saved_posts`** — posts guardados pelo utilizador  
`id`, `utilizador_id` → users, `post_id` → posts, `criado_em`  
> Unique constraint em `(utilizador_id, post_id)`

**`hashtags`** — hashtags únicas da plataforma  
`id`, `nome` (único), `total_posts`

**`post_hashtags`** — relação N:N entre posts e hashtags  
`post_id` → posts, `hashtag_id` → hashtags

---

#### 📖 Stories & Destaques

**`stories`** — stories com expiração de 24 h  
`id`, `autor_id` → users, `media_url`, `tipo` (`imagem`|`video`), `duracao` (segundos), `audiencia` (`todos`|`seguidores`|`subscritores`), `expira_em`, `criado_em`

**`story_views`** — visualizações únicas de stories  
`id`, `story_id` → stories, `utilizador_id` → users, `visto_em`  
> Unique constraint em `(story_id, utilizador_id)`

**`highlights`** — destaques permanentes de stories no perfil  
`id`, `utilizador_id` → users, `titulo`, `capa_url`, `criado_em`

**`highlight_stories`** — stories incluídos num destaque  
`highlight_id` → highlights, `story_id` → stories

---

#### 🎬 Reels

**`reels`** — vídeos curtos verticais  
`id`, `autor_id` → users, `video_url`, `capa_url`, `legenda`, `som_titulo`, `som_artista`, `exclusivo`, `criado_em`

---

#### 👥 Relações Sociais

**`follows`** — relação de seguir entre utilizadores  
`id`, `seguidor_id` → users, `seguido_id` → users, `estado` (`aceite`|`pendente`), `criado_em`  
> Unique constraint em `(seguidor_id, seguido_id)`. Estado `pendente` para contas privadas.

---

#### 💬 Mensagens

**`conversations`** — conversa privada ou de grupo  
`id`, `tipo` (`privada`|`grupo`), `criado_em`

**`conversation_participants`** — participantes de cada conversa  
`conversation_id` → conversations, `utilizador_id` → users  
> Índice em `utilizador_id` para pesquisa rápida das conversas do utilizador

**`messages`** — mensagens individuais  
`id`, `conversation_id` → conversations, `autor_id` → users, `tipo` (`texto`|`imagem`|`audio`|`post_partilhado`), `conteudo`, `media_url`, `lido`, `criado_em`

---

#### 🔔 Notificações

**`notifications`** — notificações em tempo real  
`id`, `destinatario_id` → users, `tipo` (`novo_seguidor`|`like_post`|`like_reel`|`comentario`|`mencao`|`nova_subscricao`|`pagamento_recebido`), `ator_id` → users, `alvo_id` (id do post/reel/etc.), `post_thumbnail`, `lida`, `criado_em`

> Criadas automaticamente nas rotas de like, comentário, follow e gorjeta.

---

#### 💰 Monetização

**`subscription_plans`** — planos de subscrição criados por um criador  
`id`, `criador_id` → users, `nome`, `preco` (Kz), `beneficios`, `ativo`, `criado_em`

**`subscriptions`** — subscritores activos ou cancelados  
`id`, `subscritor_id` → users, `criador_id` → users, `plano_id` → subscription_plans, `estado` (`ativa`|`cancelada`), `inicio_em`, `renovacao_em`, `criado_em`

**`purchases`** — registo de todas as transacções financeiras  
`id`, `comprador_id` → users, `vendedor_id` → users, `tipo` (`subscricao`|`ppv`|`gorjeta`), `valor` (Kz), `conteudo_id`, `descricao`, `criado_em`  
> Índice em `(vendedor_id, tipo, criado_em)` para o histórico do painel criador

**`withdrawal_requests`** — pedidos de levantamento de ganhos  
`id`, `creator_id` → users, `amount` (Kz), `method` (`bank_transfer`|`multicaixa_express`|…), `destination_details` (JSONB), `status` (`pending`|`approved`|`rejected`|`paid`), `processed_by` → users, `processed_at`, `notes`, `criado_em`

---

#### 🛡️ Administração & Segurança

**`reports`** — denúncias de conteúdo ou utilizadores  
`id`, `reporter_id` → users, `target_type` (`post`|`comment`|`user`|`message`), `target_id`, `reason` (`nudity_minor`|`spam`|`harassment`|`copyright`|`other`), `description`, `status` (`pending`|`reviewing`|`resolved`|`dismissed`), `resolved_by` → users, `resolved_at`, `criado_em`

**`audit_log`** — registo de acções administrativas  
`id`, `admin_id` → users, `action` (`user_suspend`|`user_delete`|`withdrawal_approve`|…), `target_type`, `target_id`, `details` (JSONB), `ip_address`, `criado_em`

**`platform_settings`** — configurações globais da plataforma (key-value)  
`key` (PK), `value` (JSONB), `updated_by` → users, `updated_at`

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

## Sistema de Criação de Conteúdo

O modal de criação (`CreatePostModal.tsx`) suporta dois fluxos distintos:

### Fluxo de media (fotos/vídeos)
1. **Selecionar** — zona de drag & drop + seletor de ficheiros (imagens e vídeos, até 10 ficheiros, máx. 100MB/ficheiro)
2. **Pré-visualização** — carousel com navegação por setas, pontos indicadores, thumbnails inferiores, suporte a vídeo com autoplay
3. **Detalhes** — legenda (2200 chars, com emojis/mentions/hashtags), localização, audiência (Todos / Seguidores / Subscritores), toggle de conteúdo exclusivo, preço em Kz

Formatos suportados: JPG, PNG, WEBP, GIF, MP4, MOV, e outros formatos nativos do browser.

### Fluxo de texto (estilo X/Twitter) — `tipo = 'texto'`
1. **Compor** — área de texto grande ("O que está a acontecer?"), contador circular de caracteres (máx. 2200; fica amarelo nos últimos 100, vermelho nos últimos 20), localização, audiência, toggle exclusivo com preço em Kz
2. Publicar direto — sem passo de pré-visualização nem upload de ficheiros

O tamanho da fonte no `PostCard` adapta-se automaticamente ao comprimento do texto: maior para textos curtos (≤140 chars), médio até 280, normal acima disso. A legenda não é duplicada na secção de caption abaixo do post.

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
