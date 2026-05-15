#!/usr/bin/env bash
# setup-security.sh — Pillar 2 lockdown for an XPR Agents account.
#
# Delegates the agent's `owner` permission to a separate human-controlled
# account, so even if the agent's active key is compromised the attacker
# cannot rotate the account away from you.
#
# Idempotent: if owner is already controlled by a non-raw-key account
# permission, exits cleanly with no changes.
#
# Refuses to run unattended — TTY required, explicit yes/no on every
# prompt, type-to-confirm account names, hard-fails on any precondition
# (account doesn't exist, key not in keychain, etc).
#
# See docs/SECURITY.md for the full security model.

set -eu

# ── Colors ─────────────────────────────────────
if [ -t 1 ]; then
  RED=$'\033[31m'
  GREEN=$'\033[32m'
  YELLOW=$'\033[33m'
  BOLD=$'\033[1m'
  NC=$'\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BOLD=''; NC=''
fi

err()    { printf "${RED}${BOLD}ERROR:${NC} %s\n" "$*" >&2; }
warn()   { printf "${YELLOW}!${NC} %s\n" "$*"; }
ok()     { printf "${GREEN}✓${NC} %s\n" "$*"; }
info()   { printf "  %s\n" "$*"; }
step()   { printf "\n${BOLD}[%s]${NC} %s\n" "$1" "$2"; }
abort()  { err "$*"; exit 1; }

# ── Hard preconditions ─────────────────────────

# Require a TTY. We will NOT run this from a pipe, a heredoc, or under
# automation. The whole point is human-in-the-loop.
if [ ! -t 0 ] || [ ! -t 1 ]; then
  err "setup-security.sh requires an interactive terminal."
  err "Do not pipe input or run this from automation."
  exit 1
fi

# Require proton CLI on PATH.
if ! command -v proton >/dev/null 2>&1; then
  err "proton CLI not found on PATH."
  info "Install it: npm i -g @proton/cli"
  info "Then add the npm global bin to PATH:"
  info "  export PATH=\"\$(npm config get prefix)/bin:\$PATH\""
  exit 1
fi

# Require XPR_ACCOUNT or --account arg.
AGENT_ACCOUNT="${XPR_ACCOUNT:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --account) AGENT_ACCOUNT="$2"; shift 2 ;;
    --help|-h)
      cat <<'EOF'
Usage: ./setup-security.sh [--account <agent-account>]

Locks down the agent's `owner` permission so that only a human-controlled
XPR account can change permissions. Run once per agent. Idempotent.

The agent's `active` key stays in the proton CLI keychain — daily signing
is unchanged. Only the `owner` permission moves to your human account.

See docs/SECURITY.md for the full rationale.
EOF
      exit 0 ;;
    *) shift ;;
  esac
done

if [ -z "$AGENT_ACCOUNT" ]; then
  err "Agent account not specified."
  info "Pass --account <name> or set XPR_ACCOUNT in env."
  exit 1
fi

# Validate name shape (EOSIO: 1-12 chars, .12345abcdefghijklmnopqrstuvwxyz)
if ! printf '%s' "$AGENT_ACCOUNT" | grep -qE '^[.1-5a-z]{1,12}$'; then
  abort "'$AGENT_ACCOUNT' is not a valid XPR Network account name (1-12 chars from .12345a-z)."
fi

# ── Banner ─────────────────────────────────────
cat <<EOF

========================================================================
  ${BOLD}XPR AGENTS — SECURITY SETUP${NC} (Pillar 2: lock down owner)
========================================================================

  Target agent account: ${BOLD}${AGENT_ACCOUNT}${NC}

  This script will delegate '$AGENT_ACCOUNT's owner permission to a
  separate human-controlled XPR account. After this:

    • Your human account controls recovery if the agent's key leaks.
    • The agent's active key stays in the proton CLI keychain — daily
      signing is unchanged.
    • The agent's owner permission will have NO raw keys — only your
      human account can change permissions.

  This is recommended but not automatic. See docs/SECURITY.md for the
  full security model.

EOF

# ── Step 1: Read current account state ─────────
step "1/6" "Reading current state for '$AGENT_ACCOUNT'..."

