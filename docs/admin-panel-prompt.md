# Prompt: Painel de Administração — Xclusive

---

## CONTEXTO DO PROJETO

O **Xclusive** é uma plataforma de monetização de conteúdo para criadores africanos, focada em Angola, Moçambique, África do Sul e Portugal. Funciona como um Instagram/OnlyFans regionalizado: os utilizadores podem ser "pessoais" (consumidores) ou "criadores" (monetização via subscriçoes, conteúdo exclusivo pago por post e gorjetas). A moeda nativa é o Kwanza Angolano (AOA) / Metical Moçambicano (MZN) / Rand Sul-Africano (ZAR) — mas o saldo interno é representado como número decimal (ex: `1250.00`).

### Stack técnica existente

| Camada | Tecnologia |
|--------|-----------|
| Frontend app | React 18 + Vite + TypeScript + Wouter (routing) + TanStack Query v5 |
| UI kit | Shadcn/UI + Tailwind CSS v3 — **tema escuro como padrão** |
| Animações | Framer Motion |
| API server | Express 5 + TypeScript + Pino (logger) + Zod (validação) |
| ORM / DB | Drizzle ORM + PostgreSQL (Neon serverless) |
| Autenticação | Session-based (express-session + SESSION_SECRET) |
| Geração de cliente | Orval (OpenAPI → React Query hooks) |
| Monorepo | pnpm workspaces |
| Qualificação criadores | Fluxo KYC próprio em `/tornar-criador` (6 passos, câmara) |

### Schema da base de dados (campos críticos para o admin)

**`users`**
```
id, username, email, password_hash, nome_exibicao, bio, avatar_url, capa_url,
link, tipo_conta (enum: 'pessoal' | 'criador'), verificado (bool),
privado (bool), data_nascimento, ativo (bool), criado_em, saldo, ganhos
```

**`posts`**
```
id, autor_id, legenda, tipo (enum: 'imagem' | 'video'), exclusivo (bool),
preco_desbloqueio, criado_em
```
Relações: `post_media`, `likes`, `comments`, `saved_posts`

**`subscription_plans`**
```
id, criador_id, nome, descricao, preco, duracao_dias, beneficios (json), ativo
```

**`subscriptions`**
```
id, assinante_id, plano_id, estado (active | cancelled | expired),
inicio_em, fim_em
```

**`purchases`** (log de todas as transações monetárias)
```
id, comprador_id, criador_id, tipo (subscricao | ppv | gorjeta),
valor, post_id, plano_id, criado_em
```

**`stories`**
```
id, autor_id, media_url, tipo, duracao, audiencia (todos | subscritores), expira_em
```

**`conversations` + `messages`**
```
conversations: id, tipo (direto | grupo), criado_em
conversation_participants: conversa_id, utilizador_id, ultimo_lido_em
messages: id, conversa_id, remetente_id, conteudo, tipo (texto | imagem | video), lido, criado_em
```

### Rotas de API existentes (backend Express)

```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me

GET    /api/users/suggestions
PATCH  /api/users/me
GET    /api/users/:username
POST   /api/users/:username/follow
DELETE /api/users/:username/follow
GET    /api/users/:username/followers
GET    /api/users/:username/following
GET    /api/users/:username/posts
GET    /api/users/:username/reels

GET    /api/feed
POST   /api/posts
GET    /api/posts/:id
DELETE /api/posts/:id
POST   /api/posts/:id/like
DELETE /api/posts/:id/like
POST   /api/posts/:id/save
DELETE /api/posts/:id/save
GET    /api/posts/:id/comments
POST   /api/posts/:id/comments
POST   /api/posts/:postId/gorjeta
GET    /api/users/:username/gorjetas

GET    /api/reels
GET    /api/stories/feed

GET    /api/creator/stats
GET    /api/creator/plans
POST   /api/creator/plans
PATCH  /api/creator/plans/:id
DELETE /api/creator/plans/:id
GET    /api/creator/earnings
GET    /api/creator/transactions

POST   /api/subscriptions

GET    /api/conversations
POST   /api/conversations
GET    /api/conversations/:id/messages
POST   /api/conversations/:id/messages

GET    /api/notifications
POST   /api/notifications/read-all
GET    /api/notifications/unread-count

GET    /api/explore
GET    /api/search
```

