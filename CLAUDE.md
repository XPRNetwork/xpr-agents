# XPR Network Trustless Agents

## Overview

This project implements a trustless agent registry system on XPR Network, inspired by [EIP-8004](https://eips.ethereum.org/EIPS/eip-8004) but leveraging XPR Network's native advantages.

## EIP-8004 Summary

EIP-8004 proposes three registries for Ethereum-based trustless agents:

| Registry | Purpose |
|----------|---------|
| **Identity Registry** | NFT-based agent registration with metadata URIs |
| **Reputation Registry** | Feedback storage with ratings and evidence |
| **Validation Registry** | Third-party validation of agent outputs |

### EIP-8004 Limitations
- Gas costs for every feedback submission
- Cold-start problem (new agents have no trust)
- NFT-based identity (complex, gas-intensive)
- No native identity/KYC integration

## XPR Network Advantages

| Feature | Benefit for Trustless Agents |
|---------|------------------------------|
| **Zero Gas Fees** | Free feedback submission, no barrier to reputation building |
| **Native KYC (Levels 0-3)** | Solves cold-start problem - KYC'd agents have baseline trust |
| **Human-Readable Accounts** | `alice.agent` instead of `0x7a3b...` |
| **0.5s Block Times** | Near-instant agent registration and feedback |
| **Built-in Permissions** | Granular access control without extra contracts |
| **WebAuth Wallets** | Face ID/fingerprint signing for agents |
| **Hyperion Streaming** | Real-time event subscriptions |

## Architecture

### Three-Contract System

```
┌─────────────────────────────────────────────────────────────┐
│                     XPR AGENT REGISTRY                       │
├─────────────────┬─────────────────┬─────────────────────────┤
│   agentcore     │   agentfeed     │      agentvalid         │
│   (Identity)    │   (Reputation)  │      (Validation)       │
├─────────────────┼─────────────────┼─────────────────────────┤
│ • Agent NFT/reg │ • Feedback      │ • Validator stake       │
│ • Metadata      │ • Ratings       │ • Output verification   │
│ • Capabilities  │ • Evidence URIs │ • Specializations       │
│ • Stake/deposit │ • KYC-weighted  │ • Accuracy tracking     │
└─────────────────┴─────────────────┴─────────────────────────┘
```

### Table Definitions

#### agentcore Contract

```typescript
@table("agents")
export class Agent extends Table {
  constructor(
    public account: Name = new Name(),      // Primary key (human-readable)
    public name: string = "",               // Display name
    public description: string = "",        // Agent description
    public endpoint: string = "",           // API endpoint URL
    public protocol: string = "",           // Communication protocol
    public capabilities: string = "",       // JSON array of capabilities
    public stake: u64 = 0,                  // Staked XPR amount
    public total_jobs: u64 = 0,             // Completed job count
    public registered_at: u64 = 0,          // Registration timestamp
    public active: boolean = true           // Active status
  ) { super(); }

  @primary
  get primary(): u64 { return this.account.N; }
}

@table("plugins")
export class Plugin extends Table {
  constructor(
    public id: u64 = 0,                     // Primary key
    public name: string = "",               // Plugin identifier
    public version: string = "",            // Semantic version
    public contract: Name = new Name(),     // Plugin contract account
    public action: string = "",             // Entry action name
    public schema: string = "",             // JSON schema for params
    public category: string = "",           // Plugin category
    public author: Name = new Name(),       // Plugin author
    public verified: boolean = false        // Verified by validators
  ) { super(); }

  @primary
  get primary(): u64 { return this.id; }

  @secondary
  get byName(): u64 { return hashString(this.name); }
}

@table("agentplugs")
export class AgentPlugin extends Table {
  constructor(
    public id: u64 = 0,                     // Primary key
    public agent: Name = new Name(),        // Agent account
    public plugin_id: u64 = 0,              // Plugin reference
    public config: string = "",             // Plugin configuration JSON
    public enabled: boolean = true          // Enabled status
  ) { super(); }

  @primary
  get primary(): u64 { return this.id; }

  @secondary
  get byAgent(): u64 { return this.agent.N; }
}
```

#### agentfeed Contract

```typescript
@table("feedback")
export class Feedback extends Table {
  constructor(
    public id: u64 = 0,                     // Primary key
    public agent: Name = new Name(),        // Agent being reviewed
    public reviewer: Name = new Name(),     // Reviewer account
    public reviewer_kyc_level: u8 = 0,      // Reviewer's KYC level (0-3)
    public score: u8 = 0,                   // Rating (1-5)
    public tags: string = "",               // Comma-separated tags
    public job_hash: string = "",           // Hash of completed job
    public evidence_uri: string = "",       // IPFS/Arweave evidence
    public amount_paid: u64 = 0,            // Payment for job (if any)
    public timestamp: u64 = 0               // Submission time
  ) { super(); }

  @primary
  get primary(): u64 { return this.id; }

  @secondary
  get byAgent(): u64 { return this.agent.N; }

  @secondary
  get byReviewer(): u64 { return this.reviewer.N; }
}

@table("agentscores")
export class AgentScore extends Table {
  constructor(
    public agent: Name = new Name(),        // Agent account
    public total_score: u64 = 0,            // Sum of weighted scores
    public total_weight: u64 = 0,           // Sum of weights
    public feedback_count: u64 = 0,         // Number of feedbacks
    public last_updated: u64 = 0            // Last calculation time
  ) { super(); }

  @primary
  get primary(): u64 { return this.agent.N; }
}
```

#### agentvalid Contract

```typescript
@table("validators")
export class Validator extends Table {
  constructor(
    public account: Name = new Name(),      // Validator account
    public stake: u64 = 0,                  // Staked amount
    public method: string = "",             // Validation method description
    public specializations: string = "",    // JSON array of specialties
    public total_validations: u64 = 0,      // Validation count
    public accuracy_score: u64 = 0,         // Accuracy (0-10000 = 0-100.00%)
    public registered_at: u64 = 0           // Registration time
  ) { super(); }

  @primary
  get primary(): u64 { return this.account.N; }
}

@table("validations")
export class Validation extends Table {
  constructor(
    public id: u64 = 0,                     // Primary key
    public validator: Name = new Name(),    // Validator account
    public agent: Name = new Name(),        // Agent validated
    public job_hash: string = "",           // Job being validated
    public result: u8 = 0,                  // 0=fail, 1=pass, 2=partial
    public confidence: u8 = 0,              // Confidence (0-100)
    public evidence_uri: string = "",       // Evidence URI
    public timestamp: u64 = 0               // Validation time
  ) { super(); }

  @primary
  get primary(): u64 { return this.id; }

  @secondary
  get byAgent(): u64 { return this.agent.N; }
}
```

## Trust Score Algorithm

The trust score combines multiple signals to solve the cold-start problem:

```typescript
function calculateTrustScore(agent: Agent, feedbacks: Feedback[], kycLevel: u8): u64 {
  // Base score from KYC level (0-30 points)
  const kycScore: u64 = <u64>kycLevel * 10;

  // Stake score (0-20 points, caps at 10000 XPR)
  const stakeScore: u64 = min(agent.stake / 500, 20);

  // Reputation score from feedback (0-40 points)
  let weightedSum: u64 = 0;
  let totalWeight: u64 = 0;

  for (let i = 0; i < feedbacks.length; i++) {
    const fb = feedbacks[i];
    // KYC-weighted feedback: higher KYC = more weight
    const weight: u64 = <u64>(1 + fb.reviewer_kyc_level);
    weightedSum += <u64>fb.score * weight;
    totalWeight += weight * 5; // Normalize to 5-star scale
  }

  const reputationScore: u64 = totalWeight > 0
    ? (weightedSum * 40) / totalWeight
    : 0;

  // Longevity score (0-10 points, 1 point per month, max 10)
  const monthsActive = (currentTimeSec() - agent.registered_at) / 2592000;
  const longevityScore: u64 = min(monthsActive, 10);

  // Total: 0-100
  return kycScore + stakeScore + reputationScore + longevityScore;
}
```

### Trust Score Breakdown

| Component | Max Points | Source |
|-----------|------------|--------|
| KYC Level | 30 | Native XPR Network KYC (0-3) × 10 |
| Stake | 20 | Agent's staked XPR (caps at 10,000) |
| Reputation | 40 | KYC-weighted feedback scores |
| Longevity | 10 | 1 point per month (max 10) |
| **Total** | **100** | |

## Plugin System

The plugin system enables modular capabilities for agents.

### Plugin Categories

| Category | Description | Examples |
|----------|-------------|----------|
| `compute` | Computation tasks | Code execution, data processing |
| `storage` | Data persistence | IPFS pinning, database ops |
| `oracle` | External data | Price feeds, weather, APIs |
| `payment` | Financial ops | Token transfers, escrow |
| `messaging` | Communication | Notifications, webhooks |
| `ai` | AI/ML tasks | Inference, embeddings |

### Plugin Interface

```typescript
// Standard plugin action signature
@action("execute")
execute(
  caller: Name,           // Agent calling the plugin
  job_id: u64,           // Job reference
  params: string         // JSON parameters per schema
): void {
  requireAuth(caller);

  // Verify caller is registered agent
  const agentTable = new TableStore<Agent>(
    Name.fromString("agentcore")
  );
  const agent = agentTable.get(caller.N);
  check(agent !== null, "Caller not a registered agent");

  // Plugin-specific logic...

  // Emit result via inline action
  const result = new InlineAction<PluginResult>("agentcore", "pluginres");
  result.send(
    [new PermissionLevel(this.receiver, Name.fromString("active"))],
    new PluginResult(caller, job_id, "success", resultData)
  );
}
```

### Built-in Plugin Examples

```typescript
// Price Oracle Plugin
@table("priceplugin", singleton)
class PricePluginConfig extends Table {
  constructor(
    public oracle_contract: Name = Name.fromString("oracles"),
    public supported_pairs: string = '["BTCUSD","ETHUSD","XPRUSD"]'
  ) { super(); }
}

// IPFS Storage Plugin
@table("ipfsplugin", singleton)
class IPFSPluginConfig extends Table {
  constructor(
    public gateway_url: string = "https://gateway.pinata.cloud/ipfs/",
    public max_size_bytes: u64 = 10485760 // 10MB
  ) { super(); }
}

// Payment Escrow Plugin
@table("escrows")
class Escrow extends Table {
  constructor(
    public id: u64 = 0,
    public payer: Name = new Name(),
    public agent: Name = new Name(),
    public amount: Asset = new Asset(),
    public job_hash: string = "",
    public status: u8 = 0, // 0=pending, 1=released, 2=refunded
    public created_at: u64 = 0
  ) { super(); }

  @primary
  get primary(): u64 { return this.id; }
}
```

## Implementation Steps

### Phase 1: Core Contracts
- `agentcore.contract.ts` - Agent registration, staking, plugin management
- `agentfeed.contract.ts` - Feedback submission, score calculation
- `agentvalid.contract.ts` - Validator registration, output validation

### Phase 2: TypeScript SDK
- `AgentRegistry` class for contract interactions
- Type definitions for all tables
- Helper functions for trust score queries

### Phase 3: React Frontend
- Agent discovery/search interface
- Registration flow with KYC integration
- Feedback submission UI
- Plugin marketplace

### Phase 4: Hyperion Indexer
- Real-time event streaming
- Fast agent queries by capability
- Aggregated statistics

### Phase 5: Deployment & Testing
- Testnet deployment scripts
- Integration tests
- Documentation

## Comparison: EIP-8004 vs XPR Network

| Aspect | EIP-8004 (Ethereum) | XPR Network |
|--------|---------------------|-------------|
| Identity | NFT minting (~$5-50 gas) | Account registration (free) |
| Feedback | Gas per submission | Free (zero gas) |
| Cold Start | No solution | KYC-based baseline trust |
| Account Names | 0x addresses | Human-readable (12 chars) |
| Block Time | ~12 seconds | 0.5 seconds |
| Signing | MetaMask | WebAuth (Face ID/fingerprint) |
| Real-time | Requires indexer | Native Hyperion streaming |

## Project Structure

```
xpr-agents/
├── CLAUDE.md                    # This file
├── contracts/
│   ├── agentcore/
│   │   └── assembly/
│   │       └── agentcore.contract.ts
│   ├── agentfeed/
│   │   └── assembly/
│   │       └── agentfeed.contract.ts
│   └── agentvalid/
│       └── assembly/
│           └── agentvalid.contract.ts
├── sdk/
│   ├── src/
│   │   ├── index.ts
│   │   ├── registry.ts
│   │   ├── feedback.ts
│   │   └── types.ts
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   └── pages/
│   └── package.json
├── indexer/
│   └── src/
│       └── index.ts
└── scripts/
    ├── deploy-testnet.sh
    └── test-contracts.sh
```

## Quick Start

```bash
# Clone and install
git clone https://github.com/your-org/xpr-agents
cd xpr-agents

# Build contracts
cd contracts/agentcore && npm install && npm run build
cd ../agentfeed && npm install && npm run build
cd ../agentvalid && npm install && npm run build

# Deploy to testnet
proton chain:set proton-test
./scripts/deploy-testnet.sh

# Run SDK tests
cd sdk && npm test
```

## Resources

- [XPR Network Docs](https://docs.xprnetwork.org)
- [EIP-8004 Specification](https://eips.ethereum.org/EIPS/eip-8004)
- [proton-tsc Documentation](https://github.com/XPRNetwork/ts-smart-contracts)
- [Hyperion API Docs](https://hyperion.docs.eosrio.io/)