if ! ACCOUNT_JSON=$(proton account "$AGENT_ACCOUNT" --json 2>/dev/null); then
  # Fallback: --json may not be supported on older proton CLI versions
  if ! ACCOUNT_OUT=$(proton account "$AGENT_ACCOUNT" 2>&1); then
    err "Failed to look up account '$AGENT_ACCOUNT'."
    info "Does the account exist? Check: proton account $AGENT_ACCOUNT"
    info "Are you on the right chain? Check: proton chain"
    exit 1
  fi
  # No JSON support — fall back to text parsing. Less robust.
  ACCOUNT_JSON=""
fi

# Extract permissions. Prefer JSON if available.
if [ -n "$ACCOUNT_JSON" ]; then
  OWNER_KEYS=$(printf '%s' "$ACCOUNT_JSON" | node -e "
    let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{
      try {
        const a = JSON.parse(s);
        const owner = (a.permissions||[]).find(p=>p.perm_name==='owner');
        if (!owner) { console.log(''); return; }
        const keys = (owner.required_auth?.keys||[]).map(k=>k.key);
        console.log(keys.join(','));
      } catch(e) { console.log(''); }
    });
  " <<< "$ACCOUNT_JSON")
  OWNER_ACCOUNTS=$(printf '%s' "$ACCOUNT_JSON" | node -e "
    let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{
      try {
        const a = JSON.parse(s);
        const owner = (a.permissions||[]).find(p=>p.perm_name==='owner');
        if (!owner) { console.log(''); return; }
        const accts = (owner.required_auth?.accounts||[]).map(x=>x.permission.actor+'@'+x.permission.permission);
        console.log(accts.join(','));
      } catch(e) { console.log(''); }
    });
  " <<< "$ACCOUNT_JSON")
  ACTIVE_KEYS=$(printf '%s' "$ACCOUNT_JSON" | node -e "
    let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{
      try {
        const a = JSON.parse(s);
        const active = (a.permissions||[]).find(p=>p.perm_name==='active');
        if (!active) { console.log(''); return; }
        const keys = (active.required_auth?.keys||[]).map(k=>k.key);
        console.log(keys.join(','));
      } catch(e) { console.log(''); }
    });
  " <<< "$ACCOUNT_JSON")
else
  abort "proton account output format not recognized. Update proton CLI: npm i -g @proton/cli"
fi

info "owner perm keys:     ${OWNER_KEYS:-(none)}"
info "owner perm accounts: ${OWNER_ACCOUNTS:-(none)}"
info "active perm keys:    ${ACTIVE_KEYS:-(none)}"

# Idempotency check: if owner has no raw keys, we're already done.
if [ -z "$OWNER_KEYS" ] && [ -n "$OWNER_ACCOUNTS" ]; then
  ok "Already secured. owner is controlled by: $OWNER_ACCOUNTS"
  info "No changes needed. If you want to change the owner-controlling account,"
  info "run a manual updateauth — see docs/SECURITY.md."
  exit 0
fi

if [ -z "$OWNER_KEYS" ]; then
  abort "owner permission has no keys AND no accounts? This is unusual. Check: proton account $AGENT_ACCOUNT"
fi

# We have raw keys on owner. Proceed.
warn "owner permission currently has raw keys. This is the default after account creation."
warn "If that key leaks, an attacker can rotate you out of your own account."

# ── Step 2: Verify we can sign as <agent>@owner ─
step "2/6" "Verifying we can sign as ${AGENT_ACCOUNT}@owner..."

KEYLIST=$(proton key:list 2>/dev/null || true)
MATCHED_OWNER_KEY=""
IFS=',' read -ra OWNER_KEY_ARR <<< "$OWNER_KEYS"
for k in "${OWNER_KEY_ARR[@]}"; do
  if printf '%s' "$KEYLIST" | grep -qF "\"publicKey\": \"$k\""; then
    MATCHED_OWNER_KEY="$k"
    break
  fi
done

if [ -z "$MATCHED_OWNER_KEY" ]; then
  err "None of the owner-permission keys are loaded in the proton CLI keychain."
  info "Owner keys on chain: $OWNER_KEYS"
  info ""
  info "Load the owner private key (PVT_K1_...) into the keychain:"
  info "  proton key:add"
  info ""
  info "For WebAuth-created accounts: the K1 backup key is in your wallet"
  info "(WebAuth → Settings → Backup → reveal key)."
  exit 1
fi
ok "Found matching key for ${AGENT_ACCOUNT}@owner: $MATCHED_OWNER_KEY"

# Determine the K1 we'll put on active. If active is currently a WA key
# (WebAuth biometric, unusable for autonomous signing), we replace it with
# the K1 currently on owner. If active is already a K1, we leave it alone.
NEW_ACTIVE_KEY=""
ACTIVE_NEEDS_REWRITE="no"