### Páginas existentes no frontend Xclusive (app do utilizador)

`/` landing · `/login` · `/registo` · `/onboarding` · `/home` · `/explorar` · `/reels` · `/mensagens` · `/notificacoes` · `/perfil/:username` · `/carteira` · `/definicoes` · `/tornar-criador` (KYC) · `/monetizar`

### Papel de admin (ainda não existe)

Atualmente só existem dois tipos de conta: `pessoal` e `criador`. O campo `verificado` (bool) indica badge azul. Não existe campo `role` nem qualquer rota `/admin/*`. Tudo isso precisará ser criado do zero.

---

## TAREFA

Criar um **painel de administração completo** para a plataforma Xclusive como um novo artefacto separado (`artifacts/admin`) no monorepo pnpm existente. O admin corre na sua própria porta (variável de ambiente `PORT`) e tem o seu próprio fluxo de autenticação, completamente isolado da app principal.

---

## REQUISITOS DETALHADOS

### 1 — Artefacto e estrutura de ficheiros

- Criar `artifacts/admin/` como novo pacote pnpm com nome `@workspace/admin`
- Usar **React 18 + Vite + TypeScript** (igual à app principal)
- Usar **Shadcn/UI** com **tema escuro por defeito** (copiar `tailwind.config.ts` e `index.css` da app principal como base para não divergir no design system)
- O router deve ser **wouter** (consistência com o monorepo)
- Não usar o cliente Orval gerado — fazer chamadas HTTP directas via `fetch` ou `axios` para as rotas `/api/admin/*` que serão criadas
- Estrutura de pastas dentro de `artifacts/admin/src/`:
  ```
  pages/
    login.tsx
    dashboard.tsx
    users/
      index.tsx        ← lista/pesquisa de utilizadores
      [username].tsx   ← detalhe de utilizador
    creators/
      index.tsx        ← lista de criadores + fila de aprovação KYC
      [username].tsx   ← detalhe de criador (planos, ganhos, KYC)
    content/
      index.tsx        ← lista de posts e moderação
      reports.tsx      ← conteúdo reportado (futuro placeholder se não houver dados)
    finances/
      index.tsx        ← dashboard financeiro (receita, gorjetas, subscriçoes)
      transactions.tsx ← tabela completa de purchases
      withdrawals.tsx  ← pedidos de levantamento pendentes (placeholder)
    settings/
      index.tsx        ← configurações da plataforma
  components/
    layout/
      AdminLayout.tsx       ← wrapper com sidebar + topbar
      Sidebar.tsx           ← navegação lateral colapsável
      Topbar.tsx            ← barra superior com avatar admin + logout
    shared/
      StatsCard.tsx         ← card de KPI reutilizável
      DataTable.tsx         ← tabela genérica com paginação, sort, filtros
      UserAvatar.tsx        ← avatar + badge verificado
      StatusBadge.tsx       ← badge colorido para estados (ativo, suspenso, etc.)
      ConfirmDialog.tsx     ← modal de confirmação para ações destrutivas
      EmptyState.tsx        ← estado vazio reutilizável
  contexts/
    AdminAuthContext.tsx    ← estado de sessão do admin
  lib/
    api.ts                  ← cliente HTTP com interceptor de sessão
    utils.ts                ← cn(), formatCurrency(), formatDate(), etc.
  hooks/
    useAdminStats.ts
    useUsers.ts
    useCreators.ts
    usePosts.ts
    useFinances.ts
  ```

---

### 2 — Autenticação do admin

**Schema (adicionar à tabela `users` existente ou criar nova tabela)**

Opção recomendada: adicionar coluna `role` à tabela `users` existente:
```sql
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'
  CHECK (role IN ('user', 'admin', 'superadmin'));
```
O seed deve criar pelo menos um utilizador admin:
```ts
username: 'admin', email: 'admin@xclusive.ao', role: 'superadmin', ativo: true
```

