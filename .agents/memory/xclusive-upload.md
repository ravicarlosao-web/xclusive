---
name: Xclusive file upload UX
description: CreatePostModal usa blob URLs para preview — não são uploads persistentes
---

CreatePostModal em artifacts/xclusive/src/components/shared/CreatePostModal.tsx usa URL.createObjectURL() para criar blob: URLs dos ficheiros selecionados, que são passados ao createPost como media URLs.

**Why:** blob: URLs morrem ao refresh — posts criados sem upload real não mostram media após reload. Intencional para fase DB-less.

**How to apply:** Para persistência real, substituir blob URLs por upload multipart para object storage (skill object-storage). Blob URLs ficam como source de preview in-modal; o upload deve produzir URL durável antes de chamar createPost.

**On API error:** Mostra warning toast ("Servidor indisponível. A publicação fica visível apenas nesta sessão.") em vez de falso sucesso.
