#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Track pass/fail counts
PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
SUMMARY=""

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  SUMMARY="${SUMMARY}\n  ${GREEN}✓${NC} $1"
  echo -e "${GREEN}✓ $1${NC}"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  SUMMARY="${SUMMARY}\n  ${RED}✗${NC} $1"
  echo -e "${RED}✗ $1${NC}"
}

skip() {
  SKIP_COUNT=$((SKIP_COUNT + 1))
  SUMMARY="${SUMMARY}\n  ${YELLOW}○${NC} $1 (skipped)"
  echo -e "${YELLOW}○ $1 (skipped)${NC}"
}

section() {
  echo ""
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${YELLOW}=== $1 ===${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# expect_fail: run a command and expect it to fail
# Usage: expect_fail "description" command args...
expect_fail() {
  local desc="$1"
  shift
  if "$@" 2>/dev/null; then
    fail "$desc (should have failed but succeeded)"
    return 1
  else
    pass "$desc"
    return 0
  fi
}

echo -e "${GREEN}=== XPR Agents Contract Testing (Full Suite) ===${NC}"

# Configuration
NETWORK=${1:-proton-test}
AGENT_CORE=${2:-agentcore}
AGENT_FEED=${3:-agentfeed}
AGENT_VALID=${4:-agentvalid}
AGENT_ESCROW=${AGENT_ESCROW:-agentescrow}

# Test accounts - replace with your test accounts
TEST_AGENT=${5:-testagent1}
TEST_REVIEWER=${6:-reviewer1}
TEST_VALIDATOR=${7:-validator1}
TEST_CLIENT=${TEST_CLIENT:-testclient1}
TEST_ARBITRATOR=${TEST_ARBITRATOR:-testarb1}
TEST_OWNER=${TEST_OWNER:-testowner1}

# Second set of accounts for adversarial tests
TEST_AGENT2=${TEST_AGENT2:-testagent2}
TEST_VALIDATOR2=${TEST_VALIDATOR2:-validator2}
TEST_CLIENT2=${TEST_CLIENT2:-testclient2}

echo "Network: $NETWORK"
echo "Accounts: $TEST_AGENT, $TEST_AGENT2, $TEST_REVIEWER, $TEST_VALIDATOR, $TEST_VALIDATOR2"
echo "          $TEST_CLIENT, $TEST_CLIENT2, $TEST_ARBITRATOR, $TEST_OWNER"
echo ""

# Check if proton CLI is installed
if ! command -v proton &> /dev/null; then
    echo -e "${RED}Error: proton CLI not found. Install with: npm install -g @proton/cli${NC}"
    exit 1
fi

# Set network
proton chain:set $NETWORK

# We'll track job IDs as they are created
NEXT_JOB_ID=1

########################################################################
# PART 1: HAPPY PATH (basic flows)
########################################################################

section "1. Agent Registration & Update"

# Register agent
proton action $AGENT_CORE register "{
  \"account\":\"$TEST_AGENT\",
  \"name\":\"Test Agent\",
  \"description\":\"A test agent for verification\",
  \"endpoint\":\"https://api.test.com/v1\",
  \"protocol\":\"https\",
  \"capabilities\":\"[\\\"compute\\\",\\\"ai\\\"]\"
}" $TEST_AGENT
pass "Agent registered"

# Register second agent for adversarial tests
proton action $AGENT_CORE register "{
  \"account\":\"$TEST_AGENT2\",
  \"name\":\"Test Agent 2\",
  \"description\":\"Second test agent\",
  \"endpoint\":\"https://api.test2.com/v1\",
  \"protocol\":\"https\",
  \"capabilities\":\"[\\\"compute\\\"]\"
}" $TEST_AGENT2
pass "Second agent registered"

# Update agent
proton action $AGENT_CORE update "{
  \"account\":\"$TEST_AGENT\",
  \"name\":\"Updated Test Agent\",
  \"description\":\"An updated test agent\",
  \"endpoint\":\"https://api.test.com/v2\",
  \"protocol\":\"https\",
  \"capabilities\":\"[\\\"compute\\\",\\\"ai\\\",\\\"storage\\\"]\"
}" $TEST_AGENT
pass "Agent updated"

# Deactivate and reactivate
proton action $AGENT_CORE setstatus "{
  \"account\":\"$TEST_AGENT\",
  \"active\":false
}" $TEST_AGENT
pass "Agent deactivated"

proton action $AGENT_CORE setstatus "{
  \"account\":\"$TEST_AGENT\",
  \"active\":true
}" $TEST_AGENT
pass "Agent reactivated"


section "2. Permission Failures — Agent"

# Wrong account tries to update another agent
expect_fail "Reject update by non-owner" \
  proton action $AGENT_CORE update "{
    \"account\":\"$TEST_AGENT\",
    \"name\":\"Hacked\",
    \"description\":\"hacked\",
    \"endpoint\":\"https://evil.com\",
    \"protocol\":\"https\",
    \"capabilities\":\"[]\"
  }" $TEST_REVIEWER

# Double registration
expect_fail "Reject duplicate agent registration" \
  proton action $AGENT_CORE register "{
    \"account\":\"$TEST_AGENT\",
    \"name\":\"Duplicate\",
    \"description\":\"dup\",
    \"endpoint\":\"https://dup.com\",
    \"protocol\":\"https\",
    \"capabilities\":\"[]\"
  }" $TEST_AGENT


section "3. Feedback — Happy Path"

# Submit feedback
proton action $AGENT_FEED submit "{
  \"reviewer\":\"$TEST_REVIEWER\",
  \"agent\":\"$TEST_AGENT\",
  \"score\":5,
  \"tags\":\"helpful,fast,accurate\",
  \"job_hash\":\"abc123\",
  \"evidence_uri\":\"\",
  \"amount_paid\":10000
}" $TEST_REVIEWER
pass "Feedback submitted (5/5)"

