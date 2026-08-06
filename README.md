# Xclusive

Uma plataforma de monetização para criadores de conteúdo em Angola, Moçambique e África do Sul — subscriptions, conteúdo exclusivo e ganhos diretos em **Kwanza (Kz / AOA)**, sem intermediários.

## O que é

Xclusive permite que criadores partilhem conteúdo (fotos, vídeos, carrosséis e **publicações de texto**) com os seus seguidores e subscritores, monetizem o acesso exclusivo e recebam gorjetas diretamente em Kwanza.

## Stack

- **Frontend:** React + Vite + Tailwind CSS + Shadcn/ui
- **Backend:** Express 5 + Node.js
- **Base de dados:** PostgreSQL + Drizzle ORM
- **Autenticação:** JWT (access + refresh tokens)
- **Validação:** Zod v4 + OpenAPI spec → codegen

## Arrancar o projecto

```bash
pnpm install
pnpm --filter @workspace/db run push   # aplica schema na DB
pnpm --filter @workspace/scripts run seed  # insere contas de teste
```

Os quatro workflows geridos arrancam automaticamente:
- **Frontend web** — `artifacts/xclusive: web` (porta 19285)
- **API backend** — `artifacts/api-server: API Server` (porta 8080)
- **Admin panel** — `artifacts/admin: web` (porta 23744)
- **Mockup sandbox** — `artifacts/mockup-sandbox: Component Preview Server` (porta 8081)

## Contas de teste (password: `password123`)

| Email | Tipo | Role |
|---|---|---|
| `fan@xclusive.ao` | Pessoal/Fã | user |
| `criador@xclusive.ao` | Criador verificado | user |
| `admin@xclusive.ao` | Administrador | admin |

## Funcionalidades principais

- **Feed** — posts de imagem, vídeo, carrossel e texto (estilo X/Twitter)
- **Reels** — vídeos curtos verticais com autoplay
- **Stories** — expiram ao fim de 24 h
- **Subscriptions** — criadores definem planos de acesso exclusivo em Kz
- **PPV (pay-per-view)** — desbloqueio de post individual por preço único
- **Gorjetas** — fãs enviam Kz diretamente ao criador
- **Mensagens** — DMs privados e grupos
- **Notificações** — likes, comentários, follows, subscrições, gorjetas
- **Painel criador** — ganhos, subscritores, taxa de retenção, pedidos de levantamento
- **KYC** — verificação de identidade em 6 passos
- **Painel de administração** — moderação, relatórios, audit log

## Variáveis de ambiente necessárias

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | Connection string PostgreSQL |
| `SESSION_SECRET` | Segredo para assinatura JWT |
