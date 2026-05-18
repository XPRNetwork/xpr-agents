#!/usr/bin/env bash
set -euo pipefail

# ════════════════════════════════════════════════════════════
# XPR Agent — Lightweight Start (no Docker)
# ════════════════════════════════════════════════════════════
#
# Usage:
#   ./start.sh --account myagent --api-key sk-ant-...
#   ./start.sh                  # (uses .env file or prompts)
#
# Requirements: Node.js >= 18, proton CLI with key in keychain
#
# This script does NOT take a private key. All signing is done by the
# proton CLI (which holds keys in an encrypted keychain). Set up once:
#
#   npm i -g @proton/cli
#   proton chain:set proton           # or proton-test
#   proton key:add                    # paste private key (stored encrypted)
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
# Defaults below MUST stay in sync with `.env.example` and the agent
# runner's own env-var defaults — drift causes operator surprise
# (e.g. .env says 1000 XPR cap but agent applies 100 XPR).
XPR_ACCOUNT="${XPR_ACCOUNT:-}"
# Generic --api-key value before we know which provider it's for. Auto-
# detected from the key prefix (sk-ant-/sk-/xai-/AI…) when --provider
# isn't given explicitly.
API_KEY=""
AGENT_LLM_PROVIDER="${AGENT_LLM_PROVIDER:-}"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
OPENAI_API_KEY="${OPENAI_API_KEY:-}"
XAI_API_KEY="${XAI_API_KEY:-}"
GEMINI_API_KEY="${GEMINI_API_KEY:-}"
XPR_NETWORK="${XPR_NETWORK:-mainnet}"
XPR_RPC_ENDPOINT="${XPR_RPC_ENDPOINT:-}"
# AGENT_MODEL stays empty by default — the agent runner picks the right
# default per provider (claude-sonnet-4-6, gpt-5, grok-3-latest,
# gemini-2.5-flash). Override here only if you want a specific model.
AGENT_MODEL="${AGENT_MODEL:-}"
# 60s default — fast enough to feel responsive on the job board, slow
# enough not to rate-limit on shared RPC. Tune via --poll-interval or
# POLL_INTERVAL in .env (the agent runner itself accepts down to 5s).
POLL_INTERVAL="${POLL_INTERVAL:-60}"
# 10000000 = 1000 XPR cap (smallest units, 4 decimals). Match .env.example.
MAX_TRANSFER_AMOUNT="${MAX_TRANSFER_AMOUNT:-10000000}"
AGENT_PUBLIC_URL="${AGENT_PUBLIC_URL:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --account) XPR_ACCOUNT="$2"; shift 2 ;;
    --key)
      err "--key is no longer supported. Use proton CLI keychain instead:"
      echo "  npm i -g @proton/cli"
      echo "  proton chain:set proton    # or proton-test"
      echo "  proton key:add"
      exit 1
      ;;
    --api-key) API_KEY="$2"; shift 2 ;;
    --provider) AGENT_LLM_PROVIDER="$2"; shift 2 ;;
    --network) XPR_NETWORK="$2"; shift 2 ;;
    --rpc) XPR_RPC_ENDPOINT="$2"; shift 2 ;;
    --model) AGENT_MODEL="$2"; shift 2 ;;
    --poll-interval) POLL_INTERVAL="$2"; shift 2 ;;
    *) warn "Unknown arg: $1"; shift ;;
  esac
done

# ── Resolve LLM provider + API key ──────────────
# Order: explicit --provider wins. Otherwise auto-detect from --api-key
# prefix. Otherwise scan per-provider env vars. Default 'anthropic' if
# we still don't know.
if [ -z "$AGENT_LLM_PROVIDER" ] && [ -n "$API_KEY" ]; then
  case "$API_KEY" in
    sk-ant-*)        AGENT_LLM_PROVIDER="anthropic" ;;
    xai-*)           AGENT_LLM_PROVIDER="xai" ;;
    sk-proj-*|sk-*)  AGENT_LLM_PROVIDER="openai" ;;
    AI*)             AGENT_LLM_PROVIDER="gemini" ;;
  esac
