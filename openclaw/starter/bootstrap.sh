#!/usr/bin/env bash
set -euo pipefail

# ════════════════════════════════════════════════════════════
# XPR Agent Operator — Self-Contained Bootstrap
# ════════════════════════════════════════════════════════════
#
# No repo clone needed. Pulls public Docker images and starts.
#
# Interactive:
#   curl -fsSL https://gist.githubusercontent.com/.../bootstrap.sh | bash
#
# Non-interactive:
#   curl -fsSL ... | bash -s -- --account myagent --key PVT_K1_xxx --api-key sk-ant-xxx
#

VERSION="0.2.0"
INDEXER_IMAGE="ghcr.io/paulgnz/xpr-agents-indexer:latest"
AGENT_IMAGE="ghcr.io/paulgnz/xpr-agent-runner:latest"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# Defaults
NETWORK="testnet"
XPR_ACCOUNT=""
XPR_PRIVATE_KEY=""
ANTHROPIC_API_KEY=""
AGENT_MODEL=""
MAX_TRANSFER_AMOUNT=""
NON_INTERACTIVE=false
WORK_DIR="xpr-agent"

usage() {
  cat <<EOF
${BOLD}XPR Agent Operator Bootstrap v${VERSION}${NC}

Deploy an autonomous AI agent on XPR Network in one command.
No git clone needed — pulls public Docker images directly.

${BOLD}USAGE:${NC}
    curl -fsSL <url> | bash
    curl -fsSL <url> | bash -s -- [OPTIONS]

${BOLD}OPTIONS:${NC}
    --account <name>      XPR Network account name (required)
    --key <private_key>   Account private key (required)
    --api-key <key>       Anthropic API key (required)
    --network <net>       Network: testnet (default) or mainnet
    --model <model>       Claude model (default: claude-sonnet-4-20250514)
    --max-amount <n>      Max XPR transfer in smallest units (default: 1000000)
    --dir <path>          Working directory (default: xpr-agent)
    --non-interactive     Skip all prompts (requires all flags)
    --help                Show this help

${BOLD}WHAT YOU NEED:${NC}
    1. Docker installed (https://docker.com)
    2. A XPR Network account (free):
       npm install -g @proton/cli && proton chain:set proton-test && proton account:create myagent
    3. Your account's private key (proton key:list)
    4. An Anthropic API key (https://console.anthropic.com)

${BOLD}EXAMPLES:${NC}
    # Interactive wizard
    curl -fsSL <url> | bash

    # One-liner
    curl -fsSL <url> | bash -s -- --account myagent --key PVT_K1_xxx --api-key sk-ant-xxx

    # Mainnet
    curl -fsSL <url> | bash -s -- --account myagent --key PVT_K1_xxx --api-key sk-ant-xxx --network mainnet

EOF
  exit 0
}

# ── Parse CLI Arguments ──────────────────────

while [[ $# -gt 0 ]]; do
  case $1 in
    --account)      XPR_ACCOUNT="$2"; shift 2 ;;
    --key)          XPR_PRIVATE_KEY="$2"; shift 2 ;;
    --api-key)      ANTHROPIC_API_KEY="$2"; shift 2 ;;
    --network)      NETWORK="$2"; shift 2 ;;
    --model)        AGENT_MODEL="$2"; shift 2 ;;
    --max-amount)   MAX_TRANSFER_AMOUNT="$2"; shift 2 ;;
    --dir)          WORK_DIR="$2"; shift 2 ;;
    --non-interactive) NON_INTERACTIVE=true; shift ;;
    --help|-h)      usage ;;
    *) echo -e "${RED}Unknown option: $1${NC}"; echo "Use --help for usage"; exit 1 ;;
  esac
done

# ── Helpers ──────────────────────────────────

log()     { echo -e "${CYAN}[setup]${NC} $*"; }
success() { echo -e "${GREEN}  ✓${NC} $*"; }
warn()    { echo -e "${YELLOW}  !${NC} $*"; }
fail()    { echo -e "${RED}  ✗ $*${NC}"; exit 1; }

prompt_value() {
  local varname="$1" prompt="$2" default="${3:-}" secret="${4:-false}"
  local current="${!varname:-}"
  if [ -n "$current" ]; then return; fi
  if [ "$NON_INTERACTIVE" = true ]; then
    if [ -n "$default" ]; then eval "$varname='$default'"; return; fi
    fail "$varname is required in non-interactive mode (use --help)"
  fi
  if [ "$secret" = true ]; then
    echo -en "${BOLD}$prompt${NC}: " > /dev/tty
    read -rs value < /dev/tty; echo "" > /dev/tty
  else
    echo -en "${BOLD}$prompt${NC}" > /dev/tty
    [ -n "$default" ] && echo -n " [$default]" > /dev/tty || true
    echo -n ": " > /dev/tty
    read -r value < /dev/tty
  fi
  value="${value:-$default}"
  [ -z "$value" ] && fail "$varname is required"
  eval "$varname='$value'"
}

