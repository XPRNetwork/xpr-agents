#!/usr/bin/env bash
set -euo pipefail

# ════════════════════════════════════════════════════════════
# XPR Agent Operator — Self-Contained Bootstrap
# ════════════════════════════════════════════════════════════
#
# No repo clone needed. Pulls public Docker images and starts.
#
# curl -fsSL https://gist.githubusercontent.com/.../bootstrap.sh | bash
#

VERSION="0.3.0"

# ── Self-relaunch for interactive mode ───────
# When piped via `curl | bash`, stdin is consumed by the pipe so interactive
# prompts can't read input. Detect this, save the script to a temp file,
# and re-exec so stdin is connected to the terminal.
if [ ! -t 0 ] && [ $# -eq 0 ]; then
  TMPSCRIPT=$(mktemp /tmp/xpr-bootstrap.XXXXXX.sh)
  # We're being piped — the script content is on stdin. But bash already
  # has it buffered, so we can't re-read it. Instead, download it again.
  GIST_URL="${BASH_SOURCE[0]:-}"
  # Save ourselves to a temp file by re-downloading
  SELF_URL="https://gist.githubusercontent.com/paulgnz/ee18380f8b8fdaca0319dce7e38046dd/raw/bootstrap.sh"
  curl -fsSL "$SELF_URL" -o "$TMPSCRIPT"
  chmod +x "$TMPSCRIPT"
  exec bash "$TMPSCRIPT" "$@"
fi
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
    echo -en "${BOLD}$prompt${NC}: "
    read -rs value
    echo ""
  else
    echo -en "${BOLD}$prompt${NC}"
    [ -n "$default" ] && echo -n " [$default]" || true
    echo -n ": "
    read -r value
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
  echo -e "\n${BOLD}$prompt${NC}"
  for i in "${!options[@]}"; do echo "  $((i + 1))) ${options[$i]}"; done
  echo -n "Choice [1]: "
  read -r choice
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

# Detect existing Proton CLI accounts
EXISTING_CLI_ACCOUNT=""
EXISTING_CLI_KEY=""
if command -v npx &>/dev/null; then
  CLI_KEYS=$(npx -y @proton/cli key:list 2>/dev/null || true)
  EXISTING_CLI_KEY=$(echo "$CLI_KEYS" | grep -oE 'PVT_K1_[A-Za-z0-9]+' | head -1)
  if [ -n "$EXISTING_CLI_KEY" ]; then
    EXISTING_CLI_ACCOUNT=$(echo "$CLI_KEYS" | grep -oE '[a-z1-5.]{1,12}' | head -1)
  fi
fi

# If account/key not provided via flags, offer options
if [ -z "$XPR_ACCOUNT" ] && [ "$NON_INTERACTIVE" = false ]; then
  echo ""
  echo -e "${BOLD}XPR Network Account${NC}"

  if [ -n "$EXISTING_CLI_KEY" ] && [ -n "$EXISTING_CLI_ACCOUNT" ]; then
    echo "  1) Use existing Proton CLI account: ${GREEN}${EXISTING_CLI_ACCOUNT}${NC} (detected)"
    echo "  2) Enter a different account and key"
    echo "  3) Create a new account (testnet only, requires Node.js)"
    echo -n "Choice [1]: "
    read -r ACCOUNT_CHOICE
    ACCOUNT_CHOICE="${ACCOUNT_CHOICE:-1}"

    if [ "$ACCOUNT_CHOICE" = "1" ]; then
      XPR_ACCOUNT="$EXISTING_CLI_ACCOUNT"
      XPR_PRIVATE_KEY="$EXISTING_CLI_KEY"
      success "Using existing account: $XPR_ACCOUNT"
    fi
    [ "$ACCOUNT_CHOICE" = "3" ] && ACCOUNT_CHOICE="CREATE"
  else
    echo "  1) Yes — I have an account and private key"
    echo "  2) No — create one for me (testnet only, requires Node.js)"
    echo -n "Choice [1]: "
    read -r ACCOUNT_CHOICE
    ACCOUNT_CHOICE="${ACCOUNT_CHOICE:-1}"
    [ "$ACCOUNT_CHOICE" = "2" ] && ACCOUNT_CHOICE="CREATE"
  fi

  if [ "$ACCOUNT_CHOICE" = "CREATE" ]; then
    if [ "$NETWORK" = "mainnet" ]; then
      fail "Automatic account creation is only available on testnet"
    fi

    if ! command -v npx &>/dev/null; then
      echo ""
      echo -e "${RED}Node.js is required to create an account.${NC}"
      echo ""
      echo "Install it:"
      echo "  Mac:   brew install node"
      echo "  Linux: curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo bash - && sudo apt install -y nodejs"
      echo ""
      echo "Then re-run this script."
      exit 1
    fi

    echo ""
    echo -en "${BOLD}Choose an account name${NC} (1-12 chars, a-z 1-5 and .): "
    read -r XPR_ACCOUNT

    if ! echo "$XPR_ACCOUNT" | grep -qE '^[a-z1-5.]{1,12}$'; then
      fail "Invalid account name '$XPR_ACCOUNT'. Use only a-z, 1-5, and dots (max 12 chars)"
    fi

    # Check if account already exists on-chain BEFORE attempting creation
    EXISTING_CHECK=$(curl -sf -X POST "$RPC_ENDPOINT/v1/chain/get_account" \
      -H "Content-Type: application/json" \
      -d "{\"account_name\": \"$XPR_ACCOUNT\"}" 2>/dev/null || echo "NOT_FOUND")

    if echo "$EXISTING_CHECK" | grep -q '"account_name"'; then
      echo ""
      echo -e "${YELLOW}Account '$XPR_ACCOUNT' already exists on $NETWORK.${NC}"
      echo "  You need the private key that controls this account."
      echo "  If you don't have it, choose a different name."
      echo ""
      echo "  1) Enter the private key for '$XPR_ACCOUNT'"
      echo "  2) Choose a different account name"
      echo -n "Choice [1]: "
      read -r EXIST_CHOICE
      EXIST_CHOICE="${EXIST_CHOICE:-1}"

      if [ "$EXIST_CHOICE" = "2" ]; then
        fail "Re-run the script and choose a different name"
      fi

      prompt_value XPR_PRIVATE_KEY "Private key for '$XPR_ACCOUNT' (PVT_K1_...)" "" true
    else
      log "Creating account '$XPR_ACCOUNT' on testnet..."
      echo -e "  ${CYAN}This may take a moment on first run (downloading @proton/cli)...${NC}"

      npx -y @proton/cli chain:set proton-test 2>/dev/null

      CREATE_OUTPUT=$(npx -y @proton/cli account:create "$XPR_ACCOUNT" 2>&1) || {
        echo "$CREATE_OUTPUT"
        fail "Account creation failed. The name may be taken — try a different one."
      }
      success "Account '$XPR_ACCOUNT' created on testnet"

      KEY_OUTPUT=$(npx -y @proton/cli key:list 2>&1)
      EXTRACTED_KEY=$(echo "$KEY_OUTPUT" | grep -oE 'PVT_K1_[A-Za-z0-9]+' | head -1)

      if [ -n "$EXTRACTED_KEY" ]; then
        XPR_PRIVATE_KEY="$EXTRACTED_KEY"
        success "Private key extracted"
        echo ""
        echo -e "  ${BOLD}Your private key:${NC} $EXTRACTED_KEY"
        echo -e "  ${YELLOW}Save this somewhere safe! It controls your account.${NC}"
        echo ""
      else
        echo ""
        echo -e "${YELLOW}Could not auto-extract private key. Run this to find it:${NC}"
        echo "  npx @proton/cli key:list"
        echo ""
        prompt_value XPR_PRIVATE_KEY "Paste your private key (PVT_K1_...)" "" true
      fi
    fi
  fi
fi

# If still not set, prompt normally
if [ -z "$XPR_ACCOUNT" ]; then
  prompt_value XPR_ACCOUNT "XPR account name"
fi
success "Account: $XPR_ACCOUNT"

if [ -z "$XPR_PRIVATE_KEY" ]; then
  prompt_value XPR_PRIVATE_KEY "Private key (PVT_K1_...)" "" true
fi
success "Private key: set"

prompt_value ANTHROPIC_API_KEY "Anthropic API key (from console.anthropic.com)" "" true
success "API key: set"

# ── Validate Account & Key ───────────────────

echo ""
log "Validating account on-chain..."

ACCOUNT_CHECK=$(curl -s -X POST "$RPC_ENDPOINT/v1/chain/get_account" \
  -H "Content-Type: application/json" \
  -d "{\"account_name\": \"$XPR_ACCOUNT\"}" 2>/dev/null || echo "FAIL")

if echo "$ACCOUNT_CHECK" | grep -q '"account_name"'; then
  success "Account '$XPR_ACCOUNT' exists on $NETWORK"

  # Validate that the private key matches the account's on-chain active keys
  if command -v node &>/dev/null; then
    log "Validating private key matches account..."
    ONCHAIN_KEYS=$(echo "$ACCOUNT_CHECK" | node -e "
      const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
      const active = d.permissions?.find(p => p.perm_name === 'active');
      if (active) active.required_auth.keys.forEach(k => console.log(k.key));
    " 2>/dev/null || echo "")

    DERIVED_PUB=$(node -e "
      try {
        const { PrivateKey } = require('@proton/js');
        console.log(PrivateKey.fromString(process.argv[1]).getPublicKey().toLegacyString());
      } catch(e) {
        try {
          const { PrivateKey } = require('@proton/js');
          console.log(PrivateKey.fromString(process.argv[1]).getPublicKey().toString());
        } catch(e2) { console.error(e2.message); }
      }
    " "$XPR_PRIVATE_KEY" 2>/dev/null || echo "")

    if [ -n "$DERIVED_PUB" ] && [ -n "$ONCHAIN_KEYS" ]; then
      KEY_MATCH=false
      while IFS= read -r onchain_key; do
        if [ "$DERIVED_PUB" = "$onchain_key" ]; then
          KEY_MATCH=true
          break
        fi
      done <<< "$ONCHAIN_KEYS"

      if [ "$KEY_MATCH" = true ]; then
        success "Private key matches account's active permission"
      else
        echo ""
        echo -e "${RED}  KEY MISMATCH${NC}"
        echo -e "  Your private key does NOT match '$XPR_ACCOUNT's on-chain active keys."
        echo -e "  Derived public key: ${CYAN}${DERIVED_PUB}${NC}"
        echo -e "  On-chain active keys:"
        while IFS= read -r k; do echo -e "    ${CYAN}${k}${NC}"; done <<< "$ONCHAIN_KEYS"
        echo ""
        echo -e "  The agent ${RED}will not be able to sign transactions${NC}."
        echo -e "  You need the private key that corresponds to one of the on-chain keys."
        echo ""
        if [ "$NON_INTERACTIVE" = false ]; then
          echo -n "Continue anyway? [y/N]: "
          read -r cont
          [ "$cont" = "y" ] || [ "$cont" = "Y" ] || exit 1
        else
          fail "Key mismatch — provide the correct private key for '$XPR_ACCOUNT'"
        fi
      fi
    else
      warn "Could not verify key match (missing @proton/js or node issue)"
    fi
  else
    warn "Node.js not found — skipping key validation (install node to enable)"
  fi
else
  warn "Could not verify account '$XPR_ACCOUNT' on $NETWORK"
  if [ "$NON_INTERACTIVE" = false ]; then
    echo -n "Continue anyway? [y/N]: "
    read -r cont
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
      - "8080:8080"
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

# ── Create chat script ──────────────────────

cat > chat <<'CHATEOF'
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/.env"
AGENT_URL="${AGENT_URL:-http://localhost:8080}"

if [ $# -gt 0 ]; then
  PROMPT="$*"
else
  echo "Talk to your agent. Type a message and press Enter. Ctrl+C to quit."
  echo ""
  while true; do
    echo -n "> "
    read -r PROMPT || break
    [ -z "$PROMPT" ] && continue
    echo ""
    RESP=$(curl -sf -X POST "$AGENT_URL/run" \
      -H 'Content-Type: application/json' \
      -H "Authorization: Bearer $OPENCLAW_HOOK_TOKEN" \
      -d "{\"prompt\": $(echo "$PROMPT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))')}" 2>&1) || {
      echo "Error: $RESP"
      continue
    }
    echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('result','(no response)'))" 2>/dev/null || echo "$RESP"
    echo ""
  done
  exit 0
fi

RESP=$(curl -sf -X POST "$AGENT_URL/run" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $OPENCLAW_HOOK_TOKEN" \
  -d "{\"prompt\": $(echo "$PROMPT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))')}")

echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('result','(no response)'))" 2>/dev/null || echo "$RESP"
CHATEOF
chmod +x chat
success "Created chat script"

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
echo -e "${BOLD}Talk to your agent:${NC}"
echo "  cd $(pwd)"
echo "  ./chat                                  # Interactive chat"
echo "  ./chat \"Check my status\"                # One-shot"
echo ""
echo -e "${BOLD}Other commands:${NC}"
echo "  $COMPOSE logs -f           # Live logs"
echo "  $COMPOSE logs agent        # Agent only"
echo "  $COMPOSE restart           # Restart"
echo "  $COMPOSE down              # Stop"
echo ""
