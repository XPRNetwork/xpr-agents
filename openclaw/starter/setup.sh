#!/usr/bin/env bash
set -euo pipefail

# ════════════════════════════════════════════════════════════
# XPR Agent Operator — Single-Command Setup
# ════════════════════════════════════════════════════════════

VERSION="0.1.0"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Defaults
NETWORK="testnet"
XPR_ACCOUNT=""
XPR_PRIVATE_KEY=""
ANTHROPIC_API_KEY=""
NON_INTERACTIVE=false
SKIP_BUILD=false
COMPOSE=""

usage() {
  cat <<EOF
${BOLD}XPR Agent Operator Setup v${VERSION}${NC}

Deploy an autonomous AI agent on XPR Network in one command.

${BOLD}USAGE:${NC}
    ./setup.sh [OPTIONS]

${BOLD}OPTIONS:${NC}
    --account <name>      XPR Network account name (required)
    --key <private_key>   Account private key (required)
    --api-key <key>       Anthropic API key (required)
    --network <net>       Network: testnet (default) or mainnet
    --model <model>       Claude model (default: claude-sonnet-4-20250514)
    --max-amount <n>      Max XPR transfer in smallest units (default: 1000000)
    --non-interactive     Skip all prompts (requires all flags)
    --skip-build          Skip Docker build (use existing images)
    --help                Show this help

${BOLD}EXAMPLES:${NC}
    # Interactive setup (guided wizard)
    ./setup.sh

    # Non-interactive with all options
    ./setup.sh --account myagent --key PVT_K1_xxx --api-key sk-ant-xxx

    # Mainnet deployment
    ./setup.sh --account myagent --key PVT_K1_xxx --api-key sk-ant-xxx --network mainnet

EOF
  exit 0
}

# ── Parse CLI Arguments ──────────────────────

AGENT_MODEL=""
MAX_TRANSFER_AMOUNT=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --account)      XPR_ACCOUNT="$2"; shift 2 ;;
    --key)          XPR_PRIVATE_KEY="$2"; shift 2 ;;
    --api-key)      ANTHROPIC_API_KEY="$2"; shift 2 ;;
    --network)      NETWORK="$2"; shift 2 ;;
    --model)        AGENT_MODEL="$2"; shift 2 ;;
    --max-amount)   MAX_TRANSFER_AMOUNT="$2"; shift 2 ;;
    --non-interactive) NON_INTERACTIVE=true; shift ;;
    --skip-build)   SKIP_BUILD=true; shift ;;
    --help|-h)      usage ;;
    *) echo -e "${RED}Unknown option: $1${NC}"; echo "Run ./setup.sh --help for usage"; exit 1 ;;
  esac
done

# ── Helper Functions ─────────────────────────

log()     { echo -e "${CYAN}[setup]${NC} $*"; }
success() { echo -e "${GREEN}  ✓${NC} $*"; }
warn()    { echo -e "${YELLOW}  !${NC} $*"; }
fail()    { echo -e "${RED}  ✗ $*${NC}"; exit 1; }

prompt_value() {
  local varname="$1" prompt="$2" default="${3:-}" secret="${4:-false}"
  local current="${!varname:-}"

  if [ -n "$current" ]; then
    return  # Already set via CLI
  fi

  if [ "$NON_INTERACTIVE" = true ]; then
    if [ -n "$default" ]; then
      eval "$varname='$default'"
      return
    fi
    fail "$varname is required in non-interactive mode (use --help for flags)"
  fi

  if [ "$secret" = true ]; then
    echo -en "${BOLD}$prompt${NC}"
    [ -n "$default" ] && echo -n " [****]" || echo -n ""
    echo -n ": "
    read -rs value
    echo ""
  else
    echo -en "${BOLD}$prompt${NC}"
    [ -n "$default" ] && echo -n " [$default]" || echo -n ""
    echo -n ": "
    read -r value
  fi

  value="${value:-$default}"
  if [ -z "$value" ]; then
    fail "$varname is required"
  fi
  eval "$varname='$value'"
}

prompt_choice() {
  local varname="$1" prompt="$2"
  shift 2
  local options=("$@")
  local current="${!varname:-}"

  if [ -n "$current" ]; then
    return
  fi

  echo -e "\n${BOLD}$prompt${NC}"
  for i in "${!options[@]}"; do
    echo "  $((i + 1))) ${options[$i]}"
  done
  echo -n "Choice [1]: "
  read -r choice
  choice="${choice:-1}"
  local idx=$((choice - 1))
  if [ "$idx" -lt 0 ] || [ "$idx" -ge "${#options[@]}" ]; then
    idx=0
  fi
  eval "$varname='${options[$idx]}'"
}

# ── Prerequisites ────────────────────────────

echo ""
echo -e "${BOLD}═══════════════════════════════════════════${NC}"
echo -e "${BOLD}  XPR Agent Operator Setup v${VERSION}${NC}"
echo -e "${BOLD}═══════════════════════════════════════════${NC}"
echo ""

log "Checking prerequisites..."