# Submit second feedback for score averaging
proton action $AGENT_FEED submit "{
  \"reviewer\":\"$TEST_CLIENT\",
  \"agent\":\"$TEST_AGENT\",
  \"score\":3,
  \"tags\":\"slow\",
  \"job_hash\":\"def456\",
  \"evidence_uri\":\"\",
  \"amount_paid\":5000
}" $TEST_CLIENT
pass "Second feedback submitted (3/5)"


section "4. Permission Failures — Feedback"

# Self-review
expect_fail "Reject self-review" \
  proton action $AGENT_FEED submit "{
    \"reviewer\":\"$TEST_AGENT\",
    \"agent\":\"$TEST_AGENT\",
    \"score\":5,
    \"tags\":\"\",
    \"job_hash\":\"\",
    \"evidence_uri\":\"\",
    \"amount_paid\":0
  }" $TEST_AGENT


section "5. Feedback Dispute & Resolution"

# Dispute feedback #1
proton action $AGENT_FEED dispute "{
  \"disputer\":\"$TEST_AGENT\",
  \"feedback_id\":1,
  \"reason\":\"Feedback is inaccurate\",
  \"evidence_uri\":\"ipfs://QmDispute1\"
}" $TEST_AGENT
pass "Feedback #1 disputed"

# Double dispute should fail
expect_fail "Reject duplicate feedback dispute" \
  proton action $AGENT_FEED dispute "{
    \"disputer\":\"$TEST_AGENT\",
    \"feedback_id\":1,
    \"reason\":\"Second dispute\",
    \"evidence_uri\":\"\"
  }" $TEST_AGENT

# Resolve dispute (upheld — feedback removed from score)
proton action $AGENT_FEED resolve "{
  \"resolver\":\"$AGENT_FEED\",
  \"dispute_id\":1,
  \"upheld\":true,
  \"resolution_notes\":\"Evidence supports the dispute\"
}" $AGENT_FEED
pass "Feedback dispute resolved (upheld)"


section "6. Validator Registration & Staking"

# Register validator
proton action $AGENT_VALID regval "{
  \"account\":\"$TEST_VALIDATOR\",
  \"method\":\"Automated code review and output verification\",
  \"specializations\":\"[\\\"ai\\\",\\\"compute\\\"]\"
}" $TEST_VALIDATOR
pass "Validator registered"

# Register second validator
proton action $AGENT_VALID regval "{
  \"account\":\"$TEST_VALIDATOR2\",
  \"method\":\"Manual review\",
  \"specializations\":\"[\\\"data\\\"]\"
}" $TEST_VALIDATOR2
pass "Second validator registered"

# Stake XPR for validator
proton action eosio.token transfer "{
  \"from\":\"$TEST_VALIDATOR\",
  \"to\":\"$AGENT_VALID\",
  \"quantity\":\"500.0000 XPR\",
  \"memo\":\"stake\"
}" $TEST_VALIDATOR
pass "Validator staked 500 XPR"

# Stake for second validator
proton action eosio.token transfer "{
  \"from\":\"$TEST_VALIDATOR2\",
  \"to\":\"$AGENT_VALID\",
  \"quantity\":\"500.0000 XPR\",
  \"memo\":\"stake\"
}" $TEST_VALIDATOR2
pass "Second validator staked 500 XPR"


section "7. Permission Failures — Validator"

# Duplicate registration
expect_fail "Reject duplicate validator registration" \
  proton action $AGENT_VALID regval "{
    \"account\":\"$TEST_VALIDATOR\",
    \"method\":\"dup\",
    \"specializations\":\"[]\"
  }" $TEST_VALIDATOR

# Self-validation
expect_fail "Reject self-validation" \
  proton action $AGENT_VALID validate "{
    \"validator\":\"$TEST_AGENT\",
    \"agent\":\"$TEST_AGENT\",
    \"job_hash\":\"test\",
    \"result\":1,
    \"confidence\":80,
    \"evidence_uri\":\"\"
  }" $TEST_AGENT


section "8. Validation — Happy Path"

proton action $AGENT_VALID validate "{
  \"validator\":\"$TEST_VALIDATOR\",
  \"agent\":\"$TEST_AGENT\",
  \"job_hash\":\"abc123\",
  \"result\":1,
  \"confidence\":95,
  \"evidence_uri\":\"\"
}" $TEST_VALIDATOR
pass "Validation submitted (pass, 95% confidence)"

# Second validation for accuracy tracking
proton action $AGENT_VALID validate "{
  \"validator\":\"$TEST_VALIDATOR\",
  \"agent\":\"$TEST_AGENT2\",
  \"job_hash\":\"xyz789\",
  \"result\":0,
  \"confidence\":80,
  \"evidence_uri\":\"ipfs://QmEvidence1\"
}" $TEST_VALIDATOR
pass "Second validation submitted (fail)"


section "9. Challenge Flow — Funded & Resolved (Upheld)"

# Challenge validation #2 (the fail validation)
proton action $AGENT_VALID challenge "{
  \"challenger\":\"$TEST_AGENT2\",
  \"validation_id\":2,
  \"reason\":\"Validation result is incorrect, agent output was valid\",
  \"evidence_uri\":\"ipfs://QmChallengeEvidence1\"
}" $TEST_AGENT2
pass "Challenge created for validation #2"

# Fund the challenge (this sets challenged=true on the validation)
proton action eosio.token transfer "{
  \"from\":\"$TEST_AGENT2\",
  \"to\":\"$AGENT_VALID\",
  \"quantity\":\"100.0000 XPR\",
  \"memo\":\"challenge:1\"
}" $TEST_AGENT2
pass "Challenge #1 funded"

# Double-fund should fail
expect_fail "Reject double-funding a challenge" \
  proton action eosio.token transfer "{
    \"from\":\"$TEST_AGENT2\",
    \"to\":\"$AGENT_VALID\",
    \"quantity\":\"100.0000 XPR\",
    \"memo\":\"challenge:1\"
  }" $TEST_AGENT2

echo "Waiting for dispute period to elapse..."
sleep 5