**Fluxo de login do admin**
- Rota: `POST /api/admin/auth/login` — aceita `{ email, password }`, verifica `role IN ('admin', 'superadmin')`, devolve sessão
- Rota: `POST /api/admin/auth/logout`
- Rota: `GET /api/admin/auth/me` — devolve `{ id, username, email, role }`
- Middleware de protecção `requireAdmin` que verifica `req.session.userId` E que `role IN ('admin', 'superadmin')`; aplicar a todas as rotas `/api/admin/*`
- Página `/admin/login`: formulário simples (email + password), sem registo público, fundo escuro com logo Xclusive no centro
- `AdminAuthContext.tsx`: estado `{ admin, isLoading, login, logout }`, redireciona para `/admin/login` se não autenticado

---

### 3 — Dashboard principal (`/admin`)

KPIs em cards no topo (2 linhas × 4 colunas em desktop, 2×2 em tablet, 1 coluna em mobile):

| KPI | Dado | Cor do ícone |
|-----|------|-------------|
| Total de Utilizadores | `COUNT(*) FROM users WHERE role='user'` | Azul |
| Novos hoje | `COUNT(*) WHERE criado_em >= hoje` | Verde |
| Total de Criadores | `COUNT(*) WHERE tipo_conta='criador'` | Rosa (primary) |
| Criadores verificados | `COUNT(*) WHERE tipo_conta='criador' AND verificado=true` | Dourado |
| Posts publicados | `COUNT(*) FROM posts` | Roxo |
| Gorjetas enviadas hoje | `SUM(valor) FROM purchases WHERE tipo='gorjeta' AND criado_em >= hoje` | Laranja |
| Receita da plataforma (30d) | `SUM(valor * fee_percentagem) FROM purchases WHERE criado_em >= 30d` | Verde |
| Subscriçoes ativas | `COUNT(*) FROM subscriptions WHERE estado='active'` | Azul claro |

**Gráficos (usar Recharts — já instalado no monorepo ou instalar):**

1. **Crescimento de utilizadores** — LineChart, últimos 30 dias, dois datasets: "Pessoais" e "Criadores". Eixo X: datas. Eixo Y: novos registos por dia.
2. **Receita total** — AreaChart, últimos 30 dias, três datasets sobrepostos: "Gorjetas", "Subscriçoes", "PPV (conteúdo pago)". Tooltip com valor em AOA/MZN.
3. **Distribuição por país** — BarChart horizontal com barras para AO, MZ, ZA, PT, Outros. Deduzir país do campo `telefone` ou `pais` se existir.
4. **Top 5 criadores por ganhos** — tabela simples (avatar, username, ganhos total, subscritores activos) à direita dos gráficos.

**Feed de atividade recente** — lista vertical com os últimos 20 eventos da plataforma:
- "🧑 [username] registou-se há 3 min"
- "💰 [fan] enviou gorjeta de 500 AOA a [criador] há 5 min"
- "✅ [criador] submeteu KYC para aprovação há 12 min"
- "🚨 Post #1234 foi reportado por [utilizador] há 20 min"

Rota de backend necessária: `GET /api/admin/dashboard` — devolve todos os KPIs + dados dos gráficos num único response JSON.

---

### 4 — Gestão de Utilizadores (`/admin/utilizadores`)

**Lista principal**

- Tabela com colunas: Avatar, Username (link para detalhe), Nome de exibição, Email, Tipo de conta (badge), País, Verificado (ícone ✔/✗), Ativo (toggle), Data de registo, Ações
- Barra de pesquisa no topo: pesquisa em tempo real por `username` OU `email` OU `nome_exibicao` (debounce 300ms)
- Filtros em pills/chips horizontais:
  - Tipo de conta: Todos | Pessoal | Criador
  - Estado: Todos | Ativo | Suspenso
  - Verificado: Todos | Verificado | Não verificado
- Ordenação por colunas: data de registo (default: mais recente), total de seguidores, ganhos
- Paginação: 25 por página, selector de página + "próxima/anterior"
- Botão "Exportar CSV" que descarrega a query actual (filtros aplicados)

