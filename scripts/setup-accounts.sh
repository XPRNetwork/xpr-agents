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

echo "Network: $NETWORK"
echo "Accounts: $AGENT_CORE, $AGENT_FEED, $AGENT_VALID, $AGENT_ESCROW"
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
        echo -e "${YELLOW}Creating account $acc...${NC}"
        proton account:create $acc
        echo -e "${GREEN}✓ Account $acc created${NC}"
    fi
done

echo ""
echo -e "${GREEN}=== Account Setup Complete ===${NC}"
echo ""
echo "Use './scripts/deploy-testnet.sh' to deploy contracts"
