#!/usr/bin/env bash
#
# Upgrade an existing XPR agent deployment to proton-CLI-only signing.
#
# This script is idempotent — safe to run multiple times. It detects the
# current state and only does what's needed. Destructive operations
# (deleting files, overwriting .env, killing processes) require explicit
# confirmation unless --yes is passed.
#
# Usage:
#   ./scripts/upgrade-to-cli-signing.sh [--dir <agent-dir>] [--yes] [--dry-run]
#
# What it does:
#   1. Verify proton CLI is installed (offers to install if not)
#   2. Verify keychain has the account's key (prompts to run `proton key:add`)
#   3. Backup .env, strip XPR_PRIVATE_KEY (with confirmation)
#   4. Pull latest code, install deps, rebuild
#   5. Print restart instructions and A2A setup notes
#
# What it does NOT do:
#   - Touch your private key (you handle that via `proton key:add`)
#   - Set up A2A — prints instructions instead (manual permission registration needed)
#   - Restart the agent process — you do that yourself when ready
#
# See docs/UPGRADE-PROTON-CLI.md for the full guide.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()   { echo -e "${CYAN}[upgrade]${NC} $*"; }
ok()    { echo -e "  ${GREEN}✓${NC} $*"; }
warn()  { echo -e "  ${YELLOW}!${NC} $*"; }
fail()  { echo -e "  ${RED}✗ $*${NC}" >&2; exit 1; }
info()  { echo -e "    $*"; }

# ── Parse args ─────────────────────────────────
AGENT_DIR=""
ASSUME_YES=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)     AGENT_DIR="$2"; shift 2 ;;
    --yes|-y)  ASSUME_YES=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    --help|-h)
      sed -n '/^# Upgrade an existing/,/^# See docs/p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) fail "Unknown arg: $1 (try --help)" ;;
  esac
done

# ── Locate the agent directory ─────────────────
if [ -z "$AGENT_DIR" ]; then
  for candidate in "./agent" "$HOME/xpr-agent/agent" "$HOME/xpr-agent" "$(pwd)"; do
    if [ -f "$candidate/.env" ] && [ -f "$candidate/package.json" ]; then
      AGENT_DIR="$candidate"
      break
    fi
  done
fi

[ -z "$AGENT_DIR" ] && fail "Could not auto-detect agent directory. Pass --dir <path>."
[ ! -f "$AGENT_DIR/.env" ] && fail "$AGENT_DIR/.env not found"
[ ! -f "$AGENT_DIR/package.json" ] && fail "$AGENT_DIR/package.json not found"

AGENT_DIR=$(cd "$AGENT_DIR" && pwd)
log "Agent directory: ${BOLD}${AGENT_DIR}${NC}"

# ── Confirm helper ─────────────────────────────
confirm() {
  local prompt="$1"
  if [ "$ASSUME_YES" = true ]; then return 0; fi
  echo -n "  ${prompt} [y/N]: "
  read -r ans
  [[ "$ans" =~ ^[Yy] ]]
}

run() {
  if [ "$DRY_RUN" = true ]; then
    echo "    (dry-run) $*"
  else
    eval "$@"
  fi
}

# ── Step 1: Detect current XPR_ACCOUNT ─────────
log "Reading current configuration..."
CURRENT_ACCOUNT=$(grep -E "^XPR_ACCOUNT=" "$AGENT_DIR/.env" | head -1 | cut -d= -f2 | tr -d '"' | tr -d "'" || true)
HAS_LEGACY_KEY=$(grep -cE "^XPR_PRIVATE_KEY=" "$AGENT_DIR/.env" 2>/dev/null || true)
HAS_A2A_KEY=$(grep -cE "^A2A_SIGNING_KEY=" "$AGENT_DIR/.env" 2>/dev/null || true)

[ -z "$CURRENT_ACCOUNT" ] && fail ".env is missing XPR_ACCOUNT — run setup.sh first"
ok "Account: $CURRENT_ACCOUNT"