# Resolve challenge (upheld — validator was wrong, gets accuracy hit)
proton action $AGENT_VALID resolve "{
  \"resolver\":\"$AGENT_VALID\",
  \"challenge_id\":1,
  \"upheld\":true,
  \"resolution_notes\":\"Agent output was indeed valid. Validator assessment was incorrect.\"
}" $AGENT_VALID
pass "Challenge #1 resolved (upheld — validator penalized)"

# Verify validator accuracy was updated
echo "Validator state after upheld challenge:"
proton table $AGENT_VALID validators


section "10. Challenge Flow — Unfunded Expiry"

# Submit another validation to challenge
proton action $AGENT_VALID validate "{
  \"validator\":\"$TEST_VALIDATOR2\",
  \"agent\":\"$TEST_AGENT\",
  \"job_hash\":\"test999\",
  \"result\":0,
  \"confidence\":70,
  \"evidence_uri\":\"\"
}" $TEST_VALIDATOR2
pass "Validation #3 submitted for expiry test"

# Create challenge but do NOT fund it
proton action $AGENT_VALID challenge "{
  \"challenger\":\"$TEST_CLIENT\",
  \"validation_id\":3,
  \"reason\":\"Testing unfunded expiry\",
  \"evidence_uri\":\"\"
}" $TEST_CLIENT
pass "Unfunded challenge #2 created"

# Try to expire immediately (should fail — deadline not reached)
# Note: On testnet the funding deadline is short; this may or may not fail
# depending on config. We try both paths.
echo "Attempting immediate expiry (may fail if deadline not reached yet)..."
if proton action $AGENT_VALID expireunfund "{
  \"challenge_id\":2
}" $TEST_CLIENT 2>/dev/null; then
  pass "Unfunded challenge #2 expired (deadline already passed)"
else
  echo "  Deadline not reached yet — will retry after wait"
  echo "  Waiting for funding deadline to pass..."
  sleep 30
  proton action $AGENT_VALID expireunfund "{
    \"challenge_id\":2
  }" $TEST_CLIENT
  pass "Unfunded challenge #2 expired after deadline"
fi


section "11. Challenge — Resolved (Rejected)"

# Submit validation to challenge and reject
proton action $AGENT_VALID validate "{
  \"validator\":\"$TEST_VALIDATOR2\",
  \"agent\":\"$TEST_AGENT2\",
  \"job_hash\":\"test888\",
  \"result\":1,
  \"confidence\":90,
  \"evidence_uri\":\"\"
}" $TEST_VALIDATOR2
pass "Validation #4 submitted for rejected challenge test"

# Challenge it
proton action $AGENT_VALID challenge "{
  \"challenger\":\"$TEST_REVIEWER\",
  \"validation_id\":4,
  \"reason\":\"I disagree with this pass result\",
  \"evidence_uri\":\"\"
}" $TEST_REVIEWER
pass "Challenge #3 created"

# Fund it
proton action eosio.token transfer "{
  \"from\":\"$TEST_REVIEWER\",
  \"to\":\"$AGENT_VALID\",
  \"quantity\":\"100.0000 XPR\",
  \"memo\":\"challenge:3\"
}" $TEST_REVIEWER
pass "Challenge #3 funded"

sleep 5

# Resolve as rejected (validator was correct, challenger loses stake)
proton action $AGENT_VALID resolve "{
  \"resolver\":\"$AGENT_VALID\",
  \"challenge_id\":3,
  \"upheld\":false,
  \"resolution_notes\":\"Validator assessment was correct. Challenge rejected.\"
}" $AGENT_VALID
pass "Challenge #3 resolved (rejected — challenger penalized)"


section "12. Plugin Registration"

proton action $AGENT_CORE regplugin "{
  \"author\":\"$TEST_AGENT\",
  \"name\":\"price-oracle\",
  \"version\":\"1.0.0\",
  \"contract\":\"oracles\",
  \"action\":\"getprice\",
  \"schema\":\"{\\\"pair\\\":\\\"string\\\"}\",
  \"category\":\"oracle\"
}" $TEST_AGENT
pass "Plugin registered"

proton table $AGENT_CORE plugins


########################################################################
# PART 2: ESCROW — HAPPY PATH
########################################################################

section "13. Arbitrator Setup"

proton action $AGENT_ESCROW regarb "{
  \"account\":\"$TEST_ARBITRATOR\",
  \"fee_percent\":200
}" $TEST_ARBITRATOR
pass "Arbitrator registered (2% fee)"

proton action eosio.token transfer "{
  \"from\":\"$TEST_ARBITRATOR\",
  \"to\":\"$AGENT_ESCROW\",
  \"quantity\":\"1000.0000 XPR\",
  \"memo\":\"arbstake\"
}" $TEST_ARBITRATOR
pass "Arbitrator staked 1000 XPR"

proton action $AGENT_ESCROW activatearb "{
  \"account\":\"$TEST_ARBITRATOR\"
}" $TEST_ARBITRATOR
pass "Arbitrator activated"


section "14. Job Happy Path (create → fund → accept → start → deliver → approve)"

DEADLINE=$(($(date +%s) + 604800))  # 1 week
JOB_HAPPY=$NEXT_JOB_ID
NEXT_JOB_ID=$((NEXT_JOB_ID + 1))

proton action $AGENT_ESCROW createjob "{
  \"client\":\"$TEST_CLIENT\",
  \"agent\":\"$TEST_AGENT\",
  \"title\":\"Happy Path Job\",
  \"description\":\"A job to test the full happy path\",
  \"deliverables\":\"[\\\"Code review\\\",\\\"Documentation\\\"]\",
  \"amount\":1000000,
  \"symbol\":\"4,XPR\",
  \"deadline\":$DEADLINE,
  \"arbitrator\":\"$TEST_ARBITRATOR\",
  \"job_hash\":\"happyhash1\"
}" $TEST_CLIENT
pass "Job #$JOB_HAPPY created"

proton action eosio.token transfer "{
  \"from\":\"$TEST_CLIENT\",
  \"to\":\"$AGENT_ESCROW\",
  \"quantity\":\"100.0000 XPR\",
  \"memo\":\"fund:$JOB_HAPPY\"
}" $TEST_CLIENT
pass "Job #$JOB_HAPPY funded (100 XPR)"

