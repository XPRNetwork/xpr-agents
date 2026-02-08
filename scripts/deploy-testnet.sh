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
CREATOR="paul123"
OWNER="protonnz"
AGENT_CORE="agentcore"
AGENT_FEED="agentfeed"
AGENT_VALID="agentvalid"
AGENT_ESCROW="agentescrow"

# Local proton-cli with account:create-funded support
PROTON_CLI="/Users/paulgrey/Documents/projects/proton-cli/bin/run"

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

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR/contracts/agentcore"
npm install
npm run build
echo -e "${GREEN}✓ agentcore built${NC}"

cd "$PROJECT_DIR/contracts/agentfeed"
npm install
npm run build
echo -e "${GREEN}✓ agentfeed built${NC}"

cd "$PROJECT_DIR/contracts/agentvalid"
npm install
npm run build
echo -e "${GREEN}✓ agentvalid built${NC}"

cd "$PROJECT_DIR/contracts/agentescrow"
npm install
npm run build
echo -e "${GREEN}✓ agentescrow built${NC}"

cd "$PROJECT_DIR"

# Step 2: Create accounts (if they don't exist)
echo -e "${YELLOW}Creating contract accounts (if needed)...${NC}"

for acc in $AGENT_CORE $AGENT_FEED $AGENT_VALID $AGENT_ESCROW; do
    if curl -sf https://tn1.protonnz.com/v1/chain/get_account -d "{\"account_name\":\"$acc\"}" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Account $acc already exists${NC}"
    else
        echo -e "${YELLOW}Creating account $acc (creator: $CREATOR, owner: $OWNER)...${NC}"
        "$PROTON_CLI" account:create-funded "$acc" --creator "$CREATOR" --owner "$OWNER"
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
# min_stake: 0 for testnet (getSystemStake returns XPR units, not smallest units)
# claim_fee: 10.0000 XPR = 100000 (in smallest units)
# Requires: feed_contract, valid_contract, escrow_contract
proton action $AGENT_CORE init "{\"owner\":\"$AGENT_CORE\",\"min_stake\":0,\"claim_fee\":100000,\"feed_contract\":\"$AGENT_FEED\",\"valid_contract\":\"$AGENT_VALID\",\"escrow_contract\":\"$AGENT_ESCROW\"}" $AGENT_CORE
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
echo "All accounts owned by: $OWNER (backup recovery)"
echo "Created by: $CREATOR"
echo ""
echo "Run './scripts/test-actions.sh' to test the contracts"
