# XPR Agents Pre-Deployment Simulation Report

**Date:** February 5, 2026
**Simulation Type:** 8-Agent Comprehensive Analysis
**Purpose:** Identify all blockers before testnet deployment

---

## Executive Summary

A comprehensive 8-agent simulation was conducted covering lifecycle flows, incomplete code, payment security, authorization, SDK alignment, integer arithmetic, deployment scripts, and cross-contract interactions.

### Critical Finding Count

| Severity | Count | Testnet Blocker |
|----------|-------|-----------------|
| CRITICAL | 8 | YES |
| HIGH | 12 | SOME |
| MEDIUM | 18 | NO |
| LOW | 15+ | NO |

### Deployment Readiness

| Component | Status | Blocker Issues |
|-----------|--------|----------------|
| Contracts | NOT READY | 8 critical bugs |
| SDK | PARTIAL | Missing methods for new features |
| Scripts | NOT READY | Missing agentescrow in mainnet deploy |
| Frontend | NOT READY | SDK singleton issue |
| Indexer | NOT READY | Missing agentescrow handler |

---

## CRITICAL ISSUES (Must Fix Before ANY Deployment)

### 1. InlineAction Implementation is Empty (BLOCKER)

**File:** All 4 contracts
**Lines:** ~543-554 in each contract

```typescript
class InlineAction<T> {
  send(from: Name, to: Name, quantity: Asset, memo: string): void {
    // Implementation handled by proton-tsc  <-- EMPTY!
  }
}
```

**Impact:** ALL token transfers fail silently:
- Stake withdrawals don't work
- Escrow payments don't work
- Arbitrator fees don't work
- Platform fees don't work

**Fix Required:** Replace with proper proton-tsc inline action pattern.

---

### 2. Contract init() Wrong Constructor Arguments (BLOCKER)

**agentfeed init() - Line 339:**
```typescript
const config = new Config(owner, core_contract, 1, 5, 604800, false);
// Config has 8 parameters, only 6 passed!
// Missing: decay_period, decay_floor
```

**agentescrow init() - Line 219:**
```typescript
const config = new EscrowConfig(owner, core_contract, feed_contract, platform_fee, 10000, 30, 259200, false);
// EscrowConfig has 10 parameters, only 8 passed!
// Missing: acceptance_timeout, min_arbitrator_stake
```

**Impact:** Contract initialization will fail or produce undefined behavior.

---

### 3. Division by Zero - decay_period (BLOCKER)

**File:** `agentfeed.contract.ts:526`
```typescript
const decayPeriods = ageSeconds / config.decay_period;
```

**Issue:** No validation that `decay_period > 0` in setConfig.

**Impact:** If decay_period is 0, contract will crash on any recalculation.

---

### 4. Challenge Created Without Stake (BLOCKER)

**File:** `agentvalid.contract.ts` - challenge() action

**Issue:** Challenges are created with `stake = 0`, funded separately via transfer. This allows:
1. Creating challenges without ever funding them
2. Blocking validations indefinitely with unfunded challenges
3. Griefing attack at zero cost

**Impact:** Validation system can be completely blocked.

---

### 5. Validator Accuracy Calculation Bug (BLOCKER)

**File:** `agentvalid.contract.ts:492-500`
```typescript
validator.accuracy_score = (validator.correct_validations * 10000) / validator.total_validations;
```

**Issue:** `correct_validations` only increments when a challenge is REJECTED. A validator with 100 validations and 1 rejected challenge shows:
- `correct_validations = 1`
- `total_validations = 100`
- `accuracy_score = 100` (1% accuracy!)

**Impact:** All validators appear to have near-zero accuracy.

---

### 6. incjobs Authorization Broken (BLOCKER)

**File:** `agentcore.contract.ts:283-296`
```typescript
check(
  hasAuth(config.owner) || hasAuth(this.receiver),
  "Only authorized contracts can increment jobs"
);
```

**Issue:** Comment says "Allow agentfeed or agentvalid contracts to call this" but authorization only allows owner or agentcore itself. Neither agentfeed nor agentvalid can call this.

**Impact:** `total_jobs` counter never increments. Job count metrics are broken.

---

### 7. Hardcoded "agentcore" in External Tables (BLOCKER)

**Files:** agentfeed, agentvalid, agentescrow

```typescript
private agentRefTable: TableStore<AgentRef> = new TableStore<AgentRef>(
  Name.fromString("agentcore"),  // HARDCODED!
  Name.fromString("agentcore")
);
```

**Issue:** If contracts are deployed to different accounts (e.g., `testagentc`), external table lookups fail. The `core_contract` config field is NEVER used.

**Impact:** Cannot deploy to any account other than exactly "agentcore".

---

### 8. Milestone Release Can Exceed Funded Amount (BLOCKER)

**File:** `agentescrow.contract.ts` - approveMilestone()

**Issue:** `releasePayment(job, milestone.amount)` is called without checking if `milestone.amount` exceeds remaining funds.

```typescript
// Missing check:
check(job.released_amount + milestone.amount <= job.funded_amount, "Exceeds funds");
```

**Impact:** Can release more tokens than deposited in escrow.

---

## HIGH SEVERITY ISSUES

### 9. Double-Spend in Arbitration (State Update Order)

**File:** `agentescrow.contract.ts:552-579`

Payments are sent BEFORE updating job state. If token transfer has issues, state update may not happen.