**Detalhe de utilizador (`/admin/utilizadores/:username`)**

Dividido em abas:

*Aba "Perfil"*
- Card com avatar grande, nome, username, email, bio, país, tipo de conta
- Editar directamente (inline edit): nome de exibição, bio, tipo de conta, verificado (toggle), ativo (toggle)
- Botão "Redefinir password" — envia email de reset (ou mostra um token temporário)
- Botão "Impersonar utilizador" (abrir a app principal como esse utilizador — gera token temporário)
- Botão "Suspender conta" → abre `ConfirmDialog` com campo obrigatório "Motivo da suspensão"; regista em audit log
- Botão "Eliminar conta" (vermelho, `superadmin` only) → confirmação dupla com texto "ELIMINAR" para confirmar

*Aba "Publicações"*
- Grid 3 colunas de posts do utilizador (miniatura, tipo, exclusivo?, likes, comentários, data)
- Cada post tem botão "Remover" (moderação) com motivo

*Aba "Transaçoes"*
- Tabela de todos os `purchases` onde `comprador_id = user.id` OU `criador_id = user.id`
- Colunas: Data, Tipo (badge colorido), Contraparte, Valor, Estado
- Total enviado / total recebido no topo

*Aba "Seguimentos"*
- Dois sub-tabs: "Fãs" e "A seguir"
- Listas simples com avatar + username + botão de perfil

Rotas de backend necessárias:
```
GET    /api/admin/users?page=&limit=&q=&tipo=&ativo=&verificado=&sort=
GET    /api/admin/users/:username
PATCH  /api/admin/users/:username          ← editar campos
POST   /api/admin/users/:username/suspend  ← { motivo }
POST   /api/admin/users/:username/activate
DELETE /api/admin/users/:username          ← superadmin only
GET    /api/admin/users/:username/posts
GET    /api/admin/users/:username/transactions
```

---

### 5 — Gestão de Criadores (`/admin/criadores`)

**Lista de criadores**

Tabela com colunas: Avatar, Username, Nome, KYC Status (badge), Verificado, Planos activos (nº), Subscritores activos (nº), Ganhos totais, Data de candidatura, Ações

Filtros:
- KYC: Todos | Pendente aprovação | Aprovado | Rejeitado
- Verificado: Todos | Verificado | Não verificado

**Fila de aprovação KYC** — destaque visual no topo da página quando existirem criadores com KYC pendente:
- Card amarelo/âmbar: "X criadores aguardam aprovação de KYC"
- Lista dos pendentes com: avatar, username, data de submissão, botão "Rever"

**Detalhe de criador (`/admin/criadores/:username`)**

*Aba "KYC / Verificação"*
- Mostrar as imagens submetidas no processo KYC (documento de identidade frente/verso, selfie com documento)
- Os campos: Nome completo (como no BI), Nº do documento, País de emissão, Data de validade
- Botões de ação:
  - ✅ "Aprovar e verificar" → `PATCH /api/admin/creators/:username/kyc { status: 'aprovado' }` → sets `verificado=true`
  - ❌ "Rejeitar" → modal com campo de motivo obrigatório → `PATCH /api/admin/creators/:username/kyc { status: 'rejeitado', motivo }`
  - Em ambos os casos, enviar notificação in-app ao criador

*Aba "Planos de Subscrição"*
- Tabela dos planos do criador: Nome, Preço, Duração, Subscritores actuais, Receita gerada, Ativo
- Admin pode desactivar plano (sem eliminar) se violar termos
- Botão "Ver subscritores" → modal com lista de subscritores activos

*Aba "Financeiro"*
- Ganhos totais, saldo atual, total levantado
- Gráfico de barras: ganhos por mês (últimos 6 meses)
- Tabela de transaçoes recebidas (gorjetas + subscriçoes + PPV)
- Campo para ajuste manual de saldo (superadmin only) com obrigatoriedade de motivo

