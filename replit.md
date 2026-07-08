# Xclusive

Uma plataforma de monetização para criadores de conteúdo em Angola, Moçambique e África do Sul — subscriptions, conteúdo exclusivo e ganhos diretos em **Kwanza (Kz / AOA)**, sem intermediários.

## Run & Operate

- O app corre via três workflows geridos (já configurados, reinicia com `WorkflowsRestart`):
  - `artifacts/xclusive: web` — frontend web (Vite dev server)
  - `artifacts/api-server: API Server` — backend Express API
  - `artifacts/mockup-sandbox: Component Preview Server` — pré-visualização de design no canvas
- `pnpm run typecheck` — typecheck completo em todos os packages
- `pnpm run build` — typecheck + build de todos os packages
- `pnpm --filter @workspace/api-spec run codegen` — regenera hooks e schemas Zod a partir do spec OpenAPI
- `pnpm --filter @workspace/db run push` — aplica mudanças de schema à DB (só dev)
- Env necessário: `DATABASE_URL` (Postgres, já provisionado), `SESSION_SECRET` (JWT signing, já definido)

## Modo offline / sem base de dados

O frontend funciona **sem base de dados** através de um sistema de mock em `localStorage`:

- Login e registo fazem fallback automático para mock quando a API não está acessível (erro de rede ou 5xx)
- Utilizadores mock ficam guardados em `localStorage` sob a chave `xclusive_mock_users`
- Posts criados localmente ficam em `xclusive_local_posts`
- Tokens mock têm o prefixo `mock_token_` e são reconhecidos automaticamente pelo `AuthContext`

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
- API codegen: Orval (a partir do spec OpenAPI)
- Build: esbuild (bundle CJS)
- Animações: Framer Motion
- UI: Shadcn/ui + Tailwind CSS

## Onde ficam as coisas

| Área | Ficheiro / Path |
|---|---|
| Schema da DB | `lib/db/src/schema.ts` |
| Spec OpenAPI | `lib/api-spec/` |
| Frontend pages | `artifacts/xclusive/src/pages/` |
| Componentes partilhados | `artifacts/xclusive/src/components/shared/` |
| Autenticação / mock mode | `artifacts/xclusive/src/contexts/AuthContext.tsx` |
| Criação de conteúdo | `artifacts/xclusive/src/components/shared/CreatePostModal.tsx` |
| Painel do criador | `artifacts/xclusive/src/pages/monetization.tsx` |
| Registo | `artifacts/xclusive/src/pages/register.tsx` |

## Seed accounts (password: `password123`)

- `demo@xclusive.pt` — pessoal
- `ana@xclusive.pt` — criador, verificado
- `marcos@xclusive.pt` — criador, verificado
- `sofia@xclusive.pt` — criador
- `pedro@xclusive.pt` — criador, verificado
- `luna@xclusive.pt` — criador

## Architecture decisions

- **Mock fallback antes de DB** — AuthContext tenta API real, faz fallback para localStorage mock em erros de rede/5xx; garante que o app funciona sem DB.
- **Upload local por object URLs** — ficheiros enviados no CreatePostModal ficam como `URL.createObjectURL()` para pré-visualização imediata; a API recebe os URLs (futuramente substituir por upload multipart para S3/object storage).
- **Kwanza como moeda base** — todos os valores monetários são em AOA; sem conversão dinâmica para outras moedas por agora.
- **3 países-alvo** — Angola (principal), Moçambique, África do Sul; prefixos telefónicos pré-configurados para estes mercados.

## User preferences

_Preenche aqui quando o utilizador der instruções para manter entre sessões._

## Gotchas

- `pnpm run build` pode falhar fora dos workflows geridos se `PORT` e `BASE_PATH` não estiverem definidos (os workflows injetam estas variáveis automaticamente).
- Object URLs (`blob:`) criados por `URL.createObjectURL()` são válidos apenas durante a sessão do browser — posts guardados em `localStorage` com esses URLs não sobrevivem ao refresh.
- Para uploads reais persistentes, é necessário implementar upload multipart para object storage (ver skill `object-storage`).

## Pointers

- Ver a skill `pnpm-workspace` para estrutura do workspace, setup TypeScript e detalhes dos packages
- Ver a skill `object-storage` para implementar upload real de ficheiros