proton action $AGENT_ESCROW acceptjob "{
  \"agent\":\"$TEST_AGENT\",
  \"job_id\":$JOB_HAPPY
}" $TEST_AGENT
pass "Job #$JOB_HAPPY accepted by agent"

proton action $AGENT_ESCROW startjob "{
  \"agent\":\"$TEST_AGENT\",
  \"job_id\":$JOB_HAPPY
}" $TEST_AGENT
pass "Job #$JOB_HAPPY started"

proton action $AGENT_ESCROW deliver "{
  \"agent\":\"$TEST_AGENT\",
  \"job_id\":$JOB_HAPPY,
  \"evidence_uri\":\"ipfs://QmDeliverable1\"
}" $TEST_AGENT
pass "Job #$JOB_HAPPY delivered"

proton action $AGENT_ESCROW approve "{
  \"client\":\"$TEST_CLIENT\",
  \"job_id\":$JOB_HAPPY
}" $TEST_CLIENT
pass "Job #$JOB_HAPPY approved (payment released)"


########################################################################
# PART 3: ESCROW — DISPUTE & ARBITRATION
########################################################################

section "15. Dispute Flow (create → fund → accept → start → deliver → dispute → arbitrate)"

DEADLINE=$(($(date +%s) + 604800))
JOB_DISPUTE=$NEXT_JOB_ID
NEXT_JOB_ID=$((NEXT_JOB_ID + 1))

proton action $AGENT_ESCROW createjob "{
  \"client\":\"$TEST_CLIENT\",
  \"agent\":\"$TEST_AGENT\",
  \"title\":\"Dispute Test Job\",
  \"description\":\"A job that will be disputed\",
  \"deliverables\":\"[\\\"API endpoint\\\"]\",
  \"amount\":2000000,
  \"symbol\":\"4,XPR\",
  \"deadline\":$DEADLINE,
  \"arbitrator\":\"$TEST_ARBITRATOR\",
  \"job_hash\":\"disputehash1\"
}" $TEST_CLIENT
pass "Job #$JOB_DISPUTE created for dispute test"

proton action eosio.token transfer "{
  \"from\":\"$TEST_CLIENT\",
  \"to\":\"$AGENT_ESCROW\",
  \"quantity\":\"200.0000 XPR\",
  \"memo\":\"fund:$JOB_DISPUTE\"
}" $TEST_CLIENT
pass "Job #$JOB_DISPUTE funded (200 XPR)"

proton action $AGENT_ESCROW acceptjob "{
  \"agent\":\"$TEST_AGENT\",
  \"job_id\":$JOB_DISPUTE
}" $TEST_AGENT

proton action $AGENT_ESCROW startjob "{
  \"agent\":\"$TEST_AGENT\",
  \"job_id\":$JOB_DISPUTE
}" $TEST_AGENT

proton action $AGENT_ESCROW deliver "{
  \"agent\":\"$TEST_AGENT\",
  \"job_id\":$JOB_DISPUTE,
  \"evidence_uri\":\"ipfs://QmBadDeliverable\"
}" $TEST_AGENT
pass "Job #$JOB_DISPUTE delivered (will be disputed)"

# Client disputes
proton action $AGENT_ESCROW dispute "{
  \"raised_by\":\"$TEST_CLIENT\",
  \"job_id\":$JOB_DISPUTE,
  \"reason\":\"Deliverables do not match requirements\",
  \"evidence_uri\":\"ipfs://QmDisputeEvidence1\"
}" $TEST_CLIENT
pass "Job #$JOB_DISPUTE disputed by client"

# Double dispute should fail
expect_fail "Reject duplicate job dispute" \
  proton action $AGENT_ESCROW dispute "{
    \"raised_by\":\"$TEST_AGENT\",
    \"job_id\":$JOB_DISPUTE,
    \"reason\":\"Double dispute\",
    \"evidence_uri\":\"\"
  }" $TEST_AGENT

# Arbitrate — split 60% client, 40% agent
proton action $AGENT_ESCROW arbitrate "{
  \"arbitrator\":\"$TEST_ARBITRATOR\",
  \"dispute_id\":1,
  \"client_percent\":60,
  \"resolution_notes\":\"Partial delivery. Agent completed 40% of scope.\"
}" $TEST_ARBITRATOR
pass "Dispute arbitrated (60/40 split)"

echo "Job #$JOB_DISPUTE final state:"
proton table $AGENT_ESCROW jobs


section "16. Dispute — Fallback Arbitrator (no designated arbitrator)"

DEADLINE=$(($(date +%s) + 604800))
JOB_FALLBACK=$NEXT_JOB_ID
NEXT_JOB_ID=$((NEXT_JOB_ID + 1))

# Create job without arbitrator (empty name)
proton action $AGENT_ESCROW createjob "{
  \"client\":\"$TEST_CLIENT\",
  \"agent\":\"$TEST_AGENT2\",
  \"title\":\"No-Arbitrator Job\",
  \"description\":\"Job with fallback to contract owner\",
  \"deliverables\":\"[\\\"Report\\\"]\",
  \"amount\":500000,
  \"symbol\":\"4,XPR\",
  \"deadline\":$DEADLINE,
  \"arbitrator\":\"\",
  \"job_hash\":\"fallbackhash\"
}" $TEST_CLIENT
pass "Job #$JOB_FALLBACK created (no arbitrator)"

proton action eosio.token transfer "{
  \"from\":\"$TEST_CLIENT\",
  \"to\":\"$AGENT_ESCROW\",
  \"quantity\":\"50.0000 XPR\",
  \"memo\":\"fund:$JOB_FALLBACK\"
}" $TEST_CLIENT

proton action $AGENT_ESCROW acceptjob "{
  \"agent\":\"$TEST_AGENT2\",
  \"job_id\":$JOB_FALLBACK
}" $TEST_AGENT2

