#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== XPR Agents Testnet Deployment ===${NC}"

# Configuration
NETWORK="proton-test"
AGENT_CORE="agentcore"
AGENT_FEED="agentfeed"
AGENT_VALID="agentvalid"
AGENT_ESCROW="agentescrow"

# Check if proton CLI is installed
if ! command -v proton &> /dev/null; then
    echo -e "${RED}Error: proton CLI not found. Install with: npm install -g @proton/cli${NC}"
    exit 1
fi

# Set network
echo -e "${YELLOW}Setting network to ${NETWORK}...${NC}"
proton chain:set $NETWORK

# Step 1: Build contracts
echo -e "${YELLOW}Building contracts...${NC}"

cd "$(dirname "$0")/../contracts/agentcore"
npm install
npm run build
echo -e "${GREEN}✓ agentcore built${NC}"

cd "../agentfeed"
npm install
npm run build
echo -e "${GREEN}✓ agentfeed built${NC}"

cd "../agentvalid"
npm install
npm run build
echo -e "${GREEN}✓ agentvalid built${NC}"

cd "../agentescrow"
npm install
npm run build
echo -e "${GREEN}✓ agentescrow built${NC}"

cd "$(dirname "$0")/.."

# Step 2: Create accounts (if they don't exist)
echo -e "${YELLOW}Creating contract accounts (if needed)...${NC}"

for acc in $AGENT_CORE $AGENT_FEED $AGENT_VALID $AGENT_ESCROW; do
    if proton account:get $acc &> /dev/null; then
        echo -e "${GREEN}✓ Account $acc already exists${NC}"
    else
        echo -e "${YELLOW}Creating account $acc...${NC}"
        proton account:create $acc
        echo -e "${GREEN}✓ Account $acc created${NC}"
    fi
done

# Step 3: Deploy contracts
echo -e "${YELLOW}Deploying contracts...${NC}"

proton contract:set $AGENT_CORE ./contracts/agentcore/assembly/target
echo -e "${GREEN}✓ agentcore deployed${NC}"

proton contract:set $AGENT_FEED ./contracts/agentfeed/assembly/target
echo -e "${GREEN}✓ agentfeed deployed${NC}"

proton contract:set $AGENT_VALID ./contracts/agentvalid/assembly/target
echo -e "${GREEN}✓ agentvalid deployed${NC}"

proton contract:set $AGENT_ESCROW ./contracts/agentescrow/assembly/target
echo -e "${GREEN}✓ agentescrow deployed${NC}"

# Step 4: Enable inline actions
echo -e "${YELLOW}Enabling inline actions...${NC}"

for acc in $AGENT_CORE $AGENT_FEED $AGENT_VALID $AGENT_ESCROW; do
    proton contract:enableinline $acc
    echo -e "${GREEN}✓ Inline actions enabled for $acc${NC}"
done

# Step 5: Initialize contracts
echo -e "${YELLOW}Initializing contracts...${NC}"

# Initialize agentcore
# min_stake: 100.0000 XPR = 1000000
# unstake_delay: 7 days = 604800 seconds
proton action $AGENT_CORE init "{\"owner\":\"$AGENT_CORE\",\"min_stake\":1000000,\"unstake_delay\":604800}" $AGENT_CORE
echo -e "${GREEN}✓ agentcore initialized${NC}"

# Initialize agentfeed
proton action $AGENT_FEED init "{\"owner\":\"$AGENT_FEED\",\"core_contract\":\"$AGENT_CORE\"}" $AGENT_FEED
echo -e "${GREEN}✓ agentfeed initialized${NC}"

# Initialize agentvalid
# min_stake: 500.0000 XPR = 5000000
proton action $AGENT_VALID init "{\"owner\":\"$AGENT_VALID\",\"core_contract\":\"$AGENT_CORE\",\"min_stake\":5000000}" $AGENT_VALID
echo -e "${GREEN}✓ agentvalid initialized${NC}"

# Initialize agentescrow
# platform_fee: 1% = 100 basis points
proton action $AGENT_ESCROW init "{\"owner\":\"$AGENT_ESCROW\",\"core_contract\":\"$AGENT_CORE\",\"feed_contract\":\"$AGENT_FEED\",\"platform_fee\":100}" $AGENT_ESCROW
echo -e "${GREEN}✓ agentescrow initialized${NC}"

echo ""
echo -e "${GREEN}=== Deployment Complete ===${NC}"
echo ""
echo "Contract Accounts:"
echo "  - Agent Core: $AGENT_CORE"
echo "  - Agent Feed: $AGENT_FEED"
echo "  - Agent Valid: $AGENT_VALID"
echo "  - Agent Escrow: $AGENT_ESCROW"
echo ""
echo "Run './scripts/test-actions.sh' to test the contracts"
