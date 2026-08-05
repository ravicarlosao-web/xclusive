#!/bin/bash
set -e

echo "📦 A instalar dependências..."
pnpm install --frozen-lockfile

echo ""
echo "🗄️  A sincronizar schema da base de dados..."
pnpm --filter db push

echo ""
echo "🌱 A inserir dados de teste..."
pnpm --filter @workspace/scripts run seed

echo ""
echo "✅ Setup concluído!"