fi
if [ -z "$AGENT_LLM_PROVIDER" ]; then
  if [ -n "$ANTHROPIC_API_KEY" ]; then AGENT_LLM_PROVIDER="anthropic"
  elif [ -n "$OPENAI_API_KEY" ]; then AGENT_LLM_PROVIDER="openai"
  elif [ -n "$XAI_API_KEY" ]; then AGENT_LLM_PROVIDER="xai"
  elif [ -n "$GEMINI_API_KEY" ]; then AGENT_LLM_PROVIDER="gemini"
  else AGENT_LLM_PROVIDER="anthropic"
  fi
fi

# If --api-key was passed, route it into the right env var for the
# resolved provider. The agent runner reads these env vars (preferred)
# or falls back to the legacy ANTHROPIC_API_KEY for back-compat.
if [ -n "$API_KEY" ]; then
  case "$AGENT_LLM_PROVIDER" in
    anthropic) ANTHROPIC_API_KEY="$API_KEY" ;;
    openai)    OPENAI_API_KEY="$API_KEY" ;;
    xai)       XAI_API_KEY="$API_KEY" ;;
    gemini)    GEMINI_API_KEY="$API_KEY" ;;
  esac
fi

# ── Refuse legacy XPR_PRIVATE_KEY env var ──────
if [ -n "${XPR_PRIVATE_KEY:-}" ]; then
  err "XPR_PRIVATE_KEY is set in environment but is no longer supported."
  echo ""
  echo "  Migration:"
  echo "    1. proton key:add                          # paste your key"
  echo "    2. unset XPR_PRIVATE_KEY                   # or remove from .env"
  echo "    3. ./start.sh                              # restart"
  echo ""
  exit 1
fi

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

# ── Resolve which key to actually use for the chosen provider ──
case "$AGENT_LLM_PROVIDER" in
  anthropic) RESOLVED_API_KEY="$ANTHROPIC_API_KEY"; KEY_NAME="ANTHROPIC_API_KEY"; KEY_HINT="sk-ant-..." ;;
  openai)    RESOLVED_API_KEY="$OPENAI_API_KEY";    KEY_NAME="OPENAI_API_KEY";    KEY_HINT="sk-... or sk-proj-..." ;;
  xai)       RESOLVED_API_KEY="$XAI_API_KEY";       KEY_NAME="XAI_API_KEY";       KEY_HINT="xai-..." ;;
  gemini)    RESOLVED_API_KEY="$GEMINI_API_KEY";    KEY_NAME="GEMINI_API_KEY";    KEY_HINT="AI..." ;;
  *)
    err "Unknown LLM provider: '$AGENT_LLM_PROVIDER'. Supported: anthropic, openai, xai, gemini."
    exit 1
    ;;
esac

# ── Interactive prompts if missing ─────────────
if [ -t 0 ]; then
  banner "XPR Agent — Lightweight Setup"

  if [ -z "$XPR_ACCOUNT" ]; then
    read -rp "XPR account name: " XPR_ACCOUNT
  fi
  if [ -z "$RESOLVED_API_KEY" ]; then
    read -rsp "LLM API key for ${AGENT_LLM_PROVIDER} (${KEY_HINT}): " RESOLVED_API_KEY
    echo
    # Stash it back into the correct env-var slot for downstream code
    case "$AGENT_LLM_PROVIDER" in
      anthropic) ANTHROPIC_API_KEY="$RESOLVED_API_KEY" ;;
      openai)    OPENAI_API_KEY="$RESOLVED_API_KEY" ;;
      xai)       XAI_API_KEY="$RESOLVED_API_KEY" ;;
      gemini)    GEMINI_API_KEY="$RESOLVED_API_KEY" ;;
    esac
  fi
fi