Rotas de backend necessárias:
```
GET    /api/admin/creators?page=&limit=&kyc=&verificado=
GET    /api/admin/creators/:username
GET    /api/admin/creators/:username/kyc          ← imagens + dados KYC
PATCH  /api/admin/creators/:username/kyc          ← { status, motivo? }
GET    /api/admin/creators/:username/plans
PATCH  /api/admin/creators/:username/plans/:id    ← { ativo }
GET    /api/admin/creators/:username/financeiro
PATCH  /api/admin/creators/:username/saldo        ← { ajuste, motivo } superadmin only
```

---

### 6 — Moderação de Conteúdo (`/admin/conteudo`)

**Lista de posts**

- Tabela: Miniatura, Autor, Legenda (truncada), Tipo (imagem/video), Exclusivo, Preço (se ppv), Likes, Comentários, Data, Ações
- Filtros: Tipo (imagem | video | todos), Exclusivo (sim | não | todos), Reportado (sim | não | todos)
- Pesquisa por: legenda, username do autor
- Ao clicar na miniatura: modal lightbox com preview do conteúdo completo
- Ações por linha:
  - 👁 "Ver no perfil" → abre link externo para a app principal
  - 🗑 "Remover post" → ConfirmDialog com motivo → `DELETE /api/admin/posts/:id { motivo }`
  - 🔒 "Tornar privado" → esconde do feed mas não elimina → `PATCH /api/admin/posts/:id { visibilidade: 'oculto' }`

**Página de conteúdo reportado (`/admin/conteudo/reportes`)**

Nota: o schema de reportes ainda não existe — criar nova tabela `reports`:
```sql
CREATE TABLE reports (
  id SERIAL PRIMARY KEY,
  post_id INTEGER REFERENCES posts(id),
  reporter_id INTEGER REFERENCES users(id),
  motivo TEXT NOT NULL,           -- 'nudez' | 'spam' | 'discurso_odio' | 'outro'
  descricao TEXT,
  estado TEXT DEFAULT 'pendente', -- 'pendente' | 'resolvido' | 'ignorado'
  criado_em TIMESTAMPTZ DEFAULT NOW()
);
```
- Tabela de reportes com: Post (miniatura), Reportado por, Motivo, Descrição, Estado (badge), Data, Ações
- Filtro por estado: Pendente | Resolvido | Ignorado
- Ação "Resolver" → marcar como resolvido + opcionalmente remover post
- Ação "Ignorar" → marcar como ignorado (falso positivo)

Rotas necessárias:
```
GET    /api/admin/posts?page=&q=&tipo=&exclusivo=&reportado=
DELETE /api/admin/posts/:id
PATCH  /api/admin/posts/:id
GET    /api/admin/reports?page=&estado=
PATCH  /api/admin/reports/:id    ← { estado, remover_post? }
```

---

### 7 — Painel Financeiro (`/admin/financeiro`)

**Dashboard financeiro (`/admin/financeiro`)**

KPIs no topo:
- Receita bruta total (desde sempre)
- Receita bruta últimos 30 dias
- Comissão da plataforma (%) configurável nas definições
- Receita líquida da plataforma (bruta × comissão)
- Total de gorjetas enviadas
- Total de subscriçoes activas
- Volume PPV (conteúdo pago por post)
- Levantamentos pendentes (valor total em espera)

Gráfico principal: AreaChart com 3 séries (Gorjetas, Subscriçoes, PPV) por mês, últimos 12 meses

Selector de período: Últimos 7 dias | 30 dias | 90 dias | 12 meses | Personalizado (date picker range)

**Tabela de transaçoes (`/admin/financeiro/transacoes`)**

Colunas: ID, Data, Tipo (badge colorido: gorjeta=dourado, subscrição=azul, ppv=roxo), De (fan), Para (criador), Valor bruto, Comissão plataforma, Valor líquido criador, Estado

Filtros:
- Tipo: Todos | Gorjeta | Subscrição | PPV
- Período: date picker range
- Mínimo/máximo de valor

Exportar para CSV e Excel

**Levantamentos (`/admin/financeiro/levantamentos`)**

