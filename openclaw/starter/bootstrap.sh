#!/usr/bin/env bash
set -euo pipefail

# ════════════════════════════════════════════════════════════
# XPR Agent Operator — Self-Contained Bootstrap
# ════════════════════════════════════════════════════════════
#
# Idempotent. Run anytime to set up, repair, or verify your agent.
# Detects existing setup, fixes what's broken, skips what's done.
#
# curl -fsSL https://gist.githubusercontent.com/.../bootstrap.sh | bash
#

VERSION="0.5.0"

# ── Self-relaunch for interactive mode ───────
if [ ! -t 0 ] && [ $# -eq 0 ]; then
  TMPSCRIPT=$(mktemp /tmp/xpr-bootstrap-XXXXXX)
  SELF_URL="https://gist.githubusercontent.com/paulgnz/ee18380f8b8fdaca0319dce7e38046dd/raw/bootstrap.sh"
  curl -fsSL "$SELF_URL" -o "$TMPSCRIPT"
  chmod +x "$TMPSCRIPT"
  exec bash "$TMPSCRIPT" "$@"
fi

INDEXER_IMAGE="ghcr.io/paulgnz/xpr-agents-indexer:latest"
AGENT_IMAGE="ghcr.io/paulgnz/xpr-agent-runner:latest"
TELEGRAM_IMAGE="ghcr.io/paulgnz/xpr-agent-telegram:latest"

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
ANTHROPIC_API_KEY=""
AGENT_MODEL=""
MAX_TRANSFER_AMOUNT=""
NON_INTERACTIVE=false
WORK_DIR="xpr-agent"

usage() {
  cat <<EOF
${BOLD}XPR Agent Operator Bootstrap v${VERSION}${NC}

Deploy an autonomous AI agent on XPR Network in one command.
Idempotent — run anytime to set up, repair, or verify your agent.

${BOLD}USAGE:${NC}
    curl -fsSL <url> | bash
    curl -fsSL <url> | bash -s -- [OPTIONS]

${BOLD}OPTIONS:${NC}
    --account <name>      XPR Network account name
    --api-key <key>       Anthropic API key
    --network <net>       Network: testnet (default) or mainnet
    --model <model>       Claude model (default: claude-sonnet-4-6)
    --max-amount <n>      Max XPR transfer in smallest units (default: 1000000)
    --dir <path>          Working directory (default: xpr-agent)
    --non-interactive     Skip all prompts (requires all flags)
    --help                Show this help

EOF
  exit 0
}

# ── Parse CLI Arguments ──────────────────────

while [[ $# -gt 0 ]]; do
  case $1 in
    --account)      XPR_ACCOUNT="$2"; shift 2 ;;
    --key)
      echo "Error: --key is no longer supported. Use the proton CLI keychain:" >&2
      echo "  npm i -g github:paulgnz/proton-cli#security/key-list-redact" >&2
      echo "  proton chain:set proton-test    # or proton" >&2
      echo "  proton key:add" >&2
      exit 1
      ;;
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

# ── Phase 1: Prerequisites ──────────────────

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

# ── Phase 2: Detect Existing Setup ──────────

mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

EXISTING_SETUP=false
OPENCLAW_HOOK_TOKEN=""
WEBHOOK_ADMIN_TOKEN=""
TELEGRAM_BOT_TOKEN=""

if [ -f .env ]; then
  EXISTING_SETUP=true
  log "Found existing setup in $(pwd)"

  # Source existing config (only the vars we need)
  # Use parameter expansion to handle values containing '='
  while IFS= read -r line; do
    # Skip comments and empty lines
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in
      XPR_ACCOUNT)        [ -z "$XPR_ACCOUNT" ] && XPR_ACCOUNT="$value" ;;
      XPR_PRIVATE_KEY)
        echo "Error: legacy XPR_PRIVATE_KEY found in .env — must be removed." >&2
        echo "  Migration: proton key:add  (then delete the line from .env)" >&2
        exit 1
        ;;
      ANTHROPIC_API_KEY)  [ -z "$ANTHROPIC_API_KEY" ] && ANTHROPIC_API_KEY="$value" ;;
      XPR_NETWORK)        NETWORK="$value" ;;
      AGENT_MODEL)        [ -z "$AGENT_MODEL" ] && AGENT_MODEL="$value" ;;
      MAX_TRANSFER_AMOUNT) [ -z "$MAX_TRANSFER_AMOUNT" ] && MAX_TRANSFER_AMOUNT="$value" ;;
      OPENCLAW_HOOK_TOKEN) OPENCLAW_HOOK_TOKEN="$value" ;;
      WEBHOOK_ADMIN_TOKEN) WEBHOOK_ADMIN_TOKEN="$value" ;;
      TELEGRAM_BOT_TOKEN) TELEGRAM_BOT_TOKEN="$value" ;;
    esac
  done < .env

  success "Loaded: account=$XPR_ACCOUNT, network=$NETWORK"
