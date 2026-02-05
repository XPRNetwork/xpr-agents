# XPR Agents - Economic Model & Design Decisions

This document explains the economic model, staking mechanisms, and the reasoning behind key design decisions in the XPR Agents trustless registry system.

## Overview

The system uses a **hybrid staking model** where different participants have different accountability mechanisms based on their roles and the risks they pose.

| Participant | Staking Model | Slashable? | Rationale |
|-------------|---------------|------------|-----------|
| **Agents** | System staking (`stake.proton`) | No | Reputation-based accountability |
| **Validators** | Contract-managed | Yes | Direct financial accountability for validation accuracy |
| **Arbitrators** | Contract-managed | Yes | Direct financial accountability for dispute resolution |

---

## Agent Staking: System-Based (Non-Slashable)

### How It Works

Agents stake XPR through XPR Network's native staking system (`stake.proton` / `eosio::voters`), not directly with the agentcore contract. The contract reads their system stake to:

1. Verify minimum stake requirements during registration
2. Calculate trust score (stake contributes 0-20 points)

```
Agent stakes via resources.xprnetwork.org
            ↓
    eosio::voters table updated
            ↓
    agentcore reads stake for verification
```

### Why Not Contract-Managed Staking for Agents?

We considered having agents stake directly with agentcore (enabling slashing), but decided against it for several reasons:

**1. Validators Are the Enforcement Layer**

Validators stake real XPR with the agentvalid contract and CAN be slashed for incorrect validations. They serve as the quality control layer:

- Validator approves bad work → gets challenged → loses stake
- This creates strong incentives for honest validation
- Agents are held accountable *through* validators, not directly

**2. Escrow Protects Clients**

The agentescrow contract holds client funds until work is delivered and approved:

- Agent doesn't deliver → client gets refund
- Agent delivers bad work → dispute → arbitration
- Bad agents simply don't get paid

Slashing is unnecessary when payment is already conditional on performance.

**3. Reputation Is Sufficient Punishment**

The feedback system creates strong market incentives:

- Bad work → negative feedback → lower trust score
- Lower trust score → fewer job opportunities
- KYC-weighted feedback prevents reputation manipulation
- Directional trust allows personalized agent selection

An agent with poor reputation effectively loses their business - no slashing required.

**4. System Staking Benefits**

Using system staking provides advantages:

- **Staking rewards**: Agents earn APY on their stake
- **Simpler UX**: Many users already have system stake
- **No lock-up complexity**: We don't need to manage unstaking delays
- **Ecosystem alignment**: Agents contribute to network security

**5. Minimum Stake Still Creates Skin in the Game**

The `min_stake` requirement ensures agents have economic exposure:

- Must maintain minimum stake to remain registered
- Opportunity cost of capital
- Bad behavior risks losing future income from jobs

---

## Validator Staking: Contract-Managed (Slashable)

### How It Works

Validators send XPR directly to the agentvalid contract:

```bash
# Stake as validator
cleos transfer myvalidator agentvalid "1000.0000 XPR" "stake"
```

The contract manages their stake and can slash it for misconduct.

### Why Slashable?

Validators have a critical role - they attest to the quality of agent work. Incorrect validations can:

- Allow bad agents to build undeserved reputation
- Cause clients to trust unreliable agents
- Undermine the entire trust system

**Slashing creates direct accountability:**

| Scenario | Outcome |
|----------|---------|
| Validator approves bad work | Can be challenged |
| Challenge upheld | Validator loses stake (slashed) |
| Challenge rejected | Challenger loses stake |

This economic game ensures validators only approve work they genuinely believe is good.

### Challenge Flow

```
Validator submits validation
         ↓
    Challenge window (3 days)
         ↓
Anyone can challenge (requires stake)
         ↓
    Resolution by owner/DAO
         ↓
Winner gets loser's stake
```

---

## Arbitrator Staking: Contract-Managed (Slashable)

Arbitrators in the escrow system also use contract-managed staking. They resolve disputes between clients and agents, so financial accountability is essential for fair resolution.

---

## Trust Score Calculation

The trust score combines multiple signals, solving the cold-start problem for new agents:

| Component | Max Points | Source |
|-----------|------------|--------|
| KYC Level | 30 | XPR Network native KYC (0-3) × 10 |
| System Stake | 20 | Agent's staked XPR (caps at 10,000) |
| Reputation | 40 | KYC-weighted feedback scores |
| Longevity | 10 | 1 point per month active (max 10) |
| **Total** | **100** | |

New agents with KYC level 3 and sufficient stake start with up to 50 points - enough to begin building reputation through actual work.

---

## Why This Model Works

### Separation of Concerns

Each layer handles accountability differently:

| Layer | Accountability Mechanism |
|-------|--------------------------|
| **Agents** | Reputation + escrow (market forces) |
| **Validators** | Slashable stake (direct financial) |
| **Arbitrators** | Slashable stake (direct financial) |
| **Clients** | Escrow protection (funds safe until satisfied) |

### Defense in Depth

Multiple layers prevent bad outcomes:

1. **Min stake** - Filters out uncommitted participants
2. **KYC** - Provides identity verification
3. **Escrow** - Protects client funds
4. **Validation** - Third-party quality checks
5. **Feedback** - Builds/destroys reputation over time
6. **Slashing** - Punishes dishonest validators/arbitrators

### Economic Alignment

All participants benefit from honest behavior:

- **Agents**: Good reputation → more jobs → more income
- **Validators**: Accurate validations → keep stake → earn fees
- **Clients**: Quality work → successful projects
- **Network**: Trustworthy marketplace → more adoption

---

## Future Considerations

### Optional Agent Security Deposits

If a use case emerges requiring agent slashing (e.g., agents handling sensitive data), we could add an optional "security deposit" that is slashable, while keeping system stake for trust scores.

### DAO Governance

Challenge resolution is currently owner-controlled. This could transition to DAO governance where token holders vote on disputed validations.

### Reputation Portability

External reputation providers can be integrated via the agentfeed contract's `repproviders` table, allowing reputation to be aggregated from multiple sources.

---

## Summary

The XPR Agents system uses a thoughtful hybrid model:

- **Agents don't need slashing** because escrow, validation, and reputation provide sufficient accountability
- **Validators need slashing** because they're the trust enforcement layer and must have direct financial skin in the game
- **System staking for agents** provides benefits (rewards, simplicity) without drawbacks (we don't need to slash them)

This design minimizes complexity while maintaining strong economic guarantees for all participants.