ACTIVE_HAS_WA="no"
IFS=',' read -ra ACTIVE_KEY_ARR <<< "$ACTIVE_KEYS"
for k in "${ACTIVE_KEY_ARR[@]}"; do
  case "$k" in
    PUB_WA_*) ACTIVE_HAS_WA="yes" ;;
  esac
done

if [ "$ACTIVE_HAS_WA" = "yes" ]; then
  # WebAuth case — must rewrite active to the K1.
  NEW_ACTIVE_KEY="$MATCHED_OWNER_KEY"
  ACTIVE_NEEDS_REWRITE="yes"
  info "active permission is WebAuth-only (PUB_WA_...) — agent can't sign autonomously."
  info "Will replace active with the K1 currently on owner: $MATCHED_OWNER_KEY"
elif [ -z "$ACTIVE_KEYS" ]; then
  err "active permission has no keys. This is unusual — check manually:"
  info "  proton account $AGENT_ACCOUNT"
  exit 1
else
  # Active already has K1(s). Leave alone.
  NEW_ACTIVE_KEY="$(printf '%s' "$ACTIVE_KEYS" | cut -d, -f1)"
  ACTIVE_NEEDS_REWRITE="no"
  info "active permission already has K1 key: $NEW_ACTIVE_KEY"
  info "No change to active needed."
fi

# Verify the K1 we want on active is in the keychain (whether we're
# rewriting or leaving alone — either way, the agent needs to sign with
# it daily).
if ! printf '%s' "$KEYLIST" | grep -qF "\"publicKey\": \"$NEW_ACTIVE_KEY\""; then
  err "Final active key ($NEW_ACTIVE_KEY) is not in the proton CLI keychain."
  err "The agent would not be able to sign after this change. Aborting."
  info "Load the matching PVT_K1_ key first: proton key:add"
  exit 1
fi
ok "Final active key ($NEW_ACTIVE_KEY) is in the keychain."

# ── Step 3: Ask for human account ──────────────
step "3/6" "Your personal XPR account"

cat <<EOF

  ${YELLOW}This account will control recovery of '$AGENT_ACCOUNT' forever.${NC}

  It MUST be an account you fully control TODAY. Strongly recommended:
    • KYC-verified (gives the agent +30 trust score via the claim system)
    • WebAuth-secured (Face ID / fingerprint signing, key never on a server)
    • Not an account you share with anyone
    • Not the same account as the agent itself

  Be CAREFUL: a typo here delegates owner to a nonexistent or someone
  else's account, and you will lose control of '$AGENT_ACCOUNT' forever.

EOF

read -rp "  Your personal XPR account name: " HUMAN_ACCOUNT
HUMAN_ACCOUNT="$(printf '%s' "$HUMAN_ACCOUNT" | tr -d '[:space:]')"

if [ -z "$HUMAN_ACCOUNT" ]; then
  abort "No account name given. Aborting."
fi
if ! printf '%s' "$HUMAN_ACCOUNT" | grep -qE '^[.1-5a-z]{1,12}$'; then
  abort "'$HUMAN_ACCOUNT' is not a valid XPR Network account name (1-12 chars from .12345a-z)."
fi
if [ "$HUMAN_ACCOUNT" = "$AGENT_ACCOUNT" ]; then
  abort "The human account cannot be the same as the agent account. That defeats the entire purpose."
fi

info ""
info "Looking up '$HUMAN_ACCOUNT' on chain..."
if ! HUMAN_JSON=$(proton account "$HUMAN_ACCOUNT" --json 2>/dev/null); then
  err "Account '$HUMAN_ACCOUNT' not found on chain."
  info "Did you typo it? Verify at:"
  info "  https://explorer.xprnetwork.org/account/$HUMAN_ACCOUNT"
  info ""
  abort "Refusing to delegate owner to a nonexistent account."
fi

# Extract human account info for display
HUMAN_BALANCE=$(printf '%s' "$HUMAN_JSON" | node -e "
  let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{
    try {
      const a = JSON.parse(s);
      console.log(a.core_liquid_balance || '0 XPR');
    } catch(e) { console.log('?'); }
  });
" <<< "$HUMAN_JSON")
HUMAN_CREATED=$(printf '%s' "$HUMAN_JSON" | node -e "
  let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{
    try {
      const a = JSON.parse(s);
      console.log((a.created || '').slice(0,10) || '?');
    } catch(e) { console.log('?'); }
  });