fi

# Network endpoints
if [ "$NETWORK" = "mainnet" ]; then
  RPC_ENDPOINT="https://proton.eosusa.io"
  HYPERION="https://proton.eosusa.io"
else
  RPC_ENDPOINT="https://tn1.protonnz.com"
  HYPERION="https://api-xprnetwork-test.saltant.io"
fi

# ── Phase 3: Gather Missing Configuration ───

if [ "$EXISTING_SETUP" = false ]; then
  echo ""
  log "New setup — gathering configuration..."

  if [ -z "$NETWORK" ] || [ "$NETWORK" = "testnet" ]; then
    prompt_choice NETWORK "Select network:" "testnet" "mainnet"
  fi
  success "Network: $NETWORK"

  # Update endpoints after network choice
  if [ "$NETWORK" = "mainnet" ]; then
    RPC_ENDPOINT="https://proton.eosusa.io"
    HYPERION="https://proton.eosusa.io"
  else
    RPC_ENDPOINT="https://tn1.protonnz.com"
    HYPERION="https://api-xprnetwork-test.saltant.io"
  fi
fi

# ── Account & Keychain Setup ─────────────────────
#
# Signing is performed by the proton CLI. The agent never holds a key.
# This block ensures:
#   1. proton CLI is installed
#   2. Keychain has at least one account
#   3. XPR_ACCOUNT names that account (or one the user chooses)
#
# We deliberately do NOT extract the private key from the CLI. It stays
# encrypted in the CLI keychain.

# Verify proton CLI is installed (use globally-installed if present, else npx).
PROTON_CMD=""
if command -v proton &>/dev/null; then
  PROTON_CMD="proton"
elif command -v npx &>/dev/null; then
  PROTON_CMD="npx -y @proton/cli"
else
  fail "proton CLI is required (install: npm i -g github:paulgnz/proton-cli#security/key-list-redact)"
fi

# Auto-set the chain on the CLI to match selected network.
if [ "$NETWORK" = "mainnet" ]; then
  $PROTON_CMD chain:set proton 2>/dev/null || true
else
  $PROTON_CMD chain:set proton-test 2>/dev/null || true
fi

# Detect any existing keychain account name (NOT the private key).
EXISTING_CLI_ACCOUNT=""
CLI_KEYS=$($PROTON_CMD key:list 2>/dev/null || true)
if echo "$CLI_KEYS" | grep -q "publicKey"; then
  # Extract first account name. With the hardened CLI, key:list shows
  # `accounts: [...]` and never prints private keys.
  EXISTING_CLI_ACCOUNT=$(echo "$CLI_KEYS" | grep -oE '[a-z1-5.]{1,12}' | head -1 || true)
fi

