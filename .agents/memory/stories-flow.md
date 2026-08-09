---
name: Stories creation flow
description: Stories reais precisam de upload persistente antes de criar o registo
---

O fluxo de criação de stories deve enviar o ficheiro por multipart para `/api/upload` (Bunny Storage) e só depois criar o registo via `/api/stories` com o URL devolvido; `blob:`/localStorage é apenas fallback de mock.

**Why:** O selector de ficheiro originalmente mostrava sucesso, mas guardava apenas um `blob:` URL local, tornando a story invisível para seguidores e perdida após a sessão.

**How to apply:** Ao alterar a criação de stories, manter a ordem upload → criação da story → invalidação da feed; não usar URLs temporários no modo real.