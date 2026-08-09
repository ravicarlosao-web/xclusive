---
name: Database schema drift compatibility
description: Runtime databases can lag behind the current Drizzle schema during staged migrations
---

When an endpoint must remain usable against a database with an older enum or
missing newer columns, avoid comparing against a new enum value directly and
avoid `select()` of the entire table. Cast enum columns to text for compatible
filters and select only the columns the endpoint actually needs.

**Why:** The development database may be provisioned before later schema
changes are applied; generated TypeScript and Drizzle table definitions can be
newer than the live database.

**How to apply:** Use this narrowly for read paths that need backwards
compatibility, while keeping schema migrations as a separate follow-up task.