if [ -z "$XPR_ACCOUNT" ]; then
  if [ "$NON_INTERACTIVE" = false ]; then
    echo ""
    echo -e "${BOLD}XPR Network Account${NC}"

    if [ -n "$EXISTING_CLI_ACCOUNT" ]; then
      echo "  1) Use existing keychain account: ${GREEN}${EXISTING_CLI_ACCOUNT}${NC} (detected)"
      echo "  2) Enter a different account name (must already exist in keychain)"
      echo "  3) Create a new account (testnet only)"
      echo -n "Choice [1]: "
      read -r ACCOUNT_CHOICE
      ACCOUNT_CHOICE="${ACCOUNT_CHOICE:-1}"
      if [ "$ACCOUNT_CHOICE" = "1" ]; then
        XPR_ACCOUNT="$EXISTING_CLI_ACCOUNT"
        success "Using existing account: $XPR_ACCOUNT"
      fi
      [ "$ACCOUNT_CHOICE" = "3" ] && ACCOUNT_CHOICE="CREATE"
    else
      echo "  No accounts in proton CLI keychain yet."
      echo "  1) Add an existing key (proton key:add)"
      echo "  2) Create a new account (testnet only)"
      echo -n "Choice [1]: "
      read -r ACCOUNT_CHOICE
      ACCOUNT_CHOICE="${ACCOUNT_CHOICE:-1}"
      if [ "$ACCOUNT_CHOICE" = "1" ]; then
        echo ""
        echo "Run this in another terminal, then re-run bootstrap.sh:"
        echo "  $PROTON_CMD key:add"
        fail "Add your key to the proton CLI keychain first."
      fi
      [ "$ACCOUNT_CHOICE" = "2" ] && ACCOUNT_CHOICE="CREATE"
    fi

    if [ "${ACCOUNT_CHOICE:-}" = "CREATE" ]; then
      if [ "$NETWORK" = "mainnet" ]; then
        fail "Automatic account creation is only available on testnet"
      fi
      echo ""
      echo -en "${BOLD}Choose an account name${NC} (1-12 chars, a-z 1-5 and .): "
      read -r XPR_ACCOUNT
      if ! echo "$XPR_ACCOUNT" | grep -qE '^[a-z1-5.]{1,12}$'; then
        fail "Invalid account name '$XPR_ACCOUNT'. Use only a-z, 1-5, and dots (max 12 chars)"
      fi
      log "Creating account '$XPR_ACCOUNT' on testnet via proton CLI..."
      $PROTON_CMD account:create "$XPR_ACCOUNT" || \
        fail "Account creation failed. The name may be taken — try a different one."
      success "Account '$XPR_ACCOUNT' created. Key stored in proton CLI keychain (not printed here)."
    fi
  fi

  # Final prompt if still empty
  if [ -z "$XPR_ACCOUNT" ]; then
    prompt_value XPR_ACCOUNT "XPR account name"
  fi
fi
success "Account: $XPR_ACCOUNT"

# Verify keychain has a key for this account (best-effort — exact account
# matching depends on hardened CLI features).
if ! echo "$CLI_KEYS" | grep -q "publicKey"; then
  warn "proton CLI keychain appears empty. Add your key before starting:"
  echo "  $PROTON_CMD key:add"
fi

if [ -z "$ANTHROPIC_API_KEY" ]; then
  prompt_value ANTHROPIC_API_KEY "Anthropic API key (from console.anthropic.com)" "" true
fi
success "API key: set"

# Optional: Telegram bot
if [ -z "$TELEGRAM_BOT_TOKEN" ] && [ "$NON_INTERACTIVE" = false ]; then
  echo ""
  echo -e "${BOLD}Telegram Bot (optional)${NC}"
  echo "  Chat with your agent via Telegram instead of the command line."
  echo "  Create a bot: message @BotFather on Telegram → /newbot"
  echo ""
  echo -n "  Telegram bot token (press Enter to skip): "
  read -rs TG_INPUT
  echo ""
  if [ -n "$TG_INPUT" ]; then
    TELEGRAM_BOT_TOKEN="$TG_INPUT"
    success "Telegram bot token: set"
  else
    success "Telegram: skipped"
  fi
fi

# ── Phase 4: Validate Account On-Chain ──────
#
# We deliberately do NOT cross-check the key here. Key validation would
# require the agent process to read the private key — which is exactly
# what we removed. The proton CLI itself will surface "no key" or
# "key mismatch" errors at sign time with a clear message.

echo ""
log "Validating account on-chain..."

ACCOUNT_CHECK=$(curl -s -X POST "$RPC_ENDPOINT/v1/chain/get_account" \
  -H "Content-Type: application/json" \
  -d "{\"account_name\": \"$XPR_ACCOUNT\"}" 2>/dev/null || echo "FAIL")

if echo "$ACCOUNT_CHECK" | grep -q '"account_name"'; then
  success "Account '$XPR_ACCOUNT' exists on $NETWORK"
else
  warn "Could not verify account '$XPR_ACCOUNT' on $NETWORK"
  if [ "$NON_INTERACTIVE" = false ]; then
    echo -n "  Continue anyway? [y/N]: "
    read -r cont
    [ "$cont" = "y" ] || [ "$cont" = "Y" ] || exit 1
  fi
fi

# ── Phase 5: Write Config Files ─────────────

echo ""
log "Writing configuration..."

# Generate tokens only if not already set
[ -z "$OPENCLAW_HOOK_TOKEN" ] && OPENCLAW_HOOK_TOKEN=$(openssl rand -hex 32)
[ -z "$WEBHOOK_ADMIN_TOKEN" ] && WEBHOOK_ADMIN_TOKEN=$(openssl rand -hex 32)