if [ "${HAS_LEGACY_KEY:-0}" -gt 0 ]; then
  warn "Legacy XPR_PRIVATE_KEY found in .env (will be removed below)"
else
  ok "XPR_PRIVATE_KEY not in .env"
fi

# ── Step 2: Verify proton CLI ──────────────────
log "Checking proton CLI..."
if ! command -v proton &>/dev/null; then
  warn "proton CLI not installed"
  if confirm "Install hardened proton CLI globally?"; then
    run "npm i -g github:paulgnz/proton-cli#security/key-list-redact"
    ok "Installed"
  else
    fail "proton CLI is required. Install manually:
      npm i -g github:paulgnz/proton-cli#security/key-list-redact"
  fi
else
  ok "proton CLI found ($(proton --version 2>&1 | head -1))"
fi

# Verify it's the hardened fork (it redacts private keys by default)
HARDENED_OK=$(proton key:list 2>&1 | grep -c "Private keys hidden" || true)
if [ "${HARDENED_OK:-0}" -eq 0 ]; then
  warn "Your proton CLI may not be the hardened fork (key:list does not redact)"
  warn "Recommended: npm i -g github:paulgnz/proton-cli#security/key-list-redact"
fi

# ── Step 3: Verify chain matches XPR_NETWORK ───
CURRENT_CHAIN=$(proton chain:get 2>/dev/null | grep -oE '"chain":\s*"[^"]+"' | cut -d'"' -f4 || true)
DESIRED_NETWORK=$(grep -E "^XPR_NETWORK=" "$AGENT_DIR/.env" | head -1 | cut -d= -f2 | tr -d '"' | tr -d "'" || true)
DESIRED_NETWORK="${DESIRED_NETWORK:-mainnet}"
DESIRED_CHAIN="proton"; [ "$DESIRED_NETWORK" = "testnet" ] && DESIRED_CHAIN="proton-test"

if [ "$CURRENT_CHAIN" != "$DESIRED_CHAIN" ]; then
  warn "proton CLI chain ($CURRENT_CHAIN) does not match agent's XPR_NETWORK ($DESIRED_NETWORK)"
  if confirm "Switch proton CLI to $DESIRED_CHAIN?"; then
    run "proton chain:set $DESIRED_CHAIN"
    ok "Chain set to $DESIRED_CHAIN"
  fi
else
  ok "Chain: $CURRENT_CHAIN"
fi

# ── Step 4: Verify keychain has account's key ──
log "Checking proton CLI keychain for $CURRENT_ACCOUNT..."
KEY_FOUND=$(proton key:list 2>/dev/null | grep -c "\"$CURRENT_ACCOUNT\"" || true)

if [ "${KEY_FOUND:-0}" -eq 0 ]; then
  warn "No key in keychain links to '$CURRENT_ACCOUNT'"
  echo ""
  echo "  Run this in another terminal, paste your private key when prompted:"
  echo "    ${BOLD}proton key:add${NC}"
  echo ""
  echo "  After it succeeds, re-run this script — it will continue from here."
  echo ""
  if confirm "Pause now to add the key?"; then
    echo "  Waiting... press Enter when done."
    read -r _
    KEY_FOUND=$(proton key:list 2>/dev/null | grep -c "\"$CURRENT_ACCOUNT\"" || true)
    if [ "${KEY_FOUND:-0}" -eq 0 ]; then
      fail "Still no key for '$CURRENT_ACCOUNT' in keychain. Run \`proton key:add\` and try again."
    fi
    ok "Key found for $CURRENT_ACCOUNT"
  else
    exit 1
  fi
else
  ok "Keychain has key for $CURRENT_ACCOUNT"
fi

