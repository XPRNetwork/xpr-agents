#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${RED}=== XPR Agents MAINNET Deployment ===${NC}"
echo ""
echo -e "${YELLOW}WARNING: This will deploy to MAINNET. Proceed with caution!${NC}"
echo ""

# Confirmation
read -p "Are you sure you want to deploy to mainnet? (type 'yes' to confirm): " confirm
if [ "$confirm" != "yes" ]; then
    echo "Deployment cancelled."
    exit 0
fi

# Configuration
NETWORK="proton"
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

# Step 2: Verify accounts exist
echo -e "${YELLOW}Verifying contract accounts...${NC}"

for acc in $AGENT_CORE $AGENT_FEED $AGENT_VALID $AGENT_ESCROW; do
    if proton account:get $acc &> /dev/null; then
        echo -e "${GREEN}✓ Account $acc exists${NC}"
    else
        echo -e "${RED}Error: Account $acc does not exist. Create it first.${NC}"
        exit 1
    fi
done

# Step 3: Deploy contracts
echo -e "${YELLOW}Deploying contracts...${NC}"

read -p "Deploy agentcore? (y/n): " deploy_core
if [ "$deploy_core" == "y" ]; then
    proton contract:set $AGENT_CORE ./contracts/agentcore/assembly/target
    echo -e "${GREEN}✓ agentcore deployed${NC}"
fi

read -p "Deploy agentfeed? (y/n): " deploy_feed
if [ "$deploy_feed" == "y" ]; then
    proton contract:set $AGENT_FEED ./contracts/agentfeed/assembly/target
    echo -e "${GREEN}✓ agentfeed deployed${NC}"
fi

read -p "Deploy agentvalid? (y/n): " deploy_valid
if [ "$deploy_valid" == "y" ]; then
    proton contract:set $AGENT_VALID ./contracts/agentvalid/assembly/target
    echo -e "${GREEN}✓ agentvalid deployed${NC}"
fi

read -p "Deploy agentescrow? (y/n): " deploy_escrow
if [ "$deploy_escrow" == "y" ]; then
    proton contract:set $AGENT_ESCROW ./contracts/agentescrow/assembly/target
    echo -e "${GREEN}✓ agentescrow deployed${NC}"
fi

# Step 4: Enable inline actions (if needed)
read -p "Enable inline actions? (y/n): " enable_inline
if [ "$enable_inline" == "y" ]; then
    for acc in $AGENT_CORE $AGENT_FEED $AGENT_VALID $AGENT_ESCROW; do
        proton contract:enableinline $acc
        echo -e "${GREEN}✓ Inline actions enabled for $acc${NC}"
    done
fi

# Step 5: Initialize contracts (if first deployment)
read -p "Initialize contracts? (only for first deployment) (y/n): " init_contracts
if [ "$init_contracts" == "y" ]; then
    # Initialize agentcore
    # min_stake: 1000.0000 XPR = 10000000
    # Requires: feed_contract, valid_contract, escrow_contract
    proton action $AGENT_CORE init "{\"owner\":\"$AGENT_CORE\",\"min_stake\":10000000,\"feed_contract\":\"$AGENT_FEED\",\"valid_contract\":\"$AGENT_VALID\",\"escrow_contract\":\"$AGENT_ESCROW\"}" $AGENT_CORE
    echo -e "${GREEN}✓ agentcore initialized${NC}"

    # Initialize agentfeed
    proton action $AGENT_FEED init "{\"owner\":\"$AGENT_FEED\",\"core_contract\":\"$AGENT_CORE\"}" $AGENT_FEED
    echo -e "${GREEN}✓ agentfeed initialized${NC}"

    # Initialize agentvalid
    # min_stake: 5000.0000 XPR = 50000000
    proton action $AGENT_VALID init "{\"owner\":\"$AGENT_VALID\",\"core_contract\":\"$AGENT_CORE\",\"min_stake\":50000000}" $AGENT_VALID
    echo -e "${GREEN}✓ agentvalid initialized${NC}"

    # Initialize agentescrow
    # platform_fee: 100 = 1%
    proton action $AGENT_ESCROW init "{\"owner\":\"$AGENT_ESCROW\",\"core_contract\":\"$AGENT_CORE\",\"feed_contract\":\"$AGENT_FEED\",\"platform_fee\":100}" $AGENT_ESCROW
    echo -e "${GREEN}✓ agentescrow initialized${NC}"
fi

echo ""
echo -e "${GREEN}=== Mainnet Deployment Complete ===${NC}"
echo ""
echo "Contract Accounts:"
echo "  - Agent Core: $AGENT_CORE"
echo "  - Agent Feed: $AGENT_FEED"
echo "  - Agent Valid: $AGENT_VALID"
echo "  - Agent Escrow: $AGENT_ESCROW"
