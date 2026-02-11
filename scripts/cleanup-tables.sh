#!/bin/bash
set -e

# Cleanup old table rows across all 4 XPR Agent contracts.
# Run periodically (e.g., weekly cron) or manually.
# Only the contract owner can call these actions.
#
# Usage:
#   ./scripts/cleanup-tables.sh                    # testnet defaults
#   ./scripts/cleanup-tables.sh --network mainnet  # mainnet
#   ./scripts/cleanup-tables.sh --dry-run           # show commands without executing
#   ./scripts/cleanup-tables.sh --batch 50          # delete up to 50 rows per call

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Defaults
NETWORK="proton-test"
OWNER="paul123"
AGENT_CORE="agentcore"
AGENT_FEED="agentfeed"
AGENT_VALID="agentvalid"
AGENT_ESCROW="agentescrow"
MAX_AGE=$((90 * 86400))   # 90 days in seconds
MAX_DELETE=100             # rows per cleanup call
DRY_RUN=false

# Parse arguments
while [[ "$#" -gt 0 ]]; do
  case $1 in
    --network) NETWORK="$2"; shift ;;
    --owner) OWNER="$2"; shift ;;
    --batch) MAX_DELETE="$2"; shift ;;
    --max-age) MAX_AGE="$2"; shift ;;
    --dry-run) DRY_RUN=true ;;
    -h|--help)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --network <name>   Network (proton-test or proton, default: proton-test)"
      echo "  --owner <account>  Contract owner account (default: paul123)"
      echo "  --batch <n>        Max rows to delete per call (default: 100)"
      echo "  --max-age <secs>   Min age in seconds for cleanup (default: 7776000 = 90 days)"
      echo "  --dry-run          Print commands without executing"
      echo "  -h, --help         Show this help"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
  shift
done

if ! command -v proton &> /dev/null; then
  echo -e "${RED}Error: proton CLI not found. Install with: npm install -g @proton/cli${NC}"
  exit 1
fi

echo -e "${GREEN}=== XPR Agents Table Cleanup ===${NC}"
echo -e "Network:    ${CYAN}${NETWORK}${NC}"
echo -e "Owner:      ${CYAN}${OWNER}${NC}"
echo -e "Max age:    ${CYAN}$((MAX_AGE / 86400)) days${NC}"
echo -e "Batch size: ${CYAN}${MAX_DELETE}${NC}"
echo -e "Dry run:    ${CYAN}${DRY_RUN}${NC}"
echo ""

# Ensure correct network
proton chain:set "$NETWORK" > /dev/null 2>&1

run_action() {
  local contract=$1
  local action=$2
  local data=$3
  local auth=$4

  echo -e "${YELLOW}  ${contract}::${action}${NC} ${data}"

  if [ "$DRY_RUN" = true ]; then
    echo -e "  ${CYAN}(dry run — skipped)${NC}"
    return 0
  fi

  if proton action "$contract" "$action" "$data" "$auth" 2>&1; then
    echo -e "  ${GREEN}OK${NC}"
  else
    echo -e "  ${RED}FAILED${NC} (may have no rows to clean)"
  fi
}

# ──────────────────────────────────────────────
# agentcore — clean old plugin results (min 1 hour)
# ──────────────────────────────────────────────
echo -e "${GREEN}[1/6] agentcore::cleanresults${NC}"
run_action "$AGENT_CORE" "cleanresults" \
  "{\"agent\":\"$OWNER\",\"max_age\":3600,\"max_delete\":$MAX_DELETE}" \
  "$OWNER"

# ──────────────────────────────────────────────
# agentfeed — clean old resolved feedback (90 days)
# ──────────────────────────────────────────────
echo -e "${GREEN}[2/6] agentfeed::cleanfback${NC}"
run_action "$AGENT_FEED" "cleanfback" \
  "{\"agent\":\"\",\"max_age\":$MAX_AGE,\"max_delete\":$MAX_DELETE}" \
  "$OWNER"

# agentfeed — clean resolved disputes (90 days)
echo -e "${GREEN}[3/6] agentfeed::cleandisps${NC}"
run_action "$AGENT_FEED" "cleandisps" \
  "{\"max_age\":$MAX_AGE,\"max_delete\":$MAX_DELETE}" \
  "$OWNER"

# ──────────────────────────────────────────────
# agentvalid — clean old validations (90 days)
# ──────────────────────────────────────────────
echo -e "${GREEN}[4/6] agentvalid::cleanvals${NC}"
run_action "$AGENT_VALID" "cleanvals" \
  "{\"agent\":\"\",\"max_age\":$MAX_AGE,\"max_delete\":$MAX_DELETE}" \
  "$OWNER"

# agentvalid — clean resolved challenges (90 days)
echo -e "${GREEN}[5/6] agentvalid::cleanchals${NC}"
run_action "$AGENT_VALID" "cleanchals" \
  "{\"max_age\":$MAX_AGE,\"max_delete\":$MAX_DELETE}" \
  "$OWNER"

# ──────────────────────────────────────────────
# agentescrow — clean completed/refunded/arbitrated jobs + milestones (90 days)
# ──────────────────────────────────────────────
echo -e "${GREEN}[6/6] agentescrow::cleanjobs + cleandisps${NC}"
run_action "$AGENT_ESCROW" "cleanjobs" \
  "{\"max_age\":$MAX_AGE,\"max_delete\":$MAX_DELETE}" \
  "$OWNER"

run_action "$AGENT_ESCROW" "cleandisps" \
  "{\"max_age\":$MAX_AGE,\"max_delete\":$MAX_DELETE}" \
  "$OWNER"

echo ""
echo -e "${GREEN}Cleanup complete.${NC}"
echo -e "Tip: Run periodically via cron, e.g.:"
echo -e "  ${CYAN}0 3 * * 0 /path/to/scripts/cleanup-tables.sh${NC}"
