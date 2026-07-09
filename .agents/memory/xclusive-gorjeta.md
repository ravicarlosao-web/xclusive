---
name: Xclusive gorjeta (tip) system
description: Mock tip/gorjeta flow — saldo in MockUser, TipModal UI, PostCard button, sidebar wallet display
---

## Architecture

**Saldo (balance):**
- `MockUser.saldo: number` (Kz) — seed users preloaded with realistic amounts (5k–67k Kz), new registrations get 1000 Kz welcome bonus.
- Migration in `seedMockUsersIfEmpty` adds saldo=5000 to any legacy user missing the field.
- `AuthContext` exposes `saldo: number | null` reactive state — synced after login, register, logout, and every successful tip.

**sendTip (AuthContext):**
- Validates: `Number.isFinite`, positive, integer amount; self-tip blocked at service layer (not just UI).
- Optimistic concurrency: re-reads localStorage immediately before write to reduce cross-tab double-spend risk.
- Records in `xclusive_mock_transactions` key (localStorage).
- Calls `setSaldo` after write — TipModal shows updated balance instantly in success state.

**TipModal:**
- Props: `creator` (username/nomeExibicao/avatarUrl/verificado), `postId?`, `onTipSent?` callback.
- Presets: 50, 100, 200, 500, 1000, 2000 Kz; custom input fallback.
- 3 phases: select → loading (spinner) → success (spring animation + updated balance).
- Disables send button when amount > saldo; also validates in handleSend (double-guard).

**PostCard:**
- Gorjeta button (Coins icon) hides on own posts (`user.username === post.autor.username`).
- Local `gorjetasCount` state increments on `onTipSent`.
- TipModal rendered inline inside article fragment.

**AppLayout sidebar:**
- Shows wallet pill (Wallet icon + "{saldo} Kz") when saldo !== null — only visible in mock/logged-in mode.

**API routes (gorjeta.ts):**
- `POST /api/posts/:postId/gorjeta` — auth-protected, rejects self-tips and invalid amounts, inserts into purchasesTable tipo='gorjeta'.
- `GET /api/users/:username/gorjetas` — filters by `tipo='gorjeta'` (fixed to not include subscriptions/PPV).

**Why `Number.isInteger` check in sendTip:**
Currency in Kz is integer-only; floating-point tips would corrupt saldo arithmetic.