**Fix:** Update state before sending tokens (Checks-Effects-Interactions pattern).

---

### 10. Trapped Funds from Invalid Memos

**Files:** All contracts with transfer handlers

Transfers with unrecognized memos (e.g., `"fund:"` without job ID) are accepted but funds are trapped with no recovery mechanism.

**Fix:** Add else clause rejecting invalid memos.

---

### 11. Validator Can Unstake with Pending Challenges

**File:** `agentvalid.contract.ts` - unstake()

Validators can initiate unstake while their validations are being challenged, potentially withdrawing before slash.

**Fix:** Check for pending challenges before allowing unstake.

---

### 12. deploy-mainnet.sh Missing agentescrow

**File:** `scripts/deploy-mainnet.sh`

Only deploys 3 contracts. agentescrow is completely missing from mainnet deployment.

---

### 13. Decay Not Applied on Feedback Submission

**File:** `agentfeed.contract.ts`

Decay is only calculated during manual `recalculate()` action, not during `submit()`. Scores drift without manual intervention.

---

### 14. Can Deliver Job Without Completing Milestones

**File:** `agentescrow.contract.ts` - deliverJob()

Agent can call `deliver` even if milestones are incomplete, bypassing milestone workflow.

---

## Test Coverage Gap

| Contract | Actions | Tested | Coverage |
|----------|---------|--------|----------|
| agentcore | 15 | 4 | 27% |
| agentfeed | 14 | 1 | 7% |
| agentvalid | 11 | 3 | 27% |
| agentescrow | 17 | 0 | **0%** |
| **Total** | **57** | **8** | **14%** |

**The escrow contract has ZERO test coverage.**

---

## SDK Alignment Issues

### Missing SDK Methods for New Contract Features

| Feature | Contract Action | SDK Method |
|---------|-----------------|------------|
| Context feedback | submitctx | MISSING |
| Directional trust | settrust | MISSING |
| Payment proof | submitwpay | MISSING |
| External scores | submitext | MISSING |
| Arbitrator management | regarb, activatearb | MISSING |
| Cancel unstake | cancelunstk | MISSING |
| Toggle plugin | toggleplug | MISSING |

### Missing Type Definitions

- ContextScore
- DirectionalTrust
- ReputationProvider
- ExternalScore
- PaymentProof
- EscrowConfig

---

## Integer Arithmetic Risks

### Overflow Risks (14 locations)

| Location | Calculation | Risk |
|----------|-------------|------|
| agentfeed:555 | `totalScore * 10000` | HIGH - avg score overflow |
| agentescrow:337 | milestone total accumulation | MEDIUM |
| agentvalid:479 | `stake * slash_percent` | MEDIUM |
| All contracts | stake addition | MEDIUM |

### Underflow Risks (3 locations)

| Location | Calculation | Risk |
|----------|-------------|------|
| agentescrow:451,538,619 | `funded - released` | MEDIUM - if released > funded |

---

## Recommended Fix Priority

### Phase 1: Critical Blockers (Before ANY Testing)

1. **Replace InlineAction stub** with proper proton-tsc implementation
2. **Fix init() constructor arguments** in agentfeed and agentescrow
3. **Add decay_period > 0 validation** in agentfeed setConfig
4. **Require stake at challenge creation** or validate before resolution
5. **Fix accuracy calculation** - initialize correct_validations = total_validations
6. **Fix incjobs authorization** or remove dead code
7. **Use config.core_contract** instead of hardcoded "agentcore"
8. **Add release amount check** in releasePayment function

### Phase 2: High Priority (Before Testnet)

9. State update before token transfers (CEI pattern)
10. Reject invalid transfer memos
11. Check pending challenges before unstake
12. Add agentescrow to deploy-mainnet.sh
13. Apply decay on submission, not just recalculate
14. Validate milestones before delivery

### Phase 3: Testing (During Testnet)

15. Add comprehensive escrow tests
16. Add negative/error case tests
17. Add state transition tests
18. Achieve minimum 50% test coverage

---

## Files Requiring Immediate Changes

| File | Issues | Priority |
|------|--------|----------|
| `contracts/agentcore/assembly/agentcore.contract.ts` | InlineAction stub, incjobs auth | CRITICAL |
| `contracts/agentfeed/assembly/agentfeed.contract.ts` | init() args, decay validation, InlineAction | CRITICAL |
| `contracts/agentvalid/assembly/agentvalid.contract.ts` | accuracy calc, challenge stake, InlineAction | CRITICAL |
| `contracts/agentescrow/assembly/agentescrow.contract.ts` | init() args, release check, InlineAction | CRITICAL |
| `scripts/deploy-mainnet.sh` | Missing agentescrow | HIGH |
| `scripts/test-actions.sh` | Missing escrow tests | HIGH |

---

## Conclusion

**The contracts are NOT ready for testnet deployment.**

8 critical issues must be fixed before any deployment can proceed. The most severe is the empty InlineAction implementation which means ALL token transfers will silently fail.

The recommended approach:
1. Fix all 8 critical issues first
2. Run local unit tests
3. Deploy to testnet
4. Run comprehensive integration tests
5. Fix high/medium issues discovered during testing
6. Professional security audit before mainnet

---

*Report generated by 8-agent simulation swarm*
*XPR Network Trustless Agents Pre-Deployment Analysis*
