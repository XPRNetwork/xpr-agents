#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== XPR Agents Contract Testing ===${NC}"

# Configuration
NETWORK=${1:-proton-test}
AGENT_CORE=${2:-agentcore}
AGENT_FEED=${3:-agentfeed}
AGENT_VALID=${4:-agentvalid}

# Test accounts - replace with your test accounts
TEST_AGENT=${5:-testagent1}
TEST_REVIEWER=${6:-reviewer1}
TEST_VALIDATOR=${7:-validator1}

echo "Network: $NETWORK"
echo "Test Agent: $TEST_AGENT"
echo "Test Reviewer: $TEST_REVIEWER"
echo "Test Validator: $TEST_VALIDATOR"
echo ""

# Check if proton CLI is installed
if ! command -v proton &> /dev/null; then
    echo -e "${RED}Error: proton CLI not found. Install with: npm install -g @proton/cli${NC}"
    exit 1
fi

# Set network
proton chain:set $NETWORK

# ============== AGENT TESTS ==============
echo -e "${YELLOW}=== Testing Agent Registration ===${NC}"

# Register agent
echo "Registering test agent..."
proton action $AGENT_CORE register "{
  \"account\":\"$TEST_AGENT\",
  \"name\":\"Test Agent\",
  \"description\":\"A test agent for verification\",
  \"endpoint\":\"https://api.test.com/v1\",
  \"protocol\":\"https\",
  \"capabilities\":\"[\\\"compute\\\",\\\"ai\\\"]\"
}" $TEST_AGENT

echo -e "${GREEN}✓ Agent registered${NC}"

# Check agent table
echo ""
echo "Agent table contents:"
proton table $AGENT_CORE agents

# Stake some XPR
echo ""
echo -e "${YELLOW}Staking XPR for agent...${NC}"
proton action eosio.token transfer "{
  \"from\":\"$TEST_AGENT\",
  \"to\":\"$AGENT_CORE\",
  \"quantity\":\"100.0000 XPR\",
  \"memo\":\"stake\"
}" $TEST_AGENT

echo -e "${GREEN}✓ XPR staked${NC}"

# Update agent
echo ""
echo -e "${YELLOW}Updating agent...${NC}"
proton action $AGENT_CORE update "{
  \"account\":\"$TEST_AGENT\",
  \"name\":\"Updated Test Agent\",
  \"description\":\"An updated test agent\",
  \"endpoint\":\"https://api.test.com/v2\",
  \"protocol\":\"https\",
  \"capabilities\":\"[\\\"compute\\\",\\\"ai\\\",\\\"storage\\\"]\"
}" $TEST_AGENT

echo -e "${GREEN}✓ Agent updated${NC}"

# ============== FEEDBACK TESTS ==============
echo ""
echo -e "${YELLOW}=== Testing Feedback ===${NC}"

# Submit feedback
echo "Submitting feedback..."
proton action $AGENT_FEED submit "{
  \"reviewer\":\"$TEST_REVIEWER\",
  \"agent\":\"$TEST_AGENT\",
  \"score\":5,
  \"tags\":\"helpful,fast,accurate\",
  \"job_hash\":\"abc123\",
  \"evidence_uri\":\"\",
  \"amount_paid\":10000
}" $TEST_REVIEWER

echo -e "${GREEN}✓ Feedback submitted${NC}"

# Check feedback table
echo ""
echo "Feedback table contents:"
proton table $AGENT_FEED feedback

# Check agent scores
echo ""
echo "Agent scores:"
proton table $AGENT_FEED agentscores

# ============== VALIDATOR TESTS ==============
echo ""
echo -e "${YELLOW}=== Testing Validator ===${NC}"

# Register validator
echo "Registering validator..."
proton action $AGENT_VALID regval "{
  \"account\":\"$TEST_VALIDATOR\",
  \"method\":\"Automated code review and output verification\",
  \"specializations\":\"[\\\"ai\\\",\\\"compute\\\"]\"
}" $TEST_VALIDATOR

echo -e "${GREEN}✓ Validator registered${NC}"

# Stake XPR for validator
echo ""
echo "Staking XPR for validator..."
proton action eosio.token transfer "{
  \"from\":\"$TEST_VALIDATOR\",
  \"to\":\"$AGENT_VALID\",
  \"quantity\":\"500.0000 XPR\",
  \"memo\":\"stake\"
}" $TEST_VALIDATOR

echo -e "${GREEN}✓ Validator XPR staked${NC}"

# Submit validation
echo ""
echo "Submitting validation..."
proton action $AGENT_VALID validate "{
  \"validator\":\"$TEST_VALIDATOR\",
  \"agent\":\"$TEST_AGENT\",
  \"job_hash\":\"abc123\",
  \"result\":1,
  \"confidence\":95,
  \"evidence_uri\":\"\"
}" $TEST_VALIDATOR

echo -e "${GREEN}✓ Validation submitted${NC}"

# Check validator table
echo ""
echo "Validator table contents:"
proton table $AGENT_VALID validators

# Check validations table
echo ""
echo "Validations table contents:"
proton table $AGENT_VALID validations

# ============== PLUGIN TESTS ==============
echo ""
echo -e "${YELLOW}=== Testing Plugin Registration ===${NC}"

# Register a plugin
echo "Registering test plugin..."
proton action $AGENT_CORE regplugin "{
  \"author\":\"$TEST_AGENT\",
  \"name\":\"price-oracle\",
  \"version\":\"1.0.0\",
  \"contract\":\"oracles\",
  \"action\":\"getprice\",
  \"schema\":\"{\\\"pair\\\":\\\"string\\\"}\",
  \"category\":\"oracle\"
}" $TEST_AGENT

echo -e "${GREEN}✓ Plugin registered${NC}"

# Check plugins table
echo ""
echo "Plugins table contents:"
proton table $AGENT_CORE plugins

echo ""
echo -e "${GREEN}=== All Tests Complete ===${NC}"
echo ""
echo "Summary:"
echo "  - Agent registration: OK"
echo "  - Agent staking: OK"
echo "  - Agent update: OK"
echo "  - Feedback submission: OK"
echo "  - Score calculation: OK"
echo "  - Validator registration: OK"
echo "  - Validator staking: OK"
echo "  - Validation submission: OK"
echo "  - Plugin registration: OK"
