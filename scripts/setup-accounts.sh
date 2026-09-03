#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== XPR Agents Account Setup ===${NC}"

# Configuration
NETWORK=${1:-proton-test}
AGENT_CORE=${2:-agentcore}
AGENT_FEED=${3:-agentfeed}
AGENT_VALID=${4:-agentvalid}
AGENT_ESCROW=${5:-agentescrow}

# Creator pays for and signs the creation of any missing account.
# Optional OWNER is added to each new account's owner permission as a
# backup recovery path (it does not replace the generated key there).
CREATOR=${6:-}
OWNER=${7:-}

echo "Network: $NETWORK"
echo "Accounts: $AGENT_CORE, $AGENT_FEED, $AGENT_VALID, $AGENT_ESCROW"
echo "Creator: ${CREATOR:-<none — required only if an account is missing>}"
echo ""

# Check if proton CLI is installed
if ! command -v proton &> /dev/null; then
    echo -e "${RED}Error: proton CLI not found. Install with: npm install -g @proton/cli${NC}"
    exit 1
fi

# Set network
echo -e "${YELLOW}Setting network to ${NETWORK}...${NC}"
proton chain:set $NETWORK

# Create accounts
echo -e "${YELLOW}Creating contract accounts...${NC}"

for acc in $AGENT_CORE $AGENT_FEED $AGENT_VALID $AGENT_ESCROW; do
    if proton account:get $acc &> /dev/null; then
        echo -e "${GREEN}✓ Account $acc already exists${NC}"
    else
        if [ -z "$CREATOR" ]; then
            echo -e "${RED}Error: account $acc does not exist and no creator was given.${NC}"
            echo -e "${RED}Usage: $0 <network> <core> <feed> <valid> <escrow> <creator> [owner]${NC}"
            echo -e "${RED}The creator is an existing funded account that signs the creation and buys the RAM.${NC}"
            exit 1
        fi
        echo -e "${YELLOW}Creating account $acc (creator: $CREATOR)...${NC}"
        # account:create-funded is the scriptable path. `proton account:create`
        # (no -funded) is the email + 6-digit verification-code flow and cannot
        # be driven from a script.
        if [ -n "$OWNER" ]; then
            proton account:create-funded $acc --creator "$CREATOR" --owner "$OWNER"
        else
            proton account:create-funded $acc --creator "$CREATOR"
        fi
        echo -e "${GREEN}✓ Account $acc created${NC}"
        echo -e "${YELLOW}  Note: --ram defaults to 3000 bytes. Contract accounts need more —${NC}"
        echo -e "${YELLOW}  pass --ram, or buy RAM before contract:set.${NC}"
    fi
done

echo ""
echo -e "${GREEN}=== Account Setup Complete ===${NC}"
echo ""
echo "Use './scripts/deploy-testnet.sh' to deploy contracts"