for cmd in docker curl openssl; do
  if ! command -v "$cmd" &>/dev/null; then
    fail "$cmd is required but not installed"
  fi
  success "$cmd found"
done

if docker compose version &>/dev/null; then
  COMPOSE="docker compose"
  success "docker compose found"
elif docker-compose version &>/dev/null; then
  COMPOSE="docker-compose"
  success "docker-compose found"
else
  fail "docker compose is required but not installed"
fi

# ── Gather Configuration ─────────────────────

echo ""
log "Configuration"

prompt_choice NETWORK "Select network:" "testnet" "mainnet"
success "Network: $NETWORK"

prompt_value XPR_ACCOUNT "XPR account name"
success "Account: $XPR_ACCOUNT"

prompt_value XPR_PRIVATE_KEY "Private key" "" true
success "Private key: set"

prompt_value ANTHROPIC_API_KEY "Anthropic API key" "" true
success "API key: set"

# Set network-specific defaults
if [ "$NETWORK" = "mainnet" ]; then
  RPC_ENDPOINT="https://proton.eosusa.io"
  HYPERION="https://proton.eosusa.io"
else
  RPC_ENDPOINT="https://tn1.protonnz.com"
  HYPERION="https://api-xprnetwork-test.saltant.io"
fi

# ── Validate Account On-Chain ────────────────

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
    echo -n "Continue anyway? [y/N]: "
    read -r cont
    [ "$cont" = "y" ] || [ "$cont" = "Y" ] || exit 1
  fi
fi

# ── Generate .env ────────────────────────────

echo ""
log "Writing configuration..."

cat > .env <<ENVEOF
# Generated by setup.sh on $(date -Iseconds)
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
OPENCLAW_HOOK_TOKEN=$(openssl rand -hex 32)
WEBHOOK_ADMIN_TOKEN=$(openssl rand -hex 32)
ENVEOF

success "Created .env with generated security tokens"

# Source the generated env
set -a
source .env
set +a

# ── Build & Start Services ───────────────────

echo ""
log "Building and starting services..."

if [ "$SKIP_BUILD" = false ]; then
  echo -e "  ${CYAN}Building indexer...${NC}"
  $COMPOSE build indexer 2>&1 | while IFS= read -r line; do echo "    $line"; done
  success "Indexer image built"

  echo -e "  ${CYAN}Building agent...${NC}"
  $COMPOSE build agent 2>&1 | while IFS= read -r line; do echo "    $line"; done
  success "Agent image built"
fi

echo -e "  ${CYAN}Starting indexer...${NC}"
$COMPOSE up -d indexer

# Wait for indexer health
echo -e "  ${CYAN}Waiting for indexer health...${NC}"
for i in $(seq 1 45); do
  if curl -sf http://localhost:3001/health >/dev/null 2>&1; then
    success "Indexer is healthy"
    break
  fi
  if [ "$i" -eq 45 ]; then
    fail "Indexer did not become healthy in 45 seconds. Check: $COMPOSE logs indexer"
  fi
  sleep 1
done

# ── Register Webhook ─────────────────────────

echo ""
log "Registering webhook subscription..."

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
  success "Webhook registered for $XPR_ACCOUNT events"
else
  warn "Webhook registration returned: $WEBHOOK_RESP"
  warn "The agent may not receive event notifications"
fi

# ── Start Agent ──────────────────────────────

echo -e "  ${CYAN}Starting agent...${NC}"
$COMPOSE up -d agent

# Wait for agent health
for i in $(seq 1 30); do
  if curl -sf http://localhost:8080/health >/dev/null 2>&1; then
    success "Agent is running"
    break
  fi
  if [ "$i" -eq 30 ]; then
    warn "Agent did not respond in 30 seconds. Check: $COMPOSE logs agent"
    break
  fi
  sleep 1
done

# ── Summary ──────────────────────────────────

echo ""
echo -e "${BOLD}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  Setup Complete!${NC}"
echo -e "${BOLD}═══════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}Agent:${NC}    $XPR_ACCOUNT"
echo -e "  ${BOLD}Network:${NC}  $NETWORK"
echo -e "  ${BOLD}Model:${NC}    ${AGENT_MODEL:-claude-sonnet-4-20250514}"
echo -e "  ${BOLD}Indexer:${NC}  http://localhost:3001"
echo -e "  ${BOLD}Agent:${NC}    http://localhost:8080"
echo ""
echo -e "${BOLD}Commands:${NC}"
echo "  $COMPOSE logs -f           # View live logs"
echo "  $COMPOSE logs agent        # Agent logs only"
echo "  $COMPOSE restart           # Restart all services"
echo "  $COMPOSE down              # Stop everything"
echo ""
echo -e "${BOLD}Test the agent:${NC}"
echo "  curl http://localhost:8080/health"
echo "  curl -X POST http://localhost:8080/run \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"prompt\": \"Check my trust score and report status\"}'"
echo ""
echo -e "${BOLD}Monitor:${NC}"
echo "  curl http://localhost:3001/health"
echo "  curl -H 'Authorization: Bearer \$WEBHOOK_ADMIN_TOKEN' http://localhost:3001/api/webhooks"
echo ""