# ── Validate ───────────────────────────────────
if [ -z "$XPR_ACCOUNT" ] || [ -z "$RESOLVED_API_KEY" ]; then
  err "Missing required config. Provide via CLI args, .env file, or environment variables."
  echo ""
  echo "  Required:"
  echo "    --account <name>          XPR account name"
  echo "    --api-key <key>           LLM API key for the chosen provider"
  echo ""
  echo "  LLM provider auto-detected from --api-key prefix when omitted:"
  echo "    sk-ant-...       → anthropic (default model: claude-sonnet-4-6)"
  echo "    sk-... / sk-proj → openai    (default model: gpt-5)"
  echo "    xai-...          → xai       (default model: grok-3-latest)"
  echo "    AI...            → gemini    (default model: gemini-2.5-flash)"
  echo ""
  echo "  Or set explicitly:  --provider <anthropic|openai|xai|gemini>"
  echo ""
  echo "  Signing key (no flag — handled by proton CLI):"
  echo "    proton key:add            # one-time setup"
  echo ""
  echo "  Optional:"
  echo "    --network <testnet|mainnet>"
  echo "    --rpc <url>"
  echo "    --model <model-id>"
  echo "    --poll-interval <seconds>"
  exit 1
fi

# ── Verify proton CLI has a key in keychain ────
# Detect-and-skip: if proton CLI is on PATH AND a key is already loaded,
# we say nothing and proceed. The user only sees instructions if something
# is missing.
if ! command -v proton &>/dev/null; then
  err "proton CLI is not installed. Signing actions will fail."
  echo ""
  echo "  Install + load your key (one-time setup):"
  echo "    npm i -g @proton/cli"
  echo "    # if 'proton: command not found' after install:"
  echo "    #   export PATH=\"\$(npm config get prefix)/bin:\$PATH\""
  echo "    proton chain:set proton                 # or proton-test"
  echo "    proton key:add                          # paste PVT_K1_yourkey"
  echo "    # On a hosted console without a real TTY:"
  echo "    #   echo \"no\" | proton key:add PVT_K1_yourkey"
  echo ""
  warn "Continuing in best-effort mode — agent will boot but cannot sign."
else
  # Match the exact `"account": "myagent"` JSON line — substring matching
  # against the raw output false-positives on public keys (PUB_K1_…).
  # If no key is loaded, key:list prints `[]` and the grep falls through.
  if ! proton key:list 2>/dev/null | grep -qE "\"account\"[[:space:]]*:[[:space:]]*\"${XPR_ACCOUNT}\""; then
    # Last-resort: any key at all? The accounts[] array can be empty
    # if the chain lookup at `key:add` time failed; we'd still want to
    # proceed and let the agent surface the actual signing error.
    if ! proton key:list 2>/dev/null | grep -q '"publicKey"'; then
      warn "proton CLI has no keys loaded. Signing actions will fail until you add one:"
      echo ""
      echo "    proton chain:set proton                 # or proton-test"
      echo "    proton key:add                          # paste PVT_K1_yourkey"
      echo "    # On a hosted console without a real TTY:"
      echo "    #   echo \"no\" | proton key:add PVT_K1_yourkey"
      echo ""
      echo "  Then re-run ./start.sh — no other flags or env vars needed."
    else
      warn "proton CLI has keys loaded but none are linked to '${XPR_ACCOUNT}' (chain lookup may be stale)."
      echo "  Proceeding anyway — if signing fails, run:"
      echo "    proton key:list                         # confirm the right key is loaded"
      echo "    proton key:add                          # if not"
    fi
  fi
fi

log "Account: ${XPR_ACCOUNT}"
log "Network: ${XPR_NETWORK} (${XPR_RPC_ENDPOINT})"
log "LLM: ${AGENT_LLM_PROVIDER}${AGENT_MODEL:+ (${AGENT_MODEL})}"
log "Poll interval: ${POLL_INTERVAL}s"