Nota: criar nova tabela `withdrawal_requests`:
```sql
CREATE TABLE withdrawal_requests (
  id SERIAL PRIMARY KEY,
  criador_id INTEGER REFERENCES users(id),
  valor DECIMAL(10,2) NOT NULL,
  metodo TEXT NOT NULL,        -- 'transferencia_bancaria' | 'mobile_money'
  detalhes_bancarios JSONB,    -- IBAN, número telefone, etc.
  estado TEXT DEFAULT 'pendente', -- 'pendente' | 'processado' | 'rejeitado'
  admin_nota TEXT,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  processado_em TIMESTAMPTZ
);
```
- Tabela de pedidos de levantamento: Criador, Método, Valor, Detalhes, Estado, Data pedido, Data processado, Nota admin
- Filtro por estado
- Ação "Marcar como processado" → `PATCH /api/admin/withdrawals/:id { estado: 'processado', nota? }`
- Ação "Rejeitar" → `PATCH /api/admin/withdrawals/:id { estado: 'rejeitado', nota (obrigatória) }`

Rotas necessárias:
```
GET  /api/admin/financeiro/dashboard?periodo=
GET  /api/admin/financeiro/transacoes?page=&tipo=&from=&to=&min=&max=
GET  /api/admin/financeiro/levantamentos?page=&estado=
PATCH /api/admin/financeiro/levantamentos/:id
```

---

### 8 — Notificações e Anúncios (`/admin/notificacoes`)

Formulário para enviar notificação push in-app a:
- Todos os utilizadores
- Apenas criadores
- Apenas pessoais
- Utilizador específico (por username)
- Utilizadores de um país específico

Campos do formulário:
- Título (máx. 80 caracteres)
- Mensagem (máx. 300 caracteres)
- Ícone/tipo: Informação | Aviso | Sucesso | Promoção
- Link de destino (opcional): URL interno da app (ex: `/monetizar`, `/carteira`)
- Agendar envio: Agora | Data e hora específica

Historial de notificações enviadas (tabela): Título, Destinatários, Enviadas, Lidas, Taxa de leitura %, Data

Rota necessária:
```
POST /api/admin/notifications/broadcast
  body: { titulo, mensagem, tipo, link?, audiencia, agendado_em? }
GET  /api/admin/notifications/history?page=
```

---

### 9 — Definições da Plataforma (`/admin/definicoes`)

Formulário de configuração guardado numa tabela `platform_settings` (chave-valor) ou em ficheiro `.env` via API:

```
CREATE TABLE platform_settings (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  descricao TEXT,
  atualizado_em TIMESTAMPTZ DEFAULT NOW(),
  atualizado_por INTEGER REFERENCES users(id)
);
```

Grupos de definições:

*Financeiras*
- Comissão da plataforma (%) — default: 15%
- Valor mínimo de gorjeta (AOA) — default: 50
- Valor máximo de gorjeta (AOA) — default: 50000
- Valor mínimo de levantamento — default: 1000
- Valor máximo de levantamento por dia — default: 100000

*KYC e Verificação*
- Modo KYC: Auto-aprovação | Revisão manual
- Documentos aceites: BI | Passaporte | Carta de condução (checkboxes)
- Idade mínima de criador (anos) — default: 18

*Conteúdo*
- Tamanho máximo de upload por ficheiro (MB) — default: 500
- Duração máxima de vídeo (minutos) — default: 30
- Resolução máxima de imagem (px) — default: 4096

*Conta e Acesso*
- Registo público: Ativo | Pausado (bloqueia novos registos)
- Países permitidos: checkboxes (AO, MZ, ZA, PT, BR, Todos)
- Modo de manutenção: Ativo | Inativo (quando activo, a app principal mostra página de manutenção)

Cada alteração registada em `audit_log`.

Rotas necessárias:
```
GET   /api/admin/settings
PATCH /api/admin/settings    ← { chave, valor }[] ou objecto de chaves
```

---

### 10 — Audit Log (`/admin/auditoria`)

Tabela de todas as ações administrativas para rastreabilidade:

