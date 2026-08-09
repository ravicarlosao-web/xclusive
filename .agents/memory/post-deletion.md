---
name: Post deletion flow
description: Post deletion must clean Bunny media and post-owned database data for both authors and admins
---

A eliminação de posts deve passar por uma rotina partilhada: recolher URLs de `post_media`, converter URLs Bunny em storage keys, chamar `deleteFile`, remover likes polimórficos explicitamente e apagar o post para activar os cascades de media, comentários e saves.

**Why:** O endpoint de autor e o endpoint admin tinham comportamentos diferentes e apagar apenas o registo deixava ficheiros Bunny órfãos; likes não têm foreign key para cascade.

**How to apply:** Manter a autorização no endpoint (autor ou admin/superadmin) e a limpeza numa única rotina, com confirmação no cliente antes da mutação.