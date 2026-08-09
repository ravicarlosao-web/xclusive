---
name: New conversation flow
description: Starting a message from a profile must resolve a conversation before opening the thread
---

O botão de mensagem de um perfil deve chamar `POST /api/conversations` com o ID do utilizador alvo e navegar usando o `id` da conversa devolvida; o thread envia mensagens apenas para esse ID de conversa.

**Why:** O thread não cria conversas e a API rejeita IDs que não correspondem a uma participação válida, por isso navegar com o ID do utilizador causa `403 Sem acesso a esta conversa`.

**How to apply:** Manter a sequência criação/obtenção da conversa → navegação para `/mensagens/{conversationId}` → envio da mensagem; não usar `/mensagens/{userId}`.