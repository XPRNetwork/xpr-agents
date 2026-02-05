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

# Default values
MIN_AGENT_STAKE=${5:-1000000}      # 100.0000 XPR
MIN_VALIDATOR_STAKE=${6:-5000000}  # 500.0000 XPR
UNSTAKE_DELAY=${7:-604800}         # 7 days

echo "Network: $NETWORK"
echo "Agent Core: $AGENT_CORE"
echo "Agent Feed: $AGENT_FEED"
echo "Agent Valid: $AGENT_VALID"
echo ""
echo "Min Agent Stake: $MIN_AGENT_STAKE"
echo "Min Validator Stake: $MIN_VALIDATOR_STAKE"
echo "Unstake Delay: $UNSTAKE_DELAY seconds"
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
proton action $AGENT_CORE init "{\"owner\":\"$AGENT_CORE\",\"min_stake\":$MIN_AGENT_STAKE,\"unstake_delay\":$UNSTAKE_DELAY}" $AGENT_CORE
echo -e "${GREEN}✓ agentcore initialized${NC}"

# Initialize agentfeed
echo -e "${YELLOW}Initializing agentfeed...${NC}"
proton action $AGENT_FEED init "{\"owner\":\"$AGENT_FEED\",\"core_contract\":\"$AGENT_CORE\"}" $AGENT_FEED
echo -e "${GREEN}✓ agentfeed initialized${NC}"

# Initialize agentvalid
echo -e "${YELLOW}Initializing agentvalid...${NC}"
proton action $AGENT_VALID init "{\"owner\":\"$AGENT_VALID\",\"core_contract\":\"$AGENT_CORE\",\"min_stake\":$MIN_VALIDATOR_STAKE}" $AGENT_VALID
echo -e "${GREEN}✓ agentvalid initialized${NC}"

echo ""
echo -e "${GREEN}=== Contract Initialization Complete ===${NC}"
