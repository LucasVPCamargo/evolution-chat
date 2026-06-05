#!/usr/bin/env bash
# Bootstrap da stack Evolution Chat no servidor.
# Rodar DENTRO de infra/ no servidor, depois de preencher .env e chatwoot.env.
#
#   chmod +x bootstrap.sh && ./bootstrap.sh
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Verificando .env e chatwoot.env..."
test -f .env || { echo "ERRO: .env não existe (copie de .env.example)"; exit 1; }
test -f chatwoot.env || { echo "ERRO: chatwoot.env não existe"; exit 1; }
grep -q "CHANGE_ME" .env chatwoot.env && { echo "ERRO: ainda há CHANGE_ME nos envs. Preencha o IP do servidor."; exit 1; } || true

echo "==> Subindo Postgres e Redis primeiro..."
docker compose --env-file .env up -d postgres redis

echo "==> Aguardando Postgres ficar saudável..."
until [ "$(docker inspect -f '{{.State.Health.Status}}' postgres 2>/dev/null)" = "healthy" ]; do
  sleep 2; echo "   ...aguardando postgres"
done

echo "==> Preparando banco do Chatwoot (migrations + seed)..."
docker compose --env-file .env run --rm chatwoot-rails bundle exec rails db:chatwoot_prepare

echo "==> Subindo a stack completa..."
docker compose --env-file .env up -d

echo ""
echo "==> Pronto. Status:"
docker compose ps
echo ""
echo "Evolution API: http://$(grep ^SERVER_IP .env | cut -d= -f2):8080"
echo "Chatwoot:      http://$(grep ^SERVER_IP .env | cut -d= -f2):3000"
echo ""
echo "Próximo passo: abrir o Chatwoot, criar a conta admin, gerar um Access Token"
echo "e atualizar CHATWOOT_API_TOKEN + CHATWOOT_ACCOUNT_ID no Vercel."
