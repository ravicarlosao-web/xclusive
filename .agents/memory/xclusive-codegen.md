---
name: Xclusive Orval codegen collision fix
description: How to avoid Orval Get*Params type collision in api-spec openapi.yaml
---

**The rule:** Remove query params (like `page`, `limit`) from any OpenAPI operation that ALSO has path parameters. Instead, use only path params on those routes.

**Why:** Orval generates `Get*Params` both as a Zod schema and a TypeScript type. When an operation has path params AND query params simultaneously, the two definitions collide and cause a TypeScript build failure.

**Affected operations:** getUserFollowers, getUserFollowing, getUserPosts, getUserReels, getPostComments, getMessages — all have `:username` or `:id` path params and previously also had `page` query params.

**How to apply:** After any openapi.yaml change, run `pnpm run typecheck:libs` before testing the API routes. Codegen is in `lib/api-client-react` and `lib/api-zod`.