" <<< "$HUMAN_JSON")
HUMAN_ACTIVE_KEYS=$(printf '%s' "$HUMAN_JSON" | node -e "
  let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{
    try {
      const a = JSON.parse(s);
      const active = (a.permissions||[]).find(p=>p.perm_name==='active');
      const keys = (active?.required_auth?.keys||[]).map(k=>k.key);
      console.log(keys.join(',') || '(no raw keys)');
    } catch(e) { console.log('?'); }
  });
" <<< "$HUMAN_JSON")

ok "Account exists"
info "  Created:           $HUMAN_CREATED"
info "  XPR balance:       $HUMAN_BALANCE"
info "  active perm keys:  $HUMAN_ACTIVE_KEYS"

# Warn if human account isn't WebAuth-secured (recommendation, not a block)
case "$HUMAN_ACTIVE_KEYS" in
  *PUB_WA_*) info "  ✓ active key is WebAuth (biometric) — good." ;;
  *) warn "  active key is NOT WebAuth-biometric. This is allowed but weaker." ;;
esac

# ── Step 4: Critical confirmation ──────────────
step "4/6" "${BOLD}${RED}CRITICAL CONFIRMATION${NC}"

cat <<EOF

  Open this URL in your browser ${BOLD}right now${NC}:
      ${BOLD}https://explorer.xprnetwork.org/account/$HUMAN_ACCOUNT${NC}

  Visually verify on the explorer:
    ☐ The account name is exactly '$HUMAN_ACCOUNT' (no typos)
    ☐ The balance / activity look like YOUR account
    ☐ You can sign transactions from this account today

  If ANY of these are wrong, hit ${BOLD}Ctrl+C${NC} now and start over.

  After this script completes, '$AGENT_ACCOUNT' is controlled by '$HUMAN_ACCOUNT'
  forever — only '$HUMAN_ACCOUNT' can change it back.

EOF

read -rp "  Type the agent account name '${AGENT_ACCOUNT}' to confirm target: " CONFIRM_AGENT
if [ "$CONFIRM_AGENT" != "$AGENT_ACCOUNT" ]; then
  abort "Agent account didn't match. Aborting (no changes made)."
fi

read -rp "  Type the human account name '${HUMAN_ACCOUNT}' to confirm controller: " CONFIRM_HUMAN
if [ "$CONFIRM_HUMAN" != "$HUMAN_ACCOUNT" ]; then
  abort "Human account didn't match. Aborting (no changes made)."
fi

# ── Step 5: Show transaction plan ──────────────
step "5/6" "Transaction plan"

cat <<EOF

  Will push ONE atomic transaction to '$AGENT_ACCOUNT' with the
  following updateauth actions:

EOF

if [ "$ACTIVE_NEEDS_REWRITE" = "yes" ]; then
  cat <<EOF
  ${BOLD}action 1: active → K1${NC}
    permission: active
    parent:     owner
    threshold:  1
    keys:       [$NEW_ACTIVE_KEY]
    accounts:   []
    (was: $ACTIVE_KEYS)
EOF
fi

cat <<EOF

  ${BOLD}action $([ "$ACTIVE_NEEDS_REWRITE" = "yes" ] && echo 2 || echo 1): owner → human account${NC}
    permission: owner
    parent:     (root)
    threshold:  1
    keys:       []
    accounts:   [${HUMAN_ACCOUNT}@active]
    (was raw key: $MATCHED_OWNER_KEY)

  Signed by: ${AGENT_ACCOUNT}@owner (from your proton CLI keychain)

  ${RED}${BOLD}This is irreversible from the agent side.${NC} After this lands,
  only ${HUMAN_ACCOUNT}@active can change ${AGENT_ACCOUNT}'s permissions.

EOF

read -rp "  Type ${BOLD}'yes I understand'${NC} to proceed (anything else aborts): " FINAL
if [ "$FINAL" != "yes I understand" ]; then
  abort "Aborted at final confirmation. No changes made."
fi

# ── Step 6: Build and push transaction ─────────
step "6/6" "Pushing transaction..."

