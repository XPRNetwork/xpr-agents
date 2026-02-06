#!/usr/bin/env bash
set -euo pipefail

echo "=== XPR Agent Operator Setup ==="
echo ""

# Check prerequisites
for cmd in docker curl; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "Error: $cmd is required but not installed."
    exit 1
  fi
done

if ! docker compose version &>/dev/null && ! docker-compose version &>/dev/null; then
  echo "Error: docker compose is required but not installed."
  exit 1
fi

# Determine docker compose command
COMPOSE="docker compose"
if ! docker compose version &>/dev/null; then
  COMPOSE="docker-compose"
fi

# Copy .env if not present
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
  echo "Please edit .env with your XPR_ACCOUNT and XPR_PRIVATE_KEY before continuing."
  echo ""
  read -rp "Press Enter after editing .env, or Ctrl+C to cancel..."
fi

# Source env
set -a
source .env
set +a

# Validate required env vars
if [ -z "${XPR_ACCOUNT:-}" ] || [ "$XPR_ACCOUNT" = "myagent" ]; then
  echo "Error: XPR_ACCOUNT must be set in .env"
  exit 1
fi

if [ -z "${XPR_PRIVATE_KEY:-}" ] || [[ "$XPR_PRIVATE_KEY" == PVT_K1_... ]]; then
  echo "Error: XPR_PRIVATE_KEY must be set in .env"
  exit 1
fi

# Generate tokens if not set
if [ -z "${OPENCLAW_HOOK_TOKEN:-}" ]; then
  OPENCLAW_HOOK_TOKEN=$(openssl rand -hex 32)
  echo "OPENCLAW_HOOK_TOKEN=$OPENCLAW_HOOK_TOKEN" >> .env
  echo "Generated OPENCLAW_HOOK_TOKEN"
fi

if [ -z "${WEBHOOK_ADMIN_TOKEN:-}" ]; then
  WEBHOOK_ADMIN_TOKEN=$(openssl rand -hex 32)
  echo "WEBHOOK_ADMIN_TOKEN=$WEBHOOK_ADMIN_TOKEN" >> .env
  echo "Generated WEBHOOK_ADMIN_TOKEN"
fi

echo ""
echo "Starting indexer..."
$COMPOSE up -d indexer

# Wait for indexer health
echo "Waiting for indexer to be healthy..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:3001/health >/dev/null 2>&1; then
    echo "Indexer is healthy."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "Error: Indexer did not become healthy in 30 seconds."
    echo "Check logs: $COMPOSE logs indexer"
    exit 1
  fi
  sleep 1
done

# Register webhook subscription for agent events
echo ""
echo "Registering webhook subscription..."
WEBHOOK_RESPONSE=$(curl -sf -X POST http://localhost:3001/api/webhooks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $WEBHOOK_ADMIN_TOKEN" \
  -d "{
    \"url\": \"http://openclaw:8080/hooks/agent\",
    \"token\": \"$OPENCLAW_HOOK_TOKEN\",
    \"event_filter\": [\"job.*\", \"feedback.*\", \"validation.*\", \"dispute.*\"],
    \"account_filter\": \"$XPR_ACCOUNT\"
  }" 2>/dev/null || echo '{"error": "failed"}')

echo "Webhook registration: $WEBHOOK_RESPONSE"

echo ""
echo "Starting OpenClaw gateway..."
$COMPOSE up -d openclaw

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Agent:    $XPR_ACCOUNT"
echo "Indexer:  http://localhost:3001"
echo "Gateway:  http://localhost:8080"
echo ""
echo "Next steps:"
echo "  1. Check indexer health: curl http://localhost:3001/health"
echo "  2. View logs: $COMPOSE logs -f"
echo "  3. Register your agent on-chain if not already registered"
echo "  4. The agent will auto-monitor for incoming jobs"