prompt_choice() {
  local varname="$1" prompt="$2"; shift 2
  local options=("$@")
  local current="${!varname:-}"
  if [ -n "$current" ]; then return; fi
  echo -e "\n${BOLD}$prompt${NC}" > /dev/tty
  for i in "${!options[@]}"; do echo "  $((i + 1))) ${options[$i]}" > /dev/tty; done
  echo -n "Choice [1]: " > /dev/tty; read -r choice < /dev/tty
  choice="${choice:-1}"
  local idx=$((choice - 1))
  [ "$idx" -lt 0 ] || [ "$idx" -ge "${#options[@]}" ] && idx=0
  eval "$varname='${options[$idx]}'"
}

# ── Banner ───────────────────────────────────

echo ""
echo -e "${BOLD}═══════════════════════════════════════════${NC}"
echo -e "${BOLD}  XPR Agent Operator v${VERSION}${NC}"
echo -e "${BOLD}═══════════════════════════════════════════${NC}"
echo ""

# ── Prerequisites ────────────────────────────

log "Checking prerequisites..."

for cmd in docker curl openssl; do
  command -v "$cmd" &>/dev/null || fail "$cmd is required but not installed"
  success "$cmd"
done

COMPOSE=""
if docker compose version &>/dev/null; then
  COMPOSE="docker compose"
elif docker-compose version &>/dev/null; then
  COMPOSE="docker-compose"
else
  fail "docker compose is required"
fi
success "$COMPOSE"

# ── Gather Configuration ─────────────────────

echo ""
log "Configuration"

prompt_choice NETWORK "Select network:" "testnet" "mainnet"
success "Network: $NETWORK"

# Network endpoints
if [ "$NETWORK" = "mainnet" ]; then
  RPC_ENDPOINT="https://proton.eosusa.io"
  HYPERION="https://proton.eosusa.io"
else
  RPC_ENDPOINT="https://tn1.protonnz.com"
  HYPERION="https://api-xprnetwork-test.saltant.io"
fi

# ── Account Setup ────────────────────────────

# If account/key not provided via flags, ask if they have one
if [ -z "$XPR_ACCOUNT" ] && [ "$NON_INTERACTIVE" = false ]; then
  echo "" > /dev/tty
  echo -e "${BOLD}Do you have an XPR Network account?${NC}" > /dev/tty
  echo "  1) Yes — I have an account and private key" > /dev/tty
  echo "  2) No — create one for me (testnet only, requires Node.js)" > /dev/tty
  echo -n "Choice [1]: " > /dev/tty; read -r HAS_ACCOUNT < /dev/tty
  HAS_ACCOUNT="${HAS_ACCOUNT:-1}"

  if [ "$HAS_ACCOUNT" = "2" ]; then
    if [ "$NETWORK" = "mainnet" ]; then
      fail "Automatic account creation is only available on testnet"
    fi

    if ! command -v npx &>/dev/null; then
      echo "" > /dev/tty
      echo -e "${RED}Node.js is required to create an account.${NC}" > /dev/tty
      echo "" > /dev/tty
      echo "Install it:" > /dev/tty
      echo "  Mac:   brew install node" > /dev/tty
      echo "  Linux: curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo bash - && sudo apt install -y nodejs" > /dev/tty
      echo "" > /dev/tty
      echo "Then re-run this script." > /dev/tty
      exit 1
    fi

    echo "" > /dev/tty
    echo -en "${BOLD}Choose an account name${NC} (1-12 chars, a-z 1-5 and .): " > /dev/tty
    read -r XPR_ACCOUNT < /dev/tty

    # Validate name format
    if ! echo "$XPR_ACCOUNT" | grep -qE '^[a-z1-5.]{1,12}$'; then
      fail "Invalid account name '$XPR_ACCOUNT'. Use only a-z, 1-5, and dots (max 12 chars)"
    fi

    log "Creating account '$XPR_ACCOUNT' on testnet..."
    echo -e "  ${CYAN}This may take a moment on first run (downloading @proton/cli)...${NC}" > /dev/tty

    # Set chain to testnet
    npx -y @proton/cli chain:set proton-test 2>/dev/null

    # Create account — proton CLI generates keys and stores them locally
    CREATE_OUTPUT=$(npx -y @proton/cli account:create "$XPR_ACCOUNT" 2>&1) || {
      echo "$CREATE_OUTPUT"
      fail "Account creation failed. The name may be taken — try a different one."
    }
    success "Account '$XPR_ACCOUNT' created on testnet"

    # Extract the private key from proton CLI keychain
    KEY_OUTPUT=$(npx -y @proton/cli key:list 2>&1)
    # The key:list output contains PVT_K1_ keys
    EXTRACTED_KEY=$(echo "$KEY_OUTPUT" | grep -oE 'PVT_K1_[A-Za-z0-9]+' | head -1)

    if [ -n "$EXTRACTED_KEY" ]; then
      XPR_PRIVATE_KEY="$EXTRACTED_KEY"
      success "Private key extracted"
    else
      echo "" > /dev/tty
      echo -e "${YELLOW}Could not auto-extract private key. Run this to find it:${NC}" > /dev/tty
      echo "  npx @proton/cli key:list" > /dev/tty
      echo "" > /dev/tty
      prompt_value XPR_PRIVATE_KEY "Paste your private key (PVT_K1_...)" "" true
    fi
  fi
