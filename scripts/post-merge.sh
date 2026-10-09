#!/bin/bash
set -e

echo "📦 A instalar dependências..."
pnpm install --frozen-lockfile

echo ""
echo "🗄️  A sincronizar schema da base de dados..."
pnpm --filter @workspace/db run push

echo ""
# O seed cria contas de teste: só em desenvolvimento (NODE_ENV=development explícito).
if [ "${NODE_ENV:-}" = "development" ]; then
  echo "🌱 A inserir dados de teste (desenvolvimento)..."
  pnpm --filter @workspace/scripts run seed
else
  echo "⏭️  Seed ignorado (só corre com NODE_ENV=development)."
fi

echo ""
echo "✅ Setup concluído!"
