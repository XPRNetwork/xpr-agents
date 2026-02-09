#!/usr/bin/env bash
set -euo pipefail

# ════════════════════════════════════════════════════════════
# XPR Agent — Lightweight Start (no Docker)
# ════════════════════════════════════════════════════════════
#
# Usage:
#   ./start.sh --account myagent --key PVT_K1_... --api-key sk-ant-...
#   ./start.sh                  # (uses .env file or prompts)
#
# Requirements: Node.js >= 18
#

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
err()  { echo -e "${RED}✗${NC} $1" >&2; }
banner() { echo -e "\n${CYAN}${BOLD}$1${NC}\n"; }

# ── Check Node.js ──────────────────────────────
if ! command -v node &>/dev/null; then
  err "Node.js is required (>= 18). Install from https://nodejs.org"
  exit 1
fi

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  err "Node.js >= 18 required (found v$(node -v))"
  exit 1
fi

log "Node.js $(node -v)"

# ── Parse CLI args ─────────────────────────────
XPR_ACCOUNT="${XPR_ACCOUNT:-}"
XPR_PRIVATE_KEY="${XPR_PRIVATE_KEY:-}"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
XPR_NETWORK="${XPR_NETWORK:-testnet}"
XPR_RPC_ENDPOINT="${XPR_RPC_ENDPOINT:-}"
AGENT_MODEL="${AGENT_MODEL:-claude-sonnet-4-20250514}"
POLL_INTERVAL="${POLL_INTERVAL:-30}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --account) XPR_ACCOUNT="$2"; shift 2 ;;
    --key) XPR_PRIVATE_KEY="$2"; shift 2 ;;
    --api-key) ANTHROPIC_API_KEY="$2"; shift 2 ;;
    --network) XPR_NETWORK="$2"; shift 2 ;;
    --rpc) XPR_RPC_ENDPOINT="$2"; shift 2 ;;
    --model) AGENT_MODEL="$2"; shift 2 ;;
    --poll-interval) POLL_INTERVAL="$2"; shift 2 ;;
    *) warn "Unknown arg: $1"; shift ;;
  esac
done

# ── Load .env if it exists ─────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

if [ -f "$ENV_FILE" ]; then
  log "Loading config from $ENV_FILE"
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
fi

# ── Default RPC endpoint ──────────────────────
if [ -z "$XPR_RPC_ENDPOINT" ]; then
  if [ "$XPR_NETWORK" = "mainnet" ]; then
    XPR_RPC_ENDPOINT="https://proton.eosusa.io"
  else
    XPR_RPC_ENDPOINT="https://tn1.protonnz.com"
  fi
fi

# ── Interactive prompts if missing ─────────────
if [ -t 0 ]; then
  banner "XPR Agent — Lightweight Setup"

  if [ -z "$XPR_ACCOUNT" ]; then
    read -rp "XPR account name: " XPR_ACCOUNT
  fi
  if [ -z "$XPR_PRIVATE_KEY" ]; then
    read -rsp "Private key (PVT_K1_...): " XPR_PRIVATE_KEY
    echo
  fi
  if [ -z "$ANTHROPIC_API_KEY" ]; then
    read -rsp "Anthropic API key (sk-ant-...): " ANTHROPIC_API_KEY
    echo
  fi
fi

# ── Validate ───────────────────────────────────
if [ -z "$XPR_ACCOUNT" ] || [ -z "$XPR_PRIVATE_KEY" ] || [ -z "$ANTHROPIC_API_KEY" ]; then
  err "Missing required config. Provide via CLI args, .env file, or environment variables."
  echo ""
  echo "  Required:"
  echo "    --account <name>     XPR account name"
  echo "    --key <PVT_K1_...>   Private key"
  echo "    --api-key <sk-ant-...>  Anthropic API key"
  echo ""
  echo "  Optional:"
  echo "    --network <testnet|mainnet>"
  echo "    --rpc <url>"
  echo "    --model <model-id>"
  echo "    --poll-interval <seconds>"
  exit 1
fi

log "Account: ${XPR_ACCOUNT}"
log "Network: ${XPR_NETWORK} (${XPR_RPC_ENDPOINT})"
log "Model: ${AGENT_MODEL}"
log "Poll interval: ${POLL_INTERVAL}s"

# ── Set up agent directory ────────────────────
AGENT_DIR="${SCRIPT_DIR}/agent"

if [ ! -d "$AGENT_DIR" ] || [ ! -f "$AGENT_DIR/package.json" ]; then
  banner "Setting up agent runner..."
  mkdir -p "$AGENT_DIR"
  cd "$AGENT_DIR"

  log "Installing dependencies..."
  npm install --loglevel=warn 2>&1 | tail -3

  # Build TypeScript if dist/ doesn't exist
  if [ ! -f "dist/index.js" ]; then
    log "Building TypeScript..."
    npx tsc 2>&1 | tail -5
  fi
  log "Agent runner ready"