# Always rewrite .env to pick up any fixes (key changes, etc.)
cat > .env <<ENVEOF
# Generated by bootstrap.sh v${VERSION} on $(date -Iseconds)
XPR_ACCOUNT=$XPR_ACCOUNT
# Signing handled by proton CLI keychain — no XPR_PRIVATE_KEY here.
XPR_PERMISSION=active
XPR_NETWORK=$NETWORK
XPR_RPC_ENDPOINT=$RPC_ENDPOINT
HYPERION_ENDPOINTS=$HYPERION
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
AGENT_MODEL=${AGENT_MODEL:-claude-sonnet-4-6}
AGENT_MAX_TURNS=10
MAX_TRANSFER_AMOUNT=${MAX_TRANSFER_AMOUNT:-1000000}
OPENCLAW_HOOK_TOKEN=$OPENCLAW_HOOK_TOKEN
WEBHOOK_ADMIN_TOKEN=$WEBHOOK_ADMIN_TOKEN
A2A_AUTH_REQUIRED=true
A2A_MIN_TRUST_SCORE=0
A2A_MIN_KYC_LEVEL=0
A2A_RATE_LIMIT=20
A2A_TOOL_MODE=full
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
ENVEOF
success ".env written"

# Write docker-compose.yml (always, to pick up image updates)
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
      # XPR_PRIVATE_KEY no longer accepted — agent uses proton CLI keychain.
      - XPR_PERMISSION=${XPR_PERMISSION:-active}
      - XPR_RPC_ENDPOINT=${XPR_RPC_ENDPOINT:-https://tn1.protonnz.com}
      - XPR_NETWORK=${XPR_NETWORK:-testnet}
      - INDEXER_URL=http://indexer:3001
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - AGENT_MODEL=${AGENT_MODEL:-claude-sonnet-4-6}
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

  telegram:
    image: ghcr.io/paulgnz/xpr-agent-telegram:latest
    profiles: ["telegram"]
    environment:
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - AGENT_URL=http://agent:8080
      - OPENCLAW_HOOK_TOKEN=${OPENCLAW_HOOK_TOKEN}
      - WEBHOOK_PORT=3002
      - DATA_DIR=/data
    volumes:
      - telegram-data:/data
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3002/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
    depends_on:
      agent:
        condition: service_healthy
    restart: unless-stopped

volumes:
  indexer-data:
  telegram-data:
DCEOF
success "docker-compose.yml written"

# Write chat script
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
      --max-time 120 \
      -d "{\"prompt\": $(echo "$PROMPT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))')}" 2>&1) || {
      echo "Error: $RESP"
      echo ""
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
  --max-time 120 \
  -d "{\"prompt\": $(echo "$PROMPT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))')}")

echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('result','(no response)'))" 2>/dev/null || echo "$RESP"
CHATEOF
chmod +x chat
success "chat script written"

# ── Phase 6: Infrastructure ─────────────────

echo ""
log "Checking infrastructure..."

# Check if containers are already running
INDEXER_RUNNING=false
AGENT_RUNNING=false
if $COMPOSE ps --format json 2>/dev/null | grep -q '"indexer"' 2>/dev/null; then
  INDEXER_RUNNING=true
elif $COMPOSE ps 2>/dev/null | grep -q 'indexer.*running' 2>/dev/null; then
  INDEXER_RUNNING=true
fi
if $COMPOSE ps --format json 2>/dev/null | grep -q '"agent"' 2>/dev/null; then
  AGENT_RUNNING=true
elif $COMPOSE ps 2>/dev/null | grep -q 'agent.*running' 2>/dev/null; then
  AGENT_RUNNING=true
fi

# Determine compose profiles
COMPOSE_PROFILES=""
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  COMPOSE_PROFILES="--profile telegram"
fi

# Pull latest images
log "Pulling latest images..."
$COMPOSE $COMPOSE_PROFILES pull 2>&1 | while IFS= read -r line; do echo "    $line"; done
success "Images up to date"

# Start or restart services
if [ "$EXISTING_SETUP" = true ]; then
  # Restart to pick up any config changes
  log "Restarting services with updated config..."
  $COMPOSE $COMPOSE_PROFILES up -d --force-recreate 2>&1 | while IFS= read -r line; do echo "    $line"; done
else
  log "Starting services..."
  $COMPOSE $COMPOSE_PROFILES up -d 2>&1 | while IFS= read -r line; do echo "    $line"; done
fi

