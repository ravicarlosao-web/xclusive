---
name: Xclusive file upload UX
description: CreatePostModal usa blob URLs para preview — não são uploads persistentes
---

CreatePostModal em artifacts/xclusive/src/components/shared/CreatePostModal.tsx usa URL.createObjectURL() para criar blob: URLs dos ficheiros selecionados, que são passados ao createPost como media URLs.

**Why:** blob: URLs morrem ao refresh — posts criados sem upload real não mostram media após reload. Intencional para fase DB-less.

**How to apply:** Para persistência real, substituir blob URLs por upload multipart para object storage (skill object-storage). Blob URLs ficam como source de preview in-modal; o upload deve produzir URL durável antes de chamar createPost.

**On API error:** Mostra warning toast ("Servidor indisponível. A publicação fica visível apenas nesta sessão.") em vez de falso sucesso.

**Upload real:** O endpoint multipart depende de `multer` materializado no package do API server e das três configurações Bunny (`BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_PASSWORD`, `BUNNY_CDN_HOSTNAME`). Sem elas, o fluxo autenticado falha com 503 antes de criar o post.

**Why:** O teste mobile inicialmente parecia um problema de submissão, mas a causa foi operacional: dependências declaradas não instaladas e Bunny ausente; o FormData e o contrato `PostMedia.url: string | null` eram compatíveis.

**How to apply:** Ao investigar falhas de publicação, confirmar primeiro que a API arranca, que `POST /api/upload` recebe multipart autenticado e que os Secrets Bunny existem; só depois investigar payload ou timeout.

**Mobile layout:** O modal de publicação precisa manter o cabeçalho fixo e limitar o conteúdo dos detalhes ao viewport (`dvh`), com scroll no corpo; caso contrário o botão de partilha fica inacessível em ecrãs pequenos ou com teclado virtual.
