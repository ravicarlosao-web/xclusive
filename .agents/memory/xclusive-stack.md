---
name: Xclusive stack overview
description: Key decisions and architecture for the Xclusive social platform
---

**Stack:** React + Vite frontend (artifact: xclusive, preview /), Express API server (artifact: api-server, port 8080, routes at /api/...), PostgreSQL via Drizzle ORM (lib/db).

**Auth:** JWT in localStorage, signed with SESSION_SECRET env var (fails fast if missing). Token attached via `setAuthTokenGetter` in AuthContext.

**Seed accounts** (password: `password123`):
- demo@xclusive.pt (pessoal)
- ana@xclusive.pt (criador, verificado)
- marcos@xclusive.pt (criador, verificado)
- sofia@xclusive.pt (criador)
- pedro@xclusive.pt (criador, verificado)
- luna@xclusive.pt (criador)

**Key schema tables:** users, follows, posts, post_media, likes, saved_posts, comments, hashtags, post_hashtags, stories, story_views, highlights, highlight_stories, reels, conversations, conversation_participants, messages, notifications, subscription_plans, subscriptions, purchases.

**Unique constraints applied directly via SQL** (drizzle push needs TTY for data-risky migrations): follows_unique, likes_unique, saved_posts_unique, story_views_unique.

**API routes:** /api/auth/*, /api/users/*, /api/feed, /api/posts/*, /api/stories/*, /api/reels/*, /api/explore, /api/search, /api/conversations/*, /api/notifications/*, /api/creator/*, /api/subscriptions/*.
