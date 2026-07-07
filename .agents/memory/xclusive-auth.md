---
name: Xclusive auth wiring
description: How JWT token is wired to all API hooks in the Xclusive frontend
---

The rule: call `setAuthTokenGetter(() => localStorage.getItem('xclusive_token'))` at **module level** in `AuthContext.tsx` (before any component code). This wires the API client's `customFetch` to attach `Authorization: Bearer <token>` to every request automatically.

**Why:** The generated hooks use `customFetch` which only attaches the token if `_authTokenGetter` is registered. Without this call, all protected endpoints (feed, me, notifications, etc.) are called without auth headers and return 401.

**How to apply:** Import `setAuthTokenGetter` from `@workspace/api-client-react` alongside the other auth imports. Place the `setAuthTokenGetter(...)` call at module scope, not inside the component.
