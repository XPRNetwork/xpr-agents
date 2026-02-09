#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== XPR Agents Contract Initialization ===${NC}"

# Configuration
NETWORK=${1:-proton-test}
AGENT_CORE=${2:-agentcore}
AGENT_FEED=${3:-agentfeed}
AGENT_VALID=${4:-agentvalid}
AGENT_ESCROW=${5:-agentescrow}

# Default values
MIN_AGENT_STAKE=${6:-1000000}      # 100.0000 XPR
MIN_VALIDATOR_STAKE=${7:-5000000}  # 500.0000 XPR
CLAIM_FEE=${8:-100000}             # 10.0000 XPR
PLATFORM_FEE=${9:-100}             # 1% (basis points)

echo "Network: $NETWORK"
echo "Agent Core: $AGENT_CORE"
echo "Agent Feed: $AGENT_FEED"
echo "Agent Valid: $AGENT_VALID"
echo "Agent Escrow: $AGENT_ESCROW"
echo ""
echo "Min Agent Stake: $MIN_AGENT_STAKE ($(echo "scale=4; $MIN_AGENT_STAKE/10000" | bc) XPR)"
echo "Min Validator Stake: $MIN_VALIDATOR_STAKE ($(echo "scale=4; $MIN_VALIDATOR_STAKE/10000" | bc) XPR)"
echo "Claim Fee: $CLAIM_FEE ($(echo "scale=4; $CLAIM_FEE/10000" | bc) XPR)"
echo "Platform Fee: $PLATFORM_FEE basis points"
echo ""

# Check if proton CLI is installed
if ! command -v proton &> /dev/null; then
    echo -e "${RED}Error: proton CLI not found. Install with: npm install -g @proton/cli${NC}"
    exit 1
fi

# Set network
echo -e "${YELLOW}Setting network to ${NETWORK}...${NC}"
proton chain:set $NETWORK

# Initialize agentcore
echo -e "${YELLOW}Initializing agentcore...${NC}"
proton action $AGENT_CORE init "{\"owner\":\"$AGENT_CORE\",\"min_stake\":$MIN_AGENT_STAKE,\"claim_fee\":$CLAIM_FEE,\"feed_contract\":\"$AGENT_FEED\",\"valid_contract\":\"$AGENT_VALID\",\"escrow_contract\":\"$AGENT_ESCROW\"}" $AGENT_CORE
echo -e "${GREEN}✓ agentcore initialized${NC}"

# Initialize agentfeed
echo -e "${YELLOW}Initializing agentfeed...${NC}"
proton action $AGENT_FEED init "{\"owner\":\"$AGENT_FEED\",\"core_contract\":\"$AGENT_CORE\"}" $AGENT_FEED
echo -e "${GREEN}✓ agentfeed initialized${NC}"

# Initialize agentvalid
echo -e "${YELLOW}Initializing agentvalid...${NC}"
proton action $AGENT_VALID init "{\"owner\":\"$AGENT_VALID\",\"core_contract\":\"$AGENT_CORE\",\"min_stake\":$MIN_VALIDATOR_STAKE}" $AGENT_VALID
echo -e "${GREEN}✓ agentvalid initialized${NC}"

# Initialize agentescrow
echo -e "${YELLOW}Initializing agentescrow...${NC}"
proton action $AGENT_ESCROW init "{\"owner\":\"$AGENT_ESCROW\",\"core_contract\":\"$AGENT_CORE\",\"feed_contract\":\"$AGENT_FEED\",\"platform_fee\":$PLATFORM_FEE}" $AGENT_ESCROW
echo -e "${GREEN}✓ agentescrow initialized${NC}"

echo ""
echo -e "${GREEN}=== Contract Initialization Complete ===${NC}"