# ── Step 5: Backup and strip .env ──────────────
if [ "${HAS_LEGACY_KEY:-0}" -gt 0 ]; then
  log "Removing XPR_PRIVATE_KEY from .env..."
  if confirm "Backup .env to .env.bak.$(date +%Y%m%d-%H%M%S) and strip XPR_PRIVATE_KEY?"; then
    BACKUP="${AGENT_DIR}/.env.bak.$(date +%Y%m%d-%H%M%S)"
    run "cp '$AGENT_DIR/.env' '$BACKUP'"
    run "grep -v '^XPR_PRIVATE_KEY=' '$BACKUP' > '$AGENT_DIR/.env'"
    ok "Backed up to $BACKUP"
    ok "XPR_PRIVATE_KEY removed from .env"
  else
    warn "Skipped — agent will refuse to start until XPR_PRIVATE_KEY is removed"
  fi
fi

# ── Step 6: Pull and rebuild ───────────────────
log "Updating agent code..."
GIT_ROOT=""
if git -C "$AGENT_DIR" rev-parse --show-toplevel >/dev/null 2>&1; then
  GIT_ROOT=$(git -C "$AGENT_DIR" rev-parse --show-toplevel)
fi

if [ -n "$GIT_ROOT" ]; then
  CURRENT_SHA=$(git -C "$GIT_ROOT" rev-parse HEAD)
  echo "  Git repo: $GIT_ROOT"
  echo "  Current SHA: $CURRENT_SHA (saved to /tmp/agent-pre-upgrade-sha for rollback)"
  echo "$CURRENT_SHA" > /tmp/agent-pre-upgrade-sha
  if confirm "Pull latest from origin?"; then
    run "git -C '$GIT_ROOT' pull --ff-only"
    ok "Pulled"
  fi
else
  warn "$AGENT_DIR is not inside a git repo — code update is manual"
  info "Either: (a) re-run setup.sh from a fresh checkout"
  info "    or: (b) tar xzf <(curl -sL https://github.com/XPRNetwork/xpr-agents/archive/refs/heads/main.tar.gz)"
fi

if confirm "Run npm install + npm run build?"; then
  run "cd '$AGENT_DIR' && npm install --loglevel=warn"
  run "cd '$AGENT_DIR' && npm run build"
  ok "Built"
fi

# ── Step 7: A2A guidance ───────────────────────
log "A2A signing setup..."
if [ "${HAS_A2A_KEY:-0}" -gt 0 ]; then
  ok "A2A_SIGNING_KEY is set — outbound A2A calls will work"
else
  warn "A2A_SIGNING_KEY is not set — agent will run A2A in receive-only mode"
  echo ""
  echo "  If your agent makes outbound A2A calls (xpr_a2a_send_message etc.),"
  echo "  you need to set up a separate signing key on a custom permission."
  echo "  See: docs/UPGRADE-PROTON-CLI.md (A2A section) and docs/A2A.md"
  echo ""
fi

# ── Step 8: Final summary ──────────────────────
echo ""
log "${GREEN}${BOLD}Upgrade prep complete.${NC}"
echo ""
echo "  Next:"
echo "    1. Stop the running agent (if any):"
echo "         pkill -f 'node.*dist/index.js'"
echo "         (or: docker compose down, if you were on Docker)"
echo "    2. Start the new agent:"
echo "         cd $AGENT_DIR && npm start"
echo "    3. Watch for: ${BOLD}[agent] proton CLI ready (keychain populated)${NC}"
echo "    4. Verify with: curl http://localhost:8080/health"
echo ""
echo "  Rollback if needed:"
echo "    git -C ${GIT_ROOT:-$AGENT_DIR} checkout \$(cat /tmp/agent-pre-upgrade-sha)"
echo "    mv $AGENT_DIR/.env.bak.* $AGENT_DIR/.env  (restores XPR_PRIVATE_KEY)"
echo "    npm install && npm run build && npm start"
echo ""
echo "  See ${BOLD}docs/UPGRADE-PROTON-CLI.md${NC} for full guide and troubleshooting."