fi

# If still not set, prompt normally
prompt_value XPR_ACCOUNT "XPR account name"
success "Account: $XPR_ACCOUNT"

prompt_value XPR_PRIVATE_KEY "Private key (PVT_K1_...)" "" true
success "Private key: set"

prompt_value ANTHROPIC_API_KEY "Anthropic API key" "" true
success "API key: set"

# ── Validate Account ─────────────────────────

echo ""
log "Validating account on-chain..."

ACCOUNT_CHECK=$(curl -sf -X POST "$RPC_ENDPOINT/v1/chain/get_account" \
  -H "Content-Type: application/json" \
  -d "{\"account_name\": \"$XPR_ACCOUNT\"}" 2>/dev/null || echo "FAIL")

if echo "$ACCOUNT_CHECK" | grep -q '"account_name"'; then
  success "Account '$XPR_ACCOUNT' exists on $NETWORK"
else
  warn "Could not verify account '$XPR_ACCOUNT' on $NETWORK"
  if [ "$NON_INTERACTIVE" = false ]; then
    echo -n "Continue anyway? [y/N]: " > /dev/tty; read -r cont < /dev/tty
    [ "$cont" = "y" ] || [ "$cont" = "Y" ] || exit 1
  fi
fi

# ── Create Working Directory ─────────────────

mkdir -p "$WORK_DIR"
cd "$WORK_DIR"
log "Working directory: $(pwd)"

# ── Generate Security Tokens ─────────────────

OPENCLAW_HOOK_TOKEN=$(openssl rand -hex 32)
WEBHOOK_ADMIN_TOKEN=$(openssl rand -hex 32)

# ── Write .env ───────────────────────────────

cat > .env <<ENVEOF
# Generated by bootstrap.sh on $(date -Iseconds)
XPR_ACCOUNT=$XPR_ACCOUNT
XPR_PRIVATE_KEY=$XPR_PRIVATE_KEY
XPR_PERMISSION=active
XPR_NETWORK=$NETWORK
XPR_RPC_ENDPOINT=$RPC_ENDPOINT
HYPERION_ENDPOINTS=$HYPERION
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
AGENT_MODEL=${AGENT_MODEL:-claude-sonnet-4-20250514}
AGENT_MAX_TURNS=10
MAX_TRANSFER_AMOUNT=${MAX_TRANSFER_AMOUNT:-1000000}
OPENCLAW_HOOK_TOKEN=$OPENCLAW_HOOK_TOKEN
WEBHOOK_ADMIN_TOKEN=$WEBHOOK_ADMIN_TOKEN
A2A_AUTH_REQUIRED=true
A2A_MIN_TRUST_SCORE=0
A2A_MIN_KYC_LEVEL=0
A2A_RATE_LIMIT=20
A2A_TOOL_MODE=full
ENVEOF

success "Created .env"

# ── Write docker-compose.yml ─────────────────