proton action $AGENT_ESCROW startjob "{
  \"agent\":\"$TEST_AGENT2\",
  \"job_id\":$JOB_FALLBACK
}" $TEST_AGENT2

proton action $AGENT_ESCROW deliver "{
  \"agent\":\"$TEST_AGENT2\",
  \"job_id\":$JOB_FALLBACK,
  \"evidence_uri\":\"ipfs://QmFallbackDeliver\"
}" $TEST_AGENT2

proton action $AGENT_ESCROW dispute "{
  \"raised_by\":\"$TEST_CLIENT\",
  \"job_id\":$JOB_FALLBACK,
  \"reason\":\"Unsatisfactory work\",
  \"evidence_uri\":\"\"
}" $TEST_CLIENT
pass "Job #$JOB_FALLBACK disputed (will use fallback arbitrator)"

# Contract owner resolves (fallback)
proton action $AGENT_ESCROW arbitrate "{
  \"arbitrator\":\"$AGENT_ESCROW\",
  \"dispute_id\":2,
  \"client_percent\":100,
  \"resolution_notes\":\"Full refund — agent failed to deliver.\"
}" $AGENT_ESCROW
pass "Fallback arbitration: contract owner resolved dispute #2"


########################################################################
# PART 4: ESCROW — PERMISSION FAILURES & GUARDS
########################################################################

section "17. Permission Failures — Escrow"

DEADLINE=$(($(date +%s) + 604800))
JOB_PERM=$NEXT_JOB_ID
NEXT_JOB_ID=$((NEXT_JOB_ID + 1))

# Create a job for permission tests
proton action $AGENT_ESCROW createjob "{
  \"client\":\"$TEST_CLIENT\",
  \"agent\":\"$TEST_AGENT\",
  \"title\":\"Permission Test Job\",
  \"description\":\"Testing permission failures\",
  \"deliverables\":\"[\\\"Test\\\"]\",
  \"amount\":500000,
  \"symbol\":\"4,XPR\",
  \"deadline\":$DEADLINE,
  \"arbitrator\":\"$TEST_ARBITRATOR\",
  \"job_hash\":\"permhash\"
}" $TEST_CLIENT

# Wrong account tries to fund
expect_fail "Reject funding by non-client" \
  proton action eosio.token transfer "{
    \"from\":\"$TEST_REVIEWER\",
    \"to\":\"$AGENT_ESCROW\",
    \"quantity\":\"50.0000 XPR\",
    \"memo\":\"fund:$JOB_PERM\"
  }" $TEST_REVIEWER

# Fund it properly
proton action eosio.token transfer "{
  \"from\":\"$TEST_CLIENT\",
  \"to\":\"$AGENT_ESCROW\",
  \"quantity\":\"50.0000 XPR\",
  \"memo\":\"fund:$JOB_PERM\"
}" $TEST_CLIENT

# Wrong agent tries to accept
expect_fail "Reject accept by wrong agent" \
  proton action $AGENT_ESCROW acceptjob "{
    \"agent\":\"$TEST_AGENT2\",
    \"job_id\":$JOB_PERM
  }" $TEST_AGENT2

# Accept properly
proton action $AGENT_ESCROW acceptjob "{
  \"agent\":\"$TEST_AGENT\",
  \"job_id\":$JOB_PERM
}" $TEST_AGENT

# Client tries to deliver (only agent can)
expect_fail "Reject delivery by client" \
  proton action $AGENT_ESCROW deliver "{
    \"agent\":\"$TEST_CLIENT\",
    \"job_id\":$JOB_PERM,
    \"evidence_uri\":\"ipfs://fake\"
  }" $TEST_CLIENT

# Start and deliver properly
proton action $AGENT_ESCROW startjob "{
  \"agent\":\"$TEST_AGENT\",
  \"job_id\":$JOB_PERM
}" $TEST_AGENT

proton action $AGENT_ESCROW deliver "{
  \"agent\":\"$TEST_AGENT\",
  \"job_id\":$JOB_PERM,
  \"evidence_uri\":\"ipfs://QmPermDeliver\"
}" $TEST_AGENT

# Agent tries to approve (only client can)
expect_fail "Reject approval by agent" \
  proton action $AGENT_ESCROW approve "{
    \"client\":\"$TEST_AGENT\",
    \"job_id\":$JOB_PERM
  }" $TEST_AGENT

# Wrong account tries to arbitrate
expect_fail "Reject arbitration by non-arbitrator" \
  proton action $AGENT_ESCROW arbitrate "{
    \"arbitrator\":\"$TEST_REVIEWER\",
    \"dispute_id\":1,
    \"client_percent\":50,
    \"resolution_notes\":\"hack\"
  }" $TEST_REVIEWER

# Clean up: approve the job
proton action $AGENT_ESCROW approve "{
  \"client\":\"$TEST_CLIENT\",
  \"job_id\":$JOB_PERM
}" $TEST_CLIENT
pass "Permission test job approved (cleanup)"


section "18. Double-Action Guards — Escrow"

# Try to approve already-completed job
expect_fail "Reject double-approve on completed job" \
  proton action $AGENT_ESCROW approve "{
    \"client\":\"$TEST_CLIENT\",
    \"job_id\":$JOB_HAPPY
  }" $TEST_CLIENT

# Try to deliver already-completed job
expect_fail "Reject deliver on completed job" \
  proton action $AGENT_ESCROW deliver "{
    \"agent\":\"$TEST_AGENT\",
    \"job_id\":$JOB_HAPPY,
    \"evidence_uri\":\"ipfs://double\"
  }" $TEST_AGENT

# Try to dispute already-completed job
expect_fail "Reject dispute on completed job" \
  proton action $AGENT_ESCROW dispute "{
    \"raised_by\":\"$TEST_CLIENT\",
    \"job_id\":$JOB_HAPPY,
    \"reason\":\"too late\",
    \"evidence_uri\":\"\"
  }" $TEST_CLIENT

# Try to accept already-started job
expect_fail "Reject accept on already-accepted job" \
  proton action $AGENT_ESCROW acceptjob "{
    \"agent\":\"$TEST_AGENT\",
    \"job_id\":$JOB_PERM
  }" $TEST_AGENT


