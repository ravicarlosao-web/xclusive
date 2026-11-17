#!/usr/bin/env bash
# EXEMPLO VERSIONADO (ilustrativo) de um script de deploy com a GUARDA DE MIGRAÇÕES. NÃO é o ~/deploy.sh real da VPS (esse não está no repositório e não foi lido ao escrever isto):
# serve só para mostrar ONDE a guarda entra — depois de ter o código novo no disco e ANTES do build e do `pm2 restart`. Os passos à volta (git pull, pnpm install, build) são genéricos;
# adapta-os ao teu. Procedimento completo: docs/deploy/guarda-migracoes.md.
set -euo pipefail

XCLUSIVE_DIR="${XCLUSIVE_DIR:-$HOME/xclusive}"   # raiz do repositório na VPS (ajusta)
cd "$XCLUSIVE_DIR"

git pull --ff-only
pnpm install --frozen-lockfile

# ── GUARDA DE MIGRAÇÕES (A guarda lê a base de dados, só leitura; sai com 1 se há migrações por aplicar) ──
# Tem de vir ANTES do build e do restart: se houver migrações por aplicar, o deploy pára aqui e o site continua na versão anterior.
( cd "$XCLUSIVE_DIR" && pnpm --filter @workspace/scripts exec tsx verificar-migracoes.mjs ) || { echo "DEPLOY RECUSADO: migrações por aplicar"; exit 1; }   # GUARDA-MIGRACOES

pnpm run build                                # (exemplo) build do que for preciso
pm2 restart xclusive-api --update-env         # nome do processo como no runbook do TOTP