# Wait for indexer health
echo -e "  ${CYAN}Waiting for indexer...${NC}"
for i in $(seq 1 45); do
  if curl -sf http://localhost:3001/health >/dev/null 2>&1; then
    success "Indexer healthy"
    break
  fi
  [ "$i" -eq 45 ] && fail "Indexer didn't start in 45s. Run: $COMPOSE logs indexer"
  sleep 1
done

# Wait for agent health
echo -e "  ${CYAN}Waiting for agent...${NC}"
for i in $(seq 1 30); do
  if curl -sf http://localhost:8080/health >/dev/null 2>&1; then
    success "Agent healthy"
    break
  fi
  [ "$i" -eq 30 ] && fail "Agent didn't start in 30s. Run: $COMPOSE logs agent"
  sleep 1
done

# ── Phase 7: Webhook Registration ───────────

echo ""
log "Checking webhook registration..."

EXISTING_HOOKS=$(curl -sf -H "Authorization: Bearer $WEBHOOK_ADMIN_TOKEN" \
  http://localhost:3001/api/webhooks 2>/dev/null || echo "[]")

if echo "$EXISTING_HOOKS" | grep -q "\"account_filter\":\"$XPR_ACCOUNT\""; then
  success "Webhook already registered for $XPR_ACCOUNT"
else
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
fi

# ── Phase 8: On-Chain Agent Registration ────

echo ""
log "Checking on-chain registration..."

AGENT_ONCHAIN=$(curl -s -X POST "$RPC_ENDPOINT/v1/chain/get_table_rows" \
  -H "Content-Type: application/json" \
  -d "{\"code\":\"agentcore\",\"table\":\"agents\",\"scope\":\"agentcore\",\"lower_bound\":\"$XPR_ACCOUNT\",\"upper_bound\":\"$XPR_ACCOUNT\",\"limit\":1,\"json\":true}" \
  2>/dev/null || echo '{"rows":[]}')

if echo "$AGENT_ONCHAIN" | grep -q "\"account\":\"$XPR_ACCOUNT\""; then
  success "Agent registered on-chain"
  # Show current on-chain info
  AGENT_NAME=$(echo "$AGENT_ONCHAIN" | python3 -c "import json,sys; rows=json.load(sys.stdin).get('rows',[]); print(rows[0].get('name','') if rows else '')" 2>/dev/null || echo "")
  [ -n "$AGENT_NAME" ] && echo -e "    Name: ${CYAN}${AGENT_NAME}${NC}"
else
  warn "Agent NOT registered on-chain"

  # Check balance and registration fee before attempting
  BALANCE_RAW=$(curl -s -X POST "$RPC_ENDPOINT/v1/chain/get_currency_balance" \
    -H "Content-Type: application/json" \
    -d "{\"code\":\"eosio.token\",\"account\":\"$XPR_ACCOUNT\",\"symbol\":\"XPR\"}" 2>/dev/null || echo '[]')
  BALANCE=$(echo "$BALANCE_RAW" | python3 -c "import json,sys; b=json.load(sys.stdin); print(float(b[0].split()[0]) if b else 0)" 2>/dev/null || echo "0")

  FEE_RAW=$(curl -s -X POST "$RPC_ENDPOINT/v1/chain/get_table_rows" \
    -H "Content-Type: application/json" \
    -d "{\"code\":\"agentcore\",\"table\":\"config\",\"scope\":\"agentcore\",\"limit\":1,\"json\":true}" 2>/dev/null || echo '{"rows":[]}')
  FEE=$(echo "$FEE_RAW" | python3 -c "import json,sys; rows=json.load(sys.stdin).get('rows',[]); print(rows[0].get('registration_fee',0)/10000 if rows else 0)" 2>/dev/null || echo "0")

  if python3 -c "exit(0 if float('$BALANCE') >= float('$FEE') else 1)" 2>/dev/null; then
    log "Registering agent on-chain (fee: ${FEE} XPR, balance: ${BALANCE} XPR)..."

    REG_RESP=$(curl -sf -X POST http://localhost:8080/run \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $OPENCLAW_HOOK_TOKEN" \
      --max-time 120 \
      -d "{\"prompt\": \"Do not ask any questions. Call xpr_register_agent immediately with these exact parameters: name='${XPR_ACCOUNT}', description='Autonomous AI agent on XPR Network', endpoint='http://localhost:8080', protocol='https', capabilities=['general','jobs','bidding'], fee_amount=${FEE}, confirmed=true. Execute the tool call now.\"}" \
      2>/dev/null || echo '{"error":"registration request failed"}')

    sleep 3
    AGENT_RECHECK=$(curl -s -X POST "$RPC_ENDPOINT/v1/chain/get_table_rows" \
      -H "Content-Type: application/json" \
      -d "{\"code\":\"agentcore\",\"table\":\"agents\",\"scope\":\"agentcore\",\"lower_bound\":\"$XPR_ACCOUNT\",\"upper_bound\":\"$XPR_ACCOUNT\",\"limit\":1,\"json\":true}" \
      2>/dev/null || echo '{"rows":[]}')

    if echo "$AGENT_RECHECK" | grep -q "\"account\":\"$XPR_ACCOUNT\""; then
      success "Agent registered on-chain"
    else
      warn "Registration failed. Check: $COMPOSE logs agent"
    fi
  else
    warn "Insufficient balance: ${BALANCE} XPR (need ${FEE} XPR registration fee)"
    echo -e "    ${CYAN}Send ${FEE} XPR to '${XPR_ACCOUNT}' on ${NETWORK}, then re-run this script.${NC}"
  fi
fi

# ── Phase 9: Final Status ───────────────────

echo ""
echo -e "${BOLD}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  Setup complete${NC}"
echo -e "${BOLD}═══════════════════════════════════════════${NC}"
echo ""

# Run full status check
INDEXER_HEALTH=$(curl -sf http://localhost:3001/health 2>/dev/null || echo '{}')
AGENT_HEALTH=$(curl -sf http://localhost:8080/health 2>/dev/null || echo '{}')
INDEXER_OK=$(echo "$INDEXER_HEALTH" | grep -c '"status"' 2>/dev/null || echo "0")
AGENT_OK=$(echo "$AGENT_HEALTH" | grep -c '"ok":true' 2>/dev/null || echo "0")
TOOL_COUNT=$(echo "$AGENT_HEALTH" | python3 -c "import json,sys; print(json.load(sys.stdin).get('tools',0))" 2>/dev/null || echo "?")

echo -e "  ${BOLD}Account:${NC}   $XPR_ACCOUNT"
echo -e "  ${BOLD}Network:${NC}   $NETWORK"
echo -e "  ${BOLD}Directory:${NC} $(pwd)"
echo ""

if [ "$INDEXER_OK" -gt 0 ]; then
  echo -e "  ${GREEN}Indexer:${NC}   healthy (http://localhost:3001)"
else
  echo -e "  ${RED}Indexer:${NC}   NOT healthy"
fi

if [ "$AGENT_OK" -gt 0 ]; then
  echo -e "  ${GREEN}Agent:${NC}     healthy (http://localhost:8080) — ${TOOL_COUNT} tools"
else
  echo -e "  ${RED}Agent:${NC}     NOT healthy"
fi

if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  TG_HEALTH=$(curl -sf http://localhost:3002/health 2>/dev/null || echo '{}')
  if echo "$TG_HEALTH" | grep -q '"ok":true'; then
    echo -e "  ${GREEN}Telegram:${NC}  connected — message your bot to start chatting"
  else
    echo -e "  ${YELLOW}Telegram:${NC}  starting... (check: $COMPOSE logs telegram)"
  fi
fi

# Check on-chain status one more time
FINAL_CHAIN=$(curl -s -X POST "$RPC_ENDPOINT/v1/chain/get_table_rows" \
  -H "Content-Type: application/json" \
  -d "{\"code\":\"agentcore\",\"table\":\"agents\",\"scope\":\"agentcore\",\"lower_bound\":\"$XPR_ACCOUNT\",\"upper_bound\":\"$XPR_ACCOUNT\",\"limit\":1,\"json\":true}" \
  2>/dev/null || echo '{"rows":[]}')

if echo "$FINAL_CHAIN" | grep -q "\"account\":\"$XPR_ACCOUNT\""; then
  echo -e "  ${GREEN}On-chain:${NC}  registered"
else
  echo -e "  ${YELLOW}On-chain:${NC}  not registered yet — run: ./chat \"Register me as an agent\""
fi

echo ""
echo -e "${BOLD}Talk to your agent:${NC}"
echo "  cd $(pwd)"
echo "  ./chat                              # Start chatting"
echo ""
echo -e "  ${CYAN}Tip: just run ./chat and type naturally — no quoting needed.${NC}"
echo ""
echo -e "${BOLD}Other commands:${NC}"
echo "  $COMPOSE logs -f           # Live logs"
echo "  $COMPOSE logs agent        # Agent only"
echo "  $COMPOSE restart           # Restart"
echo "  $COMPOSE down              # Stop"
echo ""
