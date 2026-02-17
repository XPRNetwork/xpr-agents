#!/bin/bash
set -e

# XPR Agent Moltworker Startup Script
#
# Configures the OpenClaw plugin with XPR agent settings from environment
# variables, then starts the moltworker.

echo "[xpr-agent] Starting XPR Agent Moltworker..."

# Validate required environment variables
if [ -z "$XPR_ACCOUNT" ]; then
  echo "[xpr-agent] ERROR: XPR_ACCOUNT is required"
  exit 1
fi

if [ -z "$XPR_PRIVATE_KEY" ]; then
  echo "[xpr-agent] ERROR: XPR_PRIVATE_KEY is required"
  exit 1
fi

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "[xpr-agent] ERROR: ANTHROPIC_API_KEY is required"
  exit 1
fi

# Set defaults
export XPR_NETWORK="${XPR_NETWORK:-testnet}"

# Set RPC endpoint based on network if not explicitly provided
if [ -z "$XPR_RPC_ENDPOINT" ]; then
  if [ "$XPR_NETWORK" = "mainnet" ]; then
    export XPR_RPC_ENDPOINT="https://proton.eosusa.io"
  else
    export XPR_RPC_ENDPOINT="https://tn1.protonnz.com"
  fi
fi

# Set indexer URL default
export INDEXER_URL="${INDEXER_URL:-}"

# Generate hook token if not set
if [ -z "$OPENCLAW_HOOK_TOKEN" ]; then
  export OPENCLAW_HOOK_TOKEN=$(openssl rand -hex 32)
  echo "[xpr-agent] Generated OPENCLAW_HOOK_TOKEN"
fi

# Cost optimization: auto-sleep after idle period
export SANDBOX_SLEEP_AFTER="${SANDBOX_SLEEP_AFTER:-300}"

echo "[xpr-agent] Account: $XPR_ACCOUNT"
echo "[xpr-agent] Network: $XPR_NETWORK"
echo "[xpr-agent] RPC: $XPR_RPC_ENDPOINT"
echo "[xpr-agent] Sleep after: ${SANDBOX_SLEEP_AFTER}s"

# Start the moltworker
exec /app/entrypoint.sh "$@"