cat > docker-compose.yml <<'DCEOF'
services:
  indexer:
    image: ghcr.io/paulgnz/xpr-agents-indexer:latest
    environment:
      - PORT=3001
      - DB_PATH=/data/agents.db
      - HYPERION_ENDPOINTS=${HYPERION_ENDPOINTS:-https://api-xprnetwork-test.saltant.io}
      - WEBHOOK_ADMIN_TOKEN=${WEBHOOK_ADMIN_TOKEN}
    volumes:
      - indexer-data:/data
    ports:
      - "127.0.0.1:3001:3001"
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3001/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s
    restart: unless-stopped

  agent:
    image: ghcr.io/paulgnz/xpr-agent-runner:latest
    environment:
      - PORT=8080
      - XPR_ACCOUNT=${XPR_ACCOUNT}
      - XPR_PRIVATE_KEY=${XPR_PRIVATE_KEY}
      - XPR_PERMISSION=${XPR_PERMISSION:-active}
      - XPR_RPC_ENDPOINT=${XPR_RPC_ENDPOINT:-https://tn1.protonnz.com}
      - XPR_NETWORK=${XPR_NETWORK:-testnet}
      - INDEXER_URL=http://indexer:3001
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - AGENT_MODEL=${AGENT_MODEL:-claude-sonnet-4-20250514}
      - AGENT_MAX_TURNS=${AGENT_MAX_TURNS:-10}
      - MAX_TRANSFER_AMOUNT=${MAX_TRANSFER_AMOUNT:-1000000}
      - OPENCLAW_HOOK_TOKEN=${OPENCLAW_HOOK_TOKEN}
      - A2A_AUTH_REQUIRED=${A2A_AUTH_REQUIRED:-true}
      - A2A_MIN_TRUST_SCORE=${A2A_MIN_TRUST_SCORE:-0}
      - A2A_MIN_KYC_LEVEL=${A2A_MIN_KYC_LEVEL:-0}
      - A2A_RATE_LIMIT=${A2A_RATE_LIMIT:-20}
      - A2A_TOOL_MODE=${A2A_TOOL_MODE:-full}
    ports:
      - "127.0.0.1:8080:8080"
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s
    depends_on:
      indexer:
        condition: service_healthy
    restart: unless-stopped

volumes:
  indexer-data:
DCEOF

success "Created docker-compose.yml"

# ── Pull & Start ─────────────────────────────

echo ""
log "Pulling Docker images..."
$COMPOSE pull 2>&1 | while IFS= read -r line; do echo "    $line"; done
success "Images pulled"

echo ""
log "Starting indexer..."
$COMPOSE up -d indexer

echo -e "  ${CYAN}Waiting for indexer health...${NC}"
for i in $(seq 1 45); do
  if curl -sf http://localhost:3001/health >/dev/null 2>&1; then
    success "Indexer healthy"
    break
  fi
  [ "$i" -eq 45 ] && fail "Indexer didn't start in 45s. Run: $COMPOSE logs indexer"
  sleep 1
done

# ── Register Webhook ─────────────────────────

echo ""
log "Registering webhook..."

WEBHOOK_RESP=$(curl -sf -X POST http://localhost:3001/api/webhooks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $WEBHOOK_ADMIN_TOKEN" \
  -d "{
    \"url\": \"http://agent:8080/hooks/agent\",
    \"token\": \"$OPENCLAW_HOOK_TOKEN\",
    \"event_filter\": [\"job.*\", \"feedback.*\", \"validation.*\", \"dispute.*\", \"bid.*\", \"agent.*\"],
    \"account_filter\": \"$XPR_ACCOUNT\"
  }" 2>/dev/null || echo '{"error":"failed"}')

if echo "$WEBHOOK_RESP" | grep -q '"id"'; then
  success "Webhook registered for $XPR_ACCOUNT"
else
  warn "Webhook registration issue: $WEBHOOK_RESP"
fi

# ── Start Agent ──────────────────────────────

log "Starting agent..."
$COMPOSE up -d agent

for i in $(seq 1 30); do
  if curl -sf http://localhost:8080/health >/dev/null 2>&1; then
    success "Agent running"
    break
  fi
  [ "$i" -eq 30 ] && warn "Agent didn't respond in 30s. Check: $COMPOSE logs agent"
  sleep 1
done

# ── Done ─────────────────────────────────────

echo ""
echo -e "${BOLD}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  Your agent is live!${NC}"
echo -e "${BOLD}═══════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}Agent:${NC}    $XPR_ACCOUNT"
echo -e "  ${BOLD}Network:${NC}  $NETWORK"
echo -e "  ${BOLD}Dir:${NC}      $(pwd)"
echo -e "  ${BOLD}Indexer:${NC}  http://localhost:3001"
echo -e "  ${BOLD}Agent:${NC}    http://localhost:8080"
echo ""
echo -e "${BOLD}Useful commands (run from $(pwd)):${NC}"
echo "  $COMPOSE logs -f           # Live logs"
echo "  $COMPOSE logs agent        # Agent only"
echo "  $COMPOSE restart           # Restart"
echo "  $COMPOSE down              # Stop"
echo ""
echo -e "${BOLD}Test it:${NC}"
echo "  source .env"
echo "  curl -X POST http://localhost:8080/run \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -H \"Authorization: Bearer \$OPENCLAW_HOOK_TOKEN\" \\"
echo "    -d '{\"prompt\": \"Check my trust score and report status\"}'"
echo ""
