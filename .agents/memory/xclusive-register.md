---
name: Xclusive register flow
description: Registo em 2 passos com país/telefone/tipoConta no passo 2; rota é /registo
---

Ficheiro: artifacts/xclusive/src/pages/register.tsx

**Rota:** /registo (NÃO /register — App.tsx router e landing page usam /registo)

**Passo 1:** nomeCompleto, username, dataNascimento, email, password (com strength indicator). Validado antes de avançar via form.trigger().

**Passo 2:** Seletor de país (AO 🇦🇴 / MZ 🇲🇿 / ZA 🇿🇦 / PT 🇵🇹 / BR 🇧🇷 / Outro), telefone com prefixo auto do país, tipoConta (pessoal/criador), termos.

**Array COUNTRIES:** typed as const com code/name/flag/prefix/placeholder. Angola é default (index 0).

**Why:** Plataforma focada em Angola, Moçambique, África do Sul — país+telefone necessários para contexto de mercado e futura verificação SMS/WhatsApp.