```sql
CREATE TABLE audit_log (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER REFERENCES users(id),
  acao TEXT NOT NULL,           -- ex: 'user.suspend', 'post.delete', 'kyc.approve'
  recurso_tipo TEXT NOT NULL,   -- 'user' | 'post' | 'creator' | 'setting'
  recurso_id TEXT NOT NULL,     -- id ou username
  detalhes JSONB,               -- antes/depois ou parâmetros
  ip TEXT,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);
```

Interface: tabela com filtro por admin, por tipo de ação, por período. Não editável.

Rota: `GET /api/admin/audit?page=&admin=&acao=&from=&to=`

---

### 11 — Layout e Design do painel

**Sidebar (colapsável)**

Largura expandida: 260px | Colapsada: 72px (só ícones + tooltip)

Itens de navegação:
```
📊 Dashboard              /admin
👥 Utilizadores           /admin/utilizadores
⭐ Criadores              /admin/criadores
  └ Fila KYC (badge nº)
📸 Conteúdo               /admin/conteudo
  └ Reportes (badge nº)
💰 Financeiro             /admin/financeiro
  └ Transaçoes
  └ Levantamentos (badge nº)
🔔 Notificações           /admin/notificacoes
⚙️  Definições            /admin/definicoes
📋 Auditoria              /admin/auditoria
```

**Topbar**
- Logo Xclusive (pequeno, à esquerda)
- Botão de collapse da sidebar
- Breadcrumb dinâmico
- Ícone de notificações do admin (alertas internos: novo KYC, novo reporte)
- Avatar do admin + dropdown (Ver perfil público, Alterar password, Sair)

**Paleta de cores** (extensão do tema dark existente no Xclusive):
```css
--background: #0a0a0f        /* fundo principal */
--card: #111118              /* cards */
--border: #1e1e2e            /* bordas */
--primary: #ff3e72           /* rosa Xclusive */
--admin-accent: #6366f1      /* indigo para distinguir elementos admin */
--success: #22c55e
--warning: #f59e0b
--danger: #ef4444
--muted-foreground: #6b7280
```

**Tipografia:** Herdar `Inter` já presente no projecto.

**Badges de estado (StatusBadge component):**
- `ativo` → verde (`bg-green-500/10 text-green-400`)
- `suspenso` → vermelho (`bg-red-500/10 text-red-400`)
- `pendente` → âmbar (`bg-amber-500/10 text-amber-400`)
- `verificado` → azul (`bg-blue-500/10 text-blue-400`)
- `criador` → rosa (`bg-primary/10 text-primary`)
- `gorjeta` → dourado (`bg-yellow-500/10 text-yellow-400`)
- `subscricao` → azul (`bg-blue-500/10 text-blue-400`)
- `ppv` → roxo (`bg-purple-500/10 text-purple-400`)

---

### 12 — Modo mock para desenvolvimento

O admin deve ter o seu próprio `isMockMode` (detectado da mesma forma: sem `DATABASE_URL` ou flag `VITE_MOCK_MODE=true`).

Em mock mode:
- Todos os endpoints `/api/admin/*` devem retornar dados estáticos realistas (ficheiro `artifacts/admin/src/data/mockAdminData.ts`) com:
  - 50 utilizadores fictícios com nomes africanos/portugueses
  - 15 criadores (5 com KYC pendente, 8 aprovados, 2 rejeitados)
  - 200 posts
  - 500 transaçoes dos últimos 6 meses
  - 20 reportes (10 pendentes)
  - 8 pedidos de levantamento

---

### 13 — Segurança

- Todas as rotas `/api/admin/*` requerem `requireAdmin` middleware — nunca expor dados admin sem autenticação
- Rate limiting nas rotas admin (máx. 100 req/min por IP)
- Ações destrutivas (eliminar utilizador, eliminar post) exigem `role === 'superadmin'`
- Ajuste manual de saldo exige `role === 'superadmin'`
- Todas as ações admin registadas em `audit_log` com ID do admin, IP, timestamp e detalhes before/after
- Sessão do admin expira ao fim de 8 horas de inatividade
- CORS: o servidor admin só aceita origens do próprio domínio (sem acesso cross-origin externo)
- Sanitizar inputs em todos os formulários com Zod antes de escrever na base de dados
- Passwords de admin devem ter mínimo 12 caracteres com complexidade