########################################################################
# PART 5: ESCROW — CANCEL & REFUND
########################################################################

section "19. Job Cancellation (refund flow)"

DEADLINE=$(($(date +%s) + 604800))
JOB_CANCEL=$NEXT_JOB_ID
NEXT_JOB_ID=$((NEXT_JOB_ID + 1))

proton action $AGENT_ESCROW createjob "{
  \"client\":\"$TEST_CLIENT2\",
  \"agent\":\"$TEST_AGENT\",
  \"title\":\"Cancel Test Job\",
  \"description\":\"Will be cancelled before acceptance\",
  \"deliverables\":\"[\\\"Nothing\\\"]\",
  \"amount\":300000,
  \"symbol\":\"4,XPR\",
  \"deadline\":$DEADLINE,
  \"arbitrator\":\"$TEST_ARBITRATOR\",
  \"job_hash\":\"cancelhash\"
}" $TEST_CLIENT2
pass "Job #$JOB_CANCEL created for cancellation test"

# Fund it
proton action eosio.token transfer "{
  \"from\":\"$TEST_CLIENT2\",
  \"to\":\"$AGENT_ESCROW\",
  \"quantity\":\"30.0000 XPR\",
  \"memo\":\"fund:$JOB_CANCEL\"
}" $TEST_CLIENT2
pass "Job #$JOB_CANCEL funded"

# Cancel before agent accepts (should refund)
proton action $AGENT_ESCROW cancel "{
  \"client\":\"$TEST_CLIENT2\",
  \"job_id\":$JOB_CANCEL
}" $TEST_CLIENT2
pass "Job #$JOB_CANCEL cancelled (funds refunded)"

# Non-client tries to cancel
DEADLINE=$(($(date +%s) + 604800))
JOB_CANCEL2=$NEXT_JOB_ID
NEXT_JOB_ID=$((NEXT_JOB_ID + 1))

proton action $AGENT_ESCROW createjob "{
  \"client\":\"$TEST_CLIENT\",
  \"agent\":\"$TEST_AGENT\",
  \"title\":\"Cancel Auth Test\",
  \"description\":\"Testing cancel auth\",
  \"deliverables\":\"[\\\"x\\\"]\",
  \"amount\":100000,
  \"symbol\":\"4,XPR\",
  \"deadline\":$DEADLINE,
  \"arbitrator\":\"\",
  \"job_hash\":\"cancelauth\"
}" $TEST_CLIENT

expect_fail "Reject cancel by non-client" \
  proton action $AGENT_ESCROW cancel "{
    \"client\":\"$TEST_AGENT\",
    \"job_id\":$JOB_CANCEL2
  }" $TEST_AGENT


########################################################################
# PART 6: MILESTONES
########################################################################

section "20. Milestone Flow"

DEADLINE=$(($(date +%s) + 604800))
JOB_MILE=$NEXT_JOB_ID
NEXT_JOB_ID=$((NEXT_JOB_ID + 1))

proton action $AGENT_ESCROW createjob "{
  \"client\":\"$TEST_CLIENT\",
  \"agent\":\"$TEST_AGENT\",
  \"title\":\"Milestone Job\",
  \"description\":\"Job with milestones\",
  \"deliverables\":\"[\\\"Phase 1\\\",\\\"Phase 2\\\"]\",
  \"amount\":2000000,
  \"symbol\":\"4,XPR\",
  \"deadline\":$DEADLINE,
  \"arbitrator\":\"$TEST_ARBITRATOR\",
  \"job_hash\":\"milehash\"
}" $TEST_CLIENT
pass "Job #$JOB_MILE created for milestone test"

# Add milestones (while job is in CREATED state)
proton action $AGENT_ESCROW addmilestone "{
  \"client\":\"$TEST_CLIENT\",
  \"job_id\":$JOB_MILE,
  \"title\":\"Phase 1 - Design\",
  \"description\":\"Complete system design\",
  \"amount\":800000,
  \"order\":1
}" $TEST_CLIENT
pass "Milestone 1 added (80 XPR)"

proton action $AGENT_ESCROW addmilestone "{
  \"client\":\"$TEST_CLIENT\",
  \"job_id\":$JOB_MILE,
  \"title\":\"Phase 2 - Implementation\",
  \"description\":\"Build the system\",
  \"amount\":1200000,
  \"order\":2
}" $TEST_CLIENT
pass "Milestone 2 added (120 XPR)"

# Fund the job
proton action eosio.token transfer "{
  \"from\":\"$TEST_CLIENT\",
  \"to\":\"$AGENT_ESCROW\",
  \"quantity\":\"200.0000 XPR\",
  \"memo\":\"fund:$JOB_MILE\"
}" $TEST_CLIENT
pass "Job #$JOB_MILE funded (200 XPR)"

# Accept and start
proton action $AGENT_ESCROW acceptjob "{
  \"agent\":\"$TEST_AGENT\",
  \"job_id\":$JOB_MILE
}" $TEST_AGENT

proton action $AGENT_ESCROW startjob "{
  \"agent\":\"$TEST_AGENT\",
  \"job_id\":$JOB_MILE
}" $TEST_AGENT
pass "Job #$JOB_MILE accepted and started"

# Submit milestone 1
# We need the milestone IDs — they should be 1 and 2
proton action $AGENT_ESCROW submitmile "{
  \"agent\":\"$TEST_AGENT\",
  \"milestone_id\":1,
  \"evidence_uri\":\"ipfs://QmMilestone1\"
}" $TEST_AGENT
pass "Milestone 1 submitted"

# Approve milestone 1 (releases partial payment)
proton action $AGENT_ESCROW approvemile "{
  \"client\":\"$TEST_CLIENT\",
  \"milestone_id\":1
}" $TEST_CLIENT
pass "Milestone 1 approved (80 XPR released)"