# Build the actions array
ACTIONS_JSON=""
if [ "$ACTIVE_NEEDS_REWRITE" = "yes" ]; then
  ACTIONS_JSON="{\"account\":\"eosio\",\"name\":\"updateauth\",\"authorization\":[{\"actor\":\"${AGENT_ACCOUNT}\",\"permission\":\"owner\"}],\"data\":{\"account\":\"${AGENT_ACCOUNT}\",\"permission\":\"active\",\"parent\":\"owner\",\"auth\":{\"threshold\":1,\"keys\":[{\"key\":\"${NEW_ACTIVE_KEY}\",\"weight\":1}],\"accounts\":[],\"waits\":[]}}},"
fi
ACTIONS_JSON="${ACTIONS_JSON}{\"account\":\"eosio\",\"name\":\"updateauth\",\"authorization\":[{\"actor\":\"${AGENT_ACCOUNT}\",\"permission\":\"owner\"}],\"data\":{\"account\":\"${AGENT_ACCOUNT}\",\"permission\":\"owner\",\"parent\":\"\",\"auth\":{\"threshold\":1,\"keys\":[],\"accounts\":[{\"permission\":{\"actor\":\"${HUMAN_ACCOUNT}\",\"permission\":\"active\"},\"weight\":1}],\"waits\":[]}}}"

TX_JSON="{\"actions\":[${ACTIONS_JSON}]}"

# Push. Capture both stdout and stderr.
if ! TX_RESULT=$(proton transaction:push "$TX_JSON" 2>&1); then
  err "Transaction failed:"
  printf '%s\n' "$TX_RESULT"
  err ""
  err "No permission changes were made (EOSIO transactions are atomic)."
  err "If this is recoverable, re-run the script. Otherwise check:"
  info "  proton account $AGENT_ACCOUNT"
  exit 1
fi

# Extract tx id from the result (proton CLI prints it)
TX_ID=$(printf '%s' "$TX_RESULT" | grep -oE '[a-f0-9]{64}' | head -1)
if [ -n "$TX_ID" ]; then
  ok "tx $TX_ID submitted"
else
  warn "Transaction submitted but tx id not parsed from output."
  info "Output: $TX_RESULT"
fi

# Wait a beat for the tx to land
sleep 3

# Re-fetch and verify end-state
info ""
info "Verifying final state..."
if ! POST_JSON=$(proton account "$AGENT_ACCOUNT" --json 2>/dev/null); then
  err "Failed to re-fetch account state. Verify manually:"
  info "  proton account $AGENT_ACCOUNT"
  info "  https://explorer.xprnetwork.org/account/$AGENT_ACCOUNT"
  exit 1
fi

POST_OWNER_KEYS=$(printf '%s' "$POST_JSON" | node -e "
  let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{
    try {
      const a = JSON.parse(s);
      const owner = (a.permissions||[]).find(p=>p.perm_name==='owner');
      const keys = (owner?.required_auth?.keys||[]).map(k=>k.key);
      console.log(keys.join(','));
    } catch(e) { console.log(''); }
  });
" <<< "$POST_JSON")
POST_OWNER_ACCOUNTS=$(printf '%s' "$POST_JSON" | node -e "
  let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{
    try {
      const a = JSON.parse(s);
      const owner = (a.permissions||[]).find(p=>p.perm_name==='owner');
      const accts = (owner?.required_auth?.accounts||[]).map(x=>x.permission.actor+'@'+x.permission.permission);
      console.log(accts.join(','));
    } catch(e) { console.log(''); }
  });
" <<< "$POST_JSON")

if [ -n "$POST_OWNER_KEYS" ]; then
  err "owner still has raw keys after the change: $POST_OWNER_KEYS"
  err "Pillar 2 is NOT in place. Investigate via the explorer."
  exit 1
fi

if [ "$POST_OWNER_ACCOUNTS" != "${HUMAN_ACCOUNT}@active" ]; then
  err "owner is not what we expected. Got: $POST_OWNER_ACCOUNTS"
  err "Investigate via the explorer."
  exit 1
fi

ok "owner now controlled by: ${HUMAN_ACCOUNT}@active (no raw keys)"
ok "Pillar 2 is in place."

cat <<EOF

${GREEN}${BOLD}Done.${NC} '$AGENT_ACCOUNT' is secured.

  • Daily signing: still works (active key is in the proton CLI keychain).
  • Recovery: signed from ${HUMAN_ACCOUNT}@active if you ever need to rotate active.

  Verify visually:
    https://explorer.xprnetwork.org/account/$AGENT_ACCOUNT

  Next steps (optional):
    • Dry-run the recovery: see docs/SECURITY.md → "Optional: test recovery".
    • Claim the agent via your KYC'd human account for +30 trust score.

EOF