---

### 14 — Requisitos de responsividade

- **Desktop (≥1280px):** sidebar expandida visível, tabelas com todas as colunas, gráficos side-by-side
- **Tablet (768–1279px):** sidebar colapsada (só ícones), tabelas com scroll horizontal, gráficos empilhados
- **Mobile (<768px):** sidebar em drawer (overlay), tabelas mostram só 3-4 colunas essenciais, navegação bottom-bar alternativa

---

### 15 — Endpoints a criar no servidor existente (`artifacts/api-server`)

Criar ficheiro `artifacts/api-server/src/routes/admin.ts` e registar em `artifacts/api-server/src/index.ts` com prefixo `/api/admin`. Aplicar `requireAdmin` a todas as sub-rotas. Lista completa consolidada:

```
-- Auth
POST   /api/admin/auth/login
POST   /api/admin/auth/logout
GET    /api/admin/auth/me

-- Dashboard
GET    /api/admin/dashboard

-- Utilizadores
GET    /api/admin/users
GET    /api/admin/users/:username
PATCH  /api/admin/users/:username
POST   /api/admin/users/:username/suspend
POST   /api/admin/users/:username/activate
DELETE /api/admin/users/:username
GET    /api/admin/users/:username/posts
GET    /api/admin/users/:username/transactions

-- Criadores
GET    /api/admin/creators
GET    /api/admin/creators/:username
GET    /api/admin/creators/:username/kyc
PATCH  /api/admin/creators/:username/kyc
GET    /api/admin/creators/:username/plans
PATCH  /api/admin/creators/:username/plans/:id
GET    /api/admin/creators/:username/financeiro
PATCH  /api/admin/creators/:username/saldo

-- Conteúdo
GET    /api/admin/posts
DELETE /api/admin/posts/:id
PATCH  /api/admin/posts/:id
GET    /api/admin/reports
PATCH  /api/admin/reports/:id

-- Financeiro
GET    /api/admin/financeiro/dashboard
GET    /api/admin/financeiro/transacoes
GET    /api/admin/financeiro/levantamentos
PATCH  /api/admin/financeiro/levantamentos/:id

-- Notificações
POST   /api/admin/notifications/broadcast
GET    /api/admin/notifications/history

-- Definições
GET    /api/admin/settings
PATCH  /api/admin/settings

-- Auditoria
GET    /api/admin/audit
```

---

### 16 — O que NÃO deve ser feito

- ❌ Não recriar o sistema de autenticação da app principal — o admin tem o seu próprio contexto isolado
- ❌ Não copiar/reutilizar componentes da app `artifacts/xclusive` directamente — criar componentes equivalentes no `artifacts/admin` (podem ter aparência similar mas não devem ser importados cross-artifact)
- ❌ Não usar o cliente Orval gerado em `lib/api-client-react` — o admin faz chamadas directas ao `/api/admin/*`
- ❌ Não modificar rotas ou schema existentes que quebrem a app principal
- ❌ Não expor dados sensíveis (password_hash, SESSION_SECRET) em qualquer resposta da API

---

### 17 — Deliverables (o que deve existir no final)

1. ✅ Artefacto `artifacts/admin` registado no monorepo com workflow próprio
2. ✅ Todas as migraçoes/alterações de schema aplicadas (nova coluna `role`, novas tabelas `reports`, `withdrawal_requests`, `audit_log`, `platform_settings`)
3. ✅ Rotas `/api/admin/*` implementadas no servidor existente com mock data quando sem DB
4. ✅ Todas as páginas listadas implementadas com dados reais (ou mock em modo dev)
5. ✅ Modo mock funcional com dados realistas para desenvolvimento
6. ✅ Utilizador admin seed: `admin@xclusive.ao` / `Admin@Xclusive2025!` com `role='superadmin'`
7. ✅ Documentação em `artifacts/admin/README.md`: como aceder, credenciais seed, como adicionar novos admins
