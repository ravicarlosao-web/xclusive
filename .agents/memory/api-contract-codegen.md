---
name: API contract codegen source
description: The OpenAPI document is the source of truth for shared client enums and generated Zod schemas
---

When a backend route accepts a new enum value, update `lib/api-spec/openapi.yaml`
before touching generated client files. Run the api-spec codegen command so both
React client types and Zod schemas stay aligned; generated files must not be
edited manually.

**Why:** Runtime route validation can accept a value while stale generated
artifacts reject it at compile time, hiding valid backend behaviour behind casts.

**How to apply:** For contract changes, update OpenAPI, run codegen, remove
frontend type casts, then run the root `pnpm run typecheck`.