else
  cd "$AGENT_DIR"
  log "Agent directory exists"
  # Rebuild if source is newer than dist
  if [ ! -f "dist/index.js" ] || [ "src/index.ts" -nt "dist/index.js" ]; then
    log "Rebuilding TypeScript..."
    npm install --loglevel=warn 2>&1 | tail -1
    npx tsc 2>&1 | tail -5
  fi
fi

# ── Generate hook token if needed ─────────────
OPENCLAW_HOOK_TOKEN="${OPENCLAW_HOOK_TOKEN:-}"
if [ -z "$OPENCLAW_HOOK_TOKEN" ]; then
  OPENCLAW_HOOK_TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  log "Generated hook token"
fi

# ── Auto-detect Telegram bot token ────────────
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
  # Search common locations for existing Telegram bot tokens
  SEARCH_PATHS=(
    "$HOME/.clawdbot/.env"
    "$HOME/.clawdbot/config"
    "$HOME/.openclaw/.env"
    "$HOME/openclaw/.env"
    "$HOME/.env"
    "$HOME/protonlink-bot/.env"
    "$HOME/dex-bot/.env"
  )
  # Also search any .env files in ~/Documents/projects/
  if [ -d "$HOME/Documents/projects" ]; then
    while IFS= read -r f; do
      SEARCH_PATHS+=("$f")
    done < <(find "$HOME/Documents/projects" -maxdepth 3 -name ".env" -type f 2>/dev/null)
  fi

  for envpath in "${SEARCH_PATHS[@]}"; do
    if [ -f "$envpath" ]; then
      found_token=$(grep -m1 "^TELEGRAM_BOT_TOKEN=" "$envpath" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
      if [ -n "$found_token" ]; then
        TELEGRAM_BOT_TOKEN="$found_token"
        log "Found Telegram bot token in $envpath"
        break
      fi
    fi
  done

  # Interactive prompt if still not found
  if [ -z "$TELEGRAM_BOT_TOKEN" ] && [ -t 0 ]; then
    echo ""
    read -rp "Telegram bot token (optional, press Enter to skip): " TELEGRAM_BOT_TOKEN
  fi

  if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
    log "Telegram bridge enabled"
  else
    warn "No Telegram bot token found (bridge disabled)"
  fi
fi

# ── Save .env for next time ───────────────────
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<ENVEOF
XPR_ACCOUNT=${XPR_ACCOUNT}
XPR_PRIVATE_KEY=${XPR_PRIVATE_KEY}
XPR_PERMISSION=active
XPR_NETWORK=${XPR_NETWORK}
XPR_RPC_ENDPOINT=${XPR_RPC_ENDPOINT}
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
AGENT_MODEL=${AGENT_MODEL}
AGENT_MAX_TURNS=10
MAX_TRANSFER_AMOUNT=1000000
POLL_ENABLED=true
POLL_INTERVAL=${POLL_INTERVAL}
OPENCLAW_HOOK_TOKEN=${OPENCLAW_HOOK_TOKEN}
A2A_AUTH_REQUIRED=true
A2A_TOOL_MODE=full
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
ENVEOF
  log "Saved config to $ENV_FILE"
fi

# ── Export all env vars ───────────────────────
export XPR_ACCOUNT XPR_PRIVATE_KEY XPR_NETWORK XPR_RPC_ENDPOINT
export ANTHROPIC_API_KEY AGENT_MODEL OPENCLAW_HOOK_TOKEN
export POLL_ENABLED=true POLL_INTERVAL
export XPR_PERMISSION="${XPR_PERMISSION:-active}"
export AGENT_MAX_TURNS="${AGENT_MAX_TURNS:-10}"
export MAX_TRANSFER_AMOUNT="${MAX_TRANSFER_AMOUNT:-1000000}"
export A2A_AUTH_REQUIRED="${A2A_AUTH_REQUIRED:-true}"
export A2A_TOOL_MODE="${A2A_TOOL_MODE:-full}"
export TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
export PORT="${PORT:-8080}"

# ── Start ─────────────────────────────────────
banner "Starting XPR Agent..."
echo -e "  Account:  ${BOLD}${XPR_ACCOUNT}${NC}"
echo -e "  Network:  ${XPR_NETWORK}"
echo -e "  Model:    ${AGENT_MODEL}"
echo -e "  Poller:   every ${POLL_INTERVAL}s"
echo -e "  Telegram: ${TELEGRAM_BOT_TOKEN:+enabled}${TELEGRAM_BOT_TOKEN:-disabled}"
echo -e "  Port:     ${PORT}"
echo ""

exec node dist/index.js