# ── Pillar 2 diagnostic (recommend owner-permission lockdown) ────
# Quick check: does the agent's owner permission have raw keys?
# If so, recommend ./setup-security.sh. Idempotent and non-blocking.
if command -v proton &>/dev/null; then
  ACCT_JSON=$(proton account "$XPR_ACCOUNT" --json 2>/dev/null || true)
  if [ -n "$ACCT_JSON" ]; then
    OWNER_RAW_KEYS=$(printf '%s' "$ACCT_JSON" | node -e "
      let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{
        try {
          const a = JSON.parse(s);
          const owner = (a.permissions||[]).find(p=>p.perm_name==='owner');
          const keys = (owner?.required_auth?.keys||[]).length;
          console.log(keys);
        } catch(e) { console.log('-1'); }
      });
    " 2>/dev/null || echo "-1")
    if [ "$OWNER_RAW_KEYS" -gt 0 ] 2>/dev/null; then
      warn "Security: '${XPR_ACCOUNT}' owner permission still has raw keys."
      echo "  If the active key leaks, an attacker can rotate you out of your own account."
      echo ""
      echo "  Recommended (one-time, ~30 seconds):"
      if [ -f "${SCRIPT_DIR}/setup-security.sh" ]; then
        echo "    ./setup-security.sh                     # interactive, in-place"
      else
        echo "    npx @xpr-agents/openclaw xpr-agents-setup-security --account ${XPR_ACCOUNT}"
      fi
      echo ""
      echo "  See: https://github.com/XPRNetwork/xpr-agents/blob/main/docs/SECURITY.md"
      echo ""
    fi
  fi
fi

# ── Set up agent directory ────────────────────
AGENT_DIR="${SCRIPT_DIR}/agent"
REPO_URL="https://github.com/XPRNetwork/xpr-agents/archive/refs/heads/main.tar.gz"

if [ ! -f "$AGENT_DIR/package.json" ]; then
  banner "Downloading agent runner..."
  TMP_DIR=$(mktemp -d)
  curl -sL "$REPO_URL" -o "$TMP_DIR/repo.tar.gz"
  tar xzf "$TMP_DIR/repo.tar.gz" -C "$TMP_DIR"
  rm -rf "$AGENT_DIR"
  cp -r "$TMP_DIR/xpr-agents-main/openclaw/starter/agent" "$AGENT_DIR"
  rm -rf "$TMP_DIR"
  log "Agent runner downloaded"
fi

cd "$AGENT_DIR"

if [ ! -d "node_modules" ]; then
  banner "Installing dependencies..."
  npm install --loglevel=warn 2>&1 | tail -3
fi

if [ ! -f "dist/index.js" ] || [ "src/index.ts" -nt "dist/index.js" ]; then
  log "Building TypeScript..."
  npx tsc 2>&1 | tail -5
fi

log "Agent runner ready"

# ── Generate hook token if needed ─────────────
OPENCLAW_HOOK_TOKEN="${OPENCLAW_HOOK_TOKEN:-}"
if [ -z "$OPENCLAW_HOOK_TOKEN" ]; then
  OPENCLAW_HOOK_TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  log "Generated hook token"
fi

# ── Telegram bot token (optional, off by default) ────
# Previously this auto-recursed ~/Documents/projects/**/.env looking
# for a token to reuse — undocumented, surprised operators, and on
# multi-tenant boxes leaked tokens between unrelated projects. Now
# strictly opt-in: set TELEGRAM_BOT_TOKEN in env or .env, or paste at
# the interactive prompt below.
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
if [ -z "$TELEGRAM_BOT_TOKEN" ] && [ -t 0 ]; then
  echo ""
  read -rp "Telegram bot token (optional, press Enter to skip): " TELEGRAM_BOT_TOKEN
fi
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  log "Telegram bridge enabled"
fi