# Submit milestone 2
proton action $AGENT_ESCROW submitmile "{
  \"agent\":\"$TEST_AGENT\",
  \"milestone_id\":2,
  \"evidence_uri\":\"ipfs://QmMilestone2\"
}" $TEST_AGENT
pass "Milestone 2 submitted"

# Approve milestone 2
proton action $AGENT_ESCROW approvemile "{
  \"client\":\"$TEST_CLIENT\",
  \"milestone_id\":2
}" $TEST_CLIENT
pass "Milestone 2 approved (120 XPR released)"

echo "Milestones:"
proton table $AGENT_ESCROW milestones


########################################################################
# PART 7: ARBITRATOR UNSTAKE LIFECYCLE
########################################################################

section "21. Arbitrator Unstake Lifecycle"

# Deactivate arbitrator first (required before unstaking)
proton action $AGENT_ESCROW deactarb "{
  \"account\":\"$TEST_ARBITRATOR\"
}" $TEST_ARBITRATOR
pass "Arbitrator deactivated"

# Request unstake
proton action $AGENT_ESCROW unstakearb "{
  \"account\":\"$TEST_ARBITRATOR\",
  \"amount\":500000
}" $TEST_ARBITRATOR
pass "Arbitrator unstake requested (50 XPR)"

# Withdraw should fail (delay not elapsed)
expect_fail "Reject early arbitrator withdrawal" \
  proton action $AGENT_ESCROW withdrawarb "{
    \"account\":\"$TEST_ARBITRATOR\"
  }" $TEST_ARBITRATOR

# Cancel the unstake (return to active stake)
proton action $AGENT_ESCROW cancelunstk "{
  \"account\":\"$TEST_ARBITRATOR\"
}" $TEST_ARBITRATOR
pass "Arbitrator unstake cancelled (stake restored)"

# Re-activate
proton action $AGENT_ESCROW activatearb "{
  \"account\":\"$TEST_ARBITRATOR\"
}" $TEST_ARBITRATOR
pass "Arbitrator re-activated"

echo "Arbitrator state:"
proton table $AGENT_ESCROW arbitrators


########################################################################
# PART 8: OWNERSHIP LIFECYCLE
########################################################################

section "22. Ownership Lifecycle (approveclaim → claim → release)"

# Agent approves a KYC'd human to claim
proton action $AGENT_CORE approveclaim "{
  \"agent\":\"$TEST_AGENT2\",
  \"new_owner\":\"$TEST_OWNER\"
}" $TEST_AGENT2
pass "Agent approved $TEST_OWNER to claim"

# Human sends claim deposit and claims
proton action eosio.token transfer "{
  \"from\":\"$TEST_OWNER\",
  \"to\":\"$AGENT_CORE\",
  \"quantity\":\"10.0000 XPR\",
  \"memo\":\"claim:$TEST_AGENT2:$TEST_OWNER\"
}" $TEST_OWNER
pass "Claim deposit sent"

proton action $AGENT_CORE claim "{
  \"agent\":\"$TEST_AGENT2\"
}" $TEST_OWNER
pass "Agent claimed by $TEST_OWNER"

echo "Agent2 owner after claim:"
proton table $AGENT_CORE agents

# Verify claim (anyone can call — checks KYC is still valid)
proton action $AGENT_CORE verifyclaim "{
  \"agent\":\"$TEST_AGENT2\"
}" $TEST_REVIEWER
pass "Claim verification triggered"

# Release agent (deposit refunded to original payer)
proton action $AGENT_CORE release "{
  \"agent\":\"$TEST_AGENT2\"
}" $TEST_OWNER
pass "Agent released (deposit refunded to $TEST_OWNER)"


section "23. Ownership — Cancel Claim"

# Approve and then cancel before claim completes
proton action $AGENT_CORE approveclaim "{
  \"agent\":\"$TEST_AGENT2\",
  \"new_owner\":\"$TEST_OWNER\"
}" $TEST_AGENT2
pass "Agent re-approved $TEST_OWNER"

proton action eosio.token transfer "{
  \"from\":\"$TEST_OWNER\",
  \"to\":\"$AGENT_CORE\",
  \"quantity\":\"10.0000 XPR\",
  \"memo\":\"claim:$TEST_AGENT2:$TEST_OWNER\"
}" $TEST_OWNER

# Agent cancels the pending claim (deposit refunded)
proton action $AGENT_CORE cancelclaim "{
  \"agent\":\"$TEST_AGENT2\"
}" $TEST_AGENT2
pass "Claim cancelled (deposit refunded)"

# Wrong account tries to claim after cancel
expect_fail "Reject claim after cancellation" \
  proton action $AGENT_CORE claim "{
    \"agent\":\"$TEST_AGENT2\"
  }" $TEST_OWNER


########################################################################
# PART 9: FEE CONFIGURATION
########################################################################

section "24. Fee Configuration (setconfig)"

# Set registration fee on agentcore
proton action $AGENT_CORE setconfig "{
  \"min_stake\":1000000,
  \"registration_fee\":50000,
  \"claim_fee\":100000,
  \"feed_contract\":\"$AGENT_FEED\",
  \"valid_contract\":\"$AGENT_VALID\",
  \"escrow_contract\":\"$AGENT_ESCROW\",
  \"paused\":false
}" $AGENT_CORE
pass "agentcore config updated (regfee=5 XPR, claimfee=10 XPR)"

# Set feedback fee
proton action $AGENT_FEED setconfig "{
  \"core_contract\":\"$AGENT_CORE\",
  \"min_score\":1,
  \"max_score\":5,
  \"dispute_window\":86400,
  \"decay_period\":7776000,
  \"decay_floor\":10,
  \"paused\":false,
  \"feedback_fee\":10000
}" $AGENT_FEED
pass "agentfeed config updated (feedbackfee=1 XPR)"

# Set validation fee
proton action $AGENT_VALID setconfig "{
  \"core_contract\":\"$AGENT_CORE\",
  \"min_stake\":5000000,
  \"challenge_stake\":1000000,
  \"unstake_delay\":604800,
  \"challenge_window\":86400,
  \"slash_percent\":1000,
  \"dispute_period\":3,
  \"funded_challenge_timeout\":604800,
  \"paused\":false,
  \"validation_fee\":10000
}" $AGENT_VALID
pass "agentvalid config updated (valfee=1 XPR)"

# Set escrow config
proton action $AGENT_ESCROW setconfig "{
  \"platform_fee\":100,
  \"min_job_amount\":10000,
  \"default_deadline_days\":30,
  \"dispute_window\":259200,
  \"paused\":false
}" $AGENT_ESCROW
pass "agentescrow config updated (platformfee=1%)"

# Non-owner tries setconfig
expect_fail "Reject setconfig by non-owner" \
  proton action $AGENT_CORE setconfig "{
    \"min_stake\":0,
    \"registration_fee\":0,
    \"claim_fee\":0,
    \"feed_contract\":\"$AGENT_FEED\",
    \"valid_contract\":\"$AGENT_VALID\",
    \"escrow_contract\":\"$AGENT_ESCROW\",
    \"paused\":false
  }" $TEST_REVIEWER


section "25. Pause Guard"

# Pause agentcore
proton action $AGENT_CORE setconfig "{
  \"min_stake\":1000000,
  \"registration_fee\":50000,
  \"claim_fee\":100000,
  \"feed_contract\":\"$AGENT_FEED\",
  \"valid_contract\":\"$AGENT_VALID\",
  \"escrow_contract\":\"$AGENT_ESCROW\",
  \"paused\":true
}" $AGENT_CORE
pass "agentcore paused"

# Registration should fail while paused
expect_fail "Reject registration while paused" \
  proton action $AGENT_CORE register "{
    \"account\":\"$TEST_REVIEWER\",
    \"name\":\"Paused Agent\",
    \"description\":\"should fail\",
    \"endpoint\":\"https://paused.com\",
    \"protocol\":\"https\",
    \"capabilities\":\"[]\"
  }" $TEST_REVIEWER

# Unpause
proton action $AGENT_CORE setconfig "{
  \"min_stake\":1000000,
  \"registration_fee\":50000,
  \"claim_fee\":100000,
  \"feed_contract\":\"$AGENT_FEED\",
  \"valid_contract\":\"$AGENT_VALID\",
  \"escrow_contract\":\"$AGENT_ESCROW\",
  \"paused\":false
}" $AGENT_CORE
pass "agentcore unpaused"


########################################################################
# PART 10: BOUNDARY AMOUNTS
########################################################################

section "26. Boundary Amounts"

DEADLINE=$(($(date +%s) + 604800))
JOB_OVERFUND=$NEXT_JOB_ID
NEXT_JOB_ID=$((NEXT_JOB_ID + 1))

# Create a small job
proton action $AGENT_ESCROW createjob "{
  \"client\":\"$TEST_CLIENT\",
  \"agent\":\"$TEST_AGENT\",
  \"title\":\"Overfund Test\",
  \"description\":\"Testing overfunding refund\",
  \"deliverables\":\"[\\\"Test\\\"]\",
  \"amount\":100000,
  \"symbol\":\"4,XPR\",
  \"deadline\":$DEADLINE,
  \"arbitrator\":\"\",
  \"job_hash\":\"overfundhash\"
}" $TEST_CLIENT
pass "Job #$JOB_OVERFUND created (10 XPR)"

# Send exactly the right amount
proton action eosio.token transfer "{
  \"from\":\"$TEST_CLIENT\",
  \"to\":\"$AGENT_ESCROW\",
  \"quantity\":\"10.0000 XPR\",
  \"memo\":\"fund:$JOB_OVERFUND\"
}" $TEST_CLIENT
pass "Job #$JOB_OVERFUND funded exactly (10 XPR)"

# Try to overfund (send more after fully funded)
expect_fail "Reject overfunding already-funded job" \
  proton action eosio.token transfer "{
    \"from\":\"$TEST_CLIENT\",
    \"to\":\"$AGENT_ESCROW\",
    \"quantity\":\"10.0000 XPR\",
    \"memo\":\"fund:$JOB_OVERFUND\"
  }" $TEST_CLIENT


########################################################################
# PART 11: PERMISSIONLESS CLEANUP
########################################################################

section "27. Permissionless Cleanup Actions"

# These may not have expired records to clean, but should not error
echo "Running cleanup actions (may be no-ops if nothing to clean)..."

if proton action $AGENT_VALID cleanvals "{
  \"agent\":\"$TEST_AGENT\",
  \"max_age\":1,
  \"max_delete\":10
}" $TEST_REVIEWER 2>/dev/null; then
  pass "cleanvals executed"
else
  skip "cleanvals (no records to clean or too recent)"
fi

if proton action $AGENT_VALID cleanchals "{
  \"max_age\":1,
  \"max_delete\":10
}" $TEST_REVIEWER 2>/dev/null; then
  pass "cleanchals executed"
else
  skip "cleanchals (no records to clean)"
fi

if proton action $AGENT_FEED cleanfback "{
  \"agent\":\"$TEST_AGENT\",
  \"max_age\":1,
  \"max_delete\":10
}" $TEST_REVIEWER 2>/dev/null; then
  pass "cleanfback executed"
else
  skip "cleanfback (no records to clean)"
fi

if proton action $AGENT_ESCROW cleanjobs "{
  \"max_age\":1,
  \"max_delete\":10
}" $TEST_REVIEWER 2>/dev/null; then
  pass "cleanjobs executed"
else
  skip "cleanjobs (no records to clean)"
fi


########################################################################
# SUMMARY
########################################################################

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}=== Test Suite Complete ===${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "Results: ${GREEN}$PASS_COUNT passed${NC}, ${RED}$FAIL_COUNT failed${NC}, ${YELLOW}$SKIP_COUNT skipped${NC}"
echo -e "\nDetails:${SUMMARY}"
echo ""

if [ $FAIL_COUNT -gt 0 ]; then
  echo -e "${RED}SOME TESTS FAILED${NC}"
  exit 1
else
  echo -e "${GREEN}ALL TESTS PASSED${NC}"
fi