# ── Save .env for next time ───────────────────
# Defaults below match .env.example. Operators can edit afterward;
# this is the first-run-only seed.
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<ENVEOF
XPR_ACCOUNT=${XPR_ACCOUNT}
XPR_PERMISSION=active
XPR_NETWORK=${XPR_NETWORK}
XPR_RPC_ENDPOINT=${XPR_RPC_ENDPOINT}
INDEXER_URL=${INDEXER_URL:-https://indexer.xpragents.com}
# LLM provider — anthropic | openai | xai | gemini. Set only ONE key.
AGENT_LLM_PROVIDER=${AGENT_LLM_PROVIDER}
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
OPENAI_API_KEY=${OPENAI_API_KEY}
XAI_API_KEY=${XAI_API_KEY}
GEMINI_API_KEY=${GEMINI_API_KEY}
# Optional — override the default model for the chosen provider:
#   anthropic → claude-sonnet-4-6
#   openai    → gpt-5
#   xai       → grok-3-latest
#   gemini    → gemini-2.5-flash
AGENT_MODEL=${AGENT_MODEL}
AGENT_MODE=worker
AGENT_MAX_TURNS=20
MAX_TRANSFER_AMOUNT=${MAX_TRANSFER_AMOUNT}
POLL_ENABLED=true
POLL_INTERVAL=${POLL_INTERVAL}
# Public URL where this agent can be reached for A2A. Leave blank if
# you don't expose the agent — it'll register on chain as localhost,
# which is fine for solo job-board work but blocks A2A discovery.
AGENT_PUBLIC_URL=${AGENT_PUBLIC_URL}
OPENCLAW_HOOK_TOKEN=${OPENCLAW_HOOK_TOKEN}
A2A_AUTH_REQUIRED=true
A2A_TOOL_MODE=full
# A2A_SIGNING_KEY: separate key for outbound A2A (proton CLI can't sign
# arbitrary HTTP digests). Without it, outbound A2A is disabled —
# receive-only mode. See docs/A2A.md for the custom-permission setup.
A2A_SIGNING_KEY=
COST_MARGIN=2.0
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
# Optional capability keys — see template/.env.example for the full list:
#   PINATA_JWT, PINATA_GATEWAY (IPFS deliverables)
#   GITHUB_TOKEN, GITHUB_OWNER (code repo deliverables)
#   REPLICATE_API_TOKEN (image/video generation)
#   COINGECKO_API_KEY (crypto price data)
#   SHELLBOOK_API_KEY (Shellbook write tools)
ENVEOF
  log "Saved config to $ENV_FILE"
fi

# ── Export all env vars ───────────────────────
# These mirror the .env defaults — keep in sync.
export XPR_ACCOUNT XPR_NETWORK XPR_RPC_ENDPOINT
export AGENT_LLM_PROVIDER AGENT_MODEL OPENCLAW_HOOK_TOKEN
export ANTHROPIC_API_KEY OPENAI_API_KEY XAI_API_KEY GEMINI_API_KEY
export POLL_ENABLED=true POLL_INTERVAL
export INDEXER_URL="${INDEXER_URL:-https://indexer.xpragents.com}"
export XPR_PERMISSION="${XPR_PERMISSION:-active}"
export AGENT_MODE="${AGENT_MODE:-worker}"
export AGENT_MAX_TURNS="${AGENT_MAX_TURNS:-20}"
export MAX_TRANSFER_AMOUNT="${MAX_TRANSFER_AMOUNT}"
export AGENT_PUBLIC_URL="${AGENT_PUBLIC_URL:-}"
export A2A_AUTH_REQUIRED="${A2A_AUTH_REQUIRED:-true}"
export A2A_TOOL_MODE="${A2A_TOOL_MODE:-full}"
export A2A_SIGNING_KEY="${A2A_SIGNING_KEY:-}"
export COST_MARGIN="${COST_MARGIN:-2.0}"
export TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
export PINATA_JWT="${PINATA_JWT:-}"
export PORT="${PORT:-8080}"

# ── Start ─────────────────────────────────────
banner "Starting XPR Agent..."
echo -e "  Account:  ${BOLD}${XPR_ACCOUNT}${NC}"
echo -e "  Network:  ${XPR_NETWORK}"
echo -e "  LLM:      ${AGENT_LLM_PROVIDER}${AGENT_MODEL:+ (${AGENT_MODEL})}"
echo -e "  Poller:   every ${POLL_INTERVAL}s"
echo -e "  Telegram: ${TELEGRAM_BOT_TOKEN:+enabled}${TELEGRAM_BOT_TOKEN:-disabled}"
echo -e "  Port:     ${PORT}"
echo ""

exec node dist/index.js
