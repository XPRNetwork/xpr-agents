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

### Four-Contract System

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           XPR AGENT REGISTRY                                  │
├─────────────────┬─────────────────┬─────────────────┬────────────────────────┤
│   agentcore     │   agentfeed     │   agentvalid    │     agentescrow        │
│   (Identity)    │   (Reputation)  │   (Validation)  │     (Payments)         │
├─────────────────┼─────────────────┼─────────────────┼────────────────────────┤
│ • Agent reg     │ • Feedback      │ • Validator reg │ • Job management       │
│ • Metadata      │ • Ratings       │ • Validations   │ • Milestone payments   │
│ • Capabilities  │ • Evidence URIs │ • Challenges    │ • Dispute resolution   │
│ • Plugins       │ • KYC-weighted  │ • Accuracy      │ • Arbitrator registry  │
└─────────────────┴─────────────────┴─────────────────┴────────────────────────┘
```

### Staking Model

| Entity | Staking Method | Slashable | Purpose |
|--------|---------------|-----------|---------|
| **Agents** | System staking (`eosio::voters`) | No | Skin-in-game, trust signal |
| **Validators** | Contract staking (`agentvalid`) | Yes | Penalize incorrect validations |
| **Arbitrators** | Contract staking (`agentescrow`) | No | Ensure availability |

### Table Definitions

#### agentcore Contract

```typescript
@table("agents")
export class Agent extends Table {
  constructor(
    public account: Name = new Name(),      // Primary key (human-readable)
    public owner: Name = new Name(),        // KYC'd human who sponsors this agent
    public pending_owner: Name = new Name(), // Approved claimant (2-step flow)
    public name: string = "",               // Display name
    public description: string = "",        // Agent description
    public endpoint: string = "",           // API endpoint URL
    public protocol: string = "",           // Communication protocol
    public capabilities: string = "",       // JSON array of capabilities
    public total_jobs: u64 = 0,             // Completed job count
    public registered_at: u64 = 0,          // Registration timestamp
    public active: boolean = true,          // Active status
    public claim_deposit: u64 = 0,          // Refundable deposit paid when claiming
    public deposit_payer: Name = new Name() // Who paid the deposit (for refund tracking)
  ) { super(); }

  @primary
  get primary(): u64 { return this.account.N; }

  @secondary
  get byOwner(): u64 { return this.owner.N; }
}

// Ownership Flow:
// 1. approveclaim - Agent approves a KYC'd human to claim them
// 2. transfer XPR with memo "claim:agent:owner" - Pay claim deposit
// 3. claim - Human completes the claim
// 4. transfer - Transfer ownership (requires 3 signatures: owner, new_owner, agent)
// 5. release - Owner releases agent (deposit refunded to original payer)
// 6. verifyclaim - Anyone can trigger KYC re-verification

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
    public avg_score: u64 = 0,              // Weighted average (0-10000 = 0-100.00%)
    public last_updated: u64 = 0            // Last calculation time
  ) { super(); }

  @primary
  get primary(): u64 { return this.agent.N; }
}

@table("recalcstate")
export class RecalcState extends Table {
  constructor(
    public agent: Name = new Name(),        // Agent being recalculated
    public total_score: u64 = 0,            // Running sum of weighted scores
    public total_weight: u64 = 0,           // Running sum of weights
    public feedback_count: u64 = 0,         // Running count
    public next_offset: u64 = 0,            // Next feedback ID to process
    public started_at: u64 = 0,             // When recalculation started
    public expires_at: u64 = 0              // Must complete before this time
  ) { super(); }

  @primary
  get primary(): u64 { return this.agent.N; }
}
// Note: RecalcState enables paginated recalculation to prevent score corruption.
// Scores are only committed to agentscores when recalculation completes fully.
// Incomplete recalculations can be cancelled via cancelRecalculation() action.
```

#### agentvalid Contract

```typescript
@table("validators")
export class Validator extends Table {
  constructor(
    public account: Name = new Name(),      // Validator account
    public stake: u64 = 0,                  // Staked amount (slashable)
    public method: string = "",             // Validation method description
    public specializations: string = "",    // JSON array of specialties
    public total_validations: u64 = 0,      // Validation count
    public incorrect_validations: u64 = 0,  // Failed validations (for accuracy)
    public accuracy_score: u64 = 10000,     // Accuracy (0-10000 = 0-100.00%)
    public pending_challenges: u64 = 0,    // Active funded challenges (blocks unstaking)
    public registered_at: u64 = 0,          // Registration time
    public active: boolean = true           // Active status
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
    public challenged: boolean = false,     // Has active challenge
    public timestamp: u64 = 0               // Validation time
  ) { super(); }

  @primary
  get primary(): u64 { return this.id; }

  @secondary
  get byAgent(): u64 { return this.agent.N; }
}

@table("challenges")
export class Challenge extends Table {
  constructor(
    public id: u64 = 0,                     // Primary key
    public validation_id: u64 = 0,          // Validation being challenged
    public challenger: Name = new Name(),   // Who raised the challenge
    public reason: string = "",             // Challenge reason
    public evidence_uri: string = "",       // Evidence URI
    public stake: u64 = 0,                  // Challenger's stake
    public funding_deadline: u64 = 0,       // Must fund within 24 hours
    public status: u8 = 0,                  // 0=pending, 1=upheld, 2=rejected, 3=cancelled
    public resolver: Name = new Name(),     // Who resolved
    public resolution_notes: string = "",   // Resolution explanation
    public created_at: u64 = 0,
    public resolved_at: u64 = 0
  ) { super(); }

  @primary
  get primary(): u64 { return this.id; }
}
```

**Accuracy Calculation:**
- Accuracy is only calculated after `MIN_VALIDATIONS_FOR_ACCURACY` (5) validations
- Formula: `accuracy = (total - incorrect) * 10000 / total`
- New validators start at 100% (10000) until they have enough sample size

#### agentescrow Contract

```typescript
@table("jobs")
export class Job extends Table {
  constructor(
    public id: u64 = 0,                     // Primary key
    public client: Name = new Name(),       // Job creator/payer
    public agent: Name = new Name(),        // Assigned agent (EMPTY_NAME = open for bids)
    public title: string = "",              // Job title
    public description: string = "",        // Job description
    public deliverables: string = "",       // JSON array of deliverables
    public amount: u64 = 0,                 // Total job amount
    public symbol: string = "XPR",          // Token symbol string
    public funded_amount: u64 = 0,          // Amount funded so far
    public released_amount: u64 = 0,        // Amount released to agent
    public state: u8 = 0,                   // Job state (see below)
    public deadline: u64 = 0,               // Completion deadline
    public arbitrator: Name = new Name(),   // Assigned arbitrator
    public job_hash: string = "",           // Content hash for verification
    public created_at: u64 = 0,
    public updated_at: u64 = 0
  ) { super(); }

  @primary
  get primary(): u64 { return this.id; }
}

// Job States:
// 0 = CREATED     - Job created, awaiting funding
// 1 = FUNDED      - Funds deposited
// 2 = ACCEPTED    - Agent accepted
// 3 = INPROGRESS  - Work in progress
// 4 = DELIVERED   - Agent submitted deliverables
// 5 = DISPUTED    - Under dispute
// 6 = COMPLETED   - Approved, agent paid
// 7 = REFUNDED    - Cancelled, client refunded
// 8 = ARBITRATED  - Resolved by arbitrator

// Job Types:
// - Direct-hire: agent is set at creation → client funds → agent accepts
// - Open job board: agent=EMPTY_NAME → agents submit bids → client selects bid → agent is assigned

@table("bids")
export class Bid extends Table {
  constructor(
    public id: u64 = 0,                     // Primary key
    public job_id: u64 = 0,                 // Job being bid on
    public agent: Name = new Name(),        // Agent submitting the bid
    public amount: u64 = 0,                 // Proposed amount
    public timeline: u64 = 0,               // Proposed completion time (seconds)
    public proposal: string = "",           // Agent's proposal text
    public created_at: u64 = 0
  ) { super(); }

  @primary
  get primary(): u64 { return this.id; }

  @secondary
  get byJob(): u64 { return this.job_id; }

  @secondary
  get byAgent(): u64 { return this.agent.N; }
}

// Bidding Actions:
// submitbid  - Agent submits a bid on an open job
// selectbid  - Client selects a winning bid (assigns agent, updates amount/deadline)
// withdrawbid - Agent withdraws their bid

@table("milestones")
export class Milestone extends Table {
  constructor(
    public id: u64 = 0,                     // Primary key
    public job_id: u64 = 0,                 // Parent job
    public title: string = "",              // Milestone title
    public description: string = "",        // Milestone description
    public amount: u64 = 0,                 // Payment for this milestone
    public order: u8 = 0,                   // Sequence order
    public state: u8 = 0,                   // 0=pending, 1=submitted, 2=approved
    public evidence_uri: string = "",       // Submission evidence
    public submitted_at: u64 = 0,
    public approved_at: u64 = 0
  ) { super(); }

  @primary
  get primary(): u64 { return this.id; }
}

@table("arbitrators")
export class Arbitrator extends Table {
  constructor(
    public account: Name = new Name(),      // Arbitrator account
    public stake: u64 = 0,                  // Staked amount
    public fee_percent: u64 = 0,            // Fee in basis points (200 = 2%)
    public total_cases: u64 = 0,            // Cases handled
    public successful_cases: u64 = 0,       // Successfully resolved
    public active: boolean = false          // Available for new cases
  ) { super(); }

  @primary
  get primary(): u64 { return this.account.N; }
}

@table("disputes")
export class Dispute extends Table {
  constructor(
    public id: u64 = 0,                     // Primary key
    public job_id: u64 = 0,                 // Disputed job
    public raised_by: Name = new Name(),    // Who raised dispute
    public reason: string = "",             // Dispute reason
    public evidence_uri: string = "",       // Evidence
    public client_amount: u64 = 0,          // Amount to client (after resolution)
    public agent_amount: u64 = 0,           // Amount to agent (after resolution)
    public resolution: u8 = 0,              // 0=pending, 1=client, 2=agent, 3=split
    public resolver: Name = new Name(),
    public resolution_notes: string = "",
    public created_at: u64 = 0,
    public resolved_at: u64 = 0
  ) { super(); }

  @primary
  get primary(): u64 { return this.id; }
}

@table("arbunstakes")
export class ArbUnstake extends Table {
  constructor(
    public account: Name = new Name(),      // Arbitrator account
    public amount: u64 = 0,                 // Amount being unstaked
    public requested_at: u64 = 0,           // When unstake was requested
    public available_at: u64 = 0            // When funds can be withdrawn
  ) { super(); }

  @primary
  get primary(): u64 { return this.account.N; }
}
// Note: Arbitrator unstaking has a time delay (ARB_UNSTAKE_DELAY_SECONDS = 7 days).
// Arbitrators call unstakearb() to request, wait for delay, then withdrawarb() to claim.
// cancelunstk() can cancel a pending unstake and return stake to active status.
//
// Dispute Resolution Fallback:
// If a job has no designated arbitrator (arbitrator == EMPTY_NAME), the contract owner
// acts as fallback arbitrator with 0% fee. This prevents funds from being permanently
// trapped in disputes on arbitrator-less jobs.
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

## Implementation Status

All phases are complete:

### Phase 1: Core Contracts ✓
- `agentcore.contract.ts` - Agent registration, system staking, plugin management
- `agentfeed.contract.ts` - Feedback submission, KYC-weighted scoring, disputes
- `agentvalid.contract.ts` - Validator registration, validations, challenges
- `agentescrow.contract.ts` - Job escrow, milestones, arbitration

### Phase 2: TypeScript SDK ✓
- `AgentRegistry` - Agent CRUD operations
- `FeedbackRegistry` - Feedback and dispute management
- `ValidationRegistry` - Validator and challenge operations
- `EscrowRegistry` - Job and milestone management
- Full type definitions for all tables

### Phase 3: React Frontend ✓
- Agent discovery with filtering
- Registration and profile management
- Feedback submission UI
- ProtonWebSDK singleton integration

### Phase 4: Hyperion Indexer ✓
- Real-time event streaming for all 4 contracts
- Token transfer tracking (staking, funding, releases)
- SQLite database with comprehensive schema
- REST API for queries

### Phase 5: Deployment & Testing ✓
- Testnet deployment scripts
- Comprehensive test-actions.sh
- Documentation (MODEL.md, analysis reports)

### Phase 6: OpenClaw Plugin ✓
- `openclaw/` plugin package (`@xpr-agents/openclaw`) with 54 MCP tools (29 read, 25 write)
- Session factory for server-side signing via `@proton/js`
- Confirmation gate for high-risk write operations (11 tools require confirmation)
- `maxTransferAmount` enforcement on all XPR transfer/stake/fee operations
- Agent operator skill (`skills/xpr-agent-operator/SKILL.md`)
- Indexer webhook system (subscriptions, async dispatch with retry, auto-disable)
- Standalone agent runner (`starter/agent/`) — Express webhook listener with Claude agentic loop
- Single-command starter kit: `./setup.sh --account X --key X --api-key X` with interactive wizard

### Phase 7: A2A Protocol ✓
- A2A types in SDK (`A2ATask`, `A2AMessage`, `XprAgentCard`, etc.)
- `A2AClient` — JSON-RPC 2.0 client for agent discovery, messaging, task management
- Agent runner A2A server — `GET /.well-known/agent.json` + `POST /a2a` JSON-RPC endpoint
- 5 OpenClaw A2A tools: discover, send_message, get_task, cancel_task, delegate_job
- Protocol spec: `docs/A2A.md` — compatible with Google A2A, XPR extensions for on-chain identity

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
├── MODEL.md                     # Data model documentation
├── README.md                    # Project overview
├── docs/
│   └── A2A.md                   # A2A protocol specification
├── contracts/
│   ├── agentcore/
│   │   └── assembly/
│   │       └── agentcore.contract.ts
│   ├── agentfeed/
│   │   └── assembly/
│   │       └── agentfeed.contract.ts
│   ├── agentvalid/
│   │   └── assembly/
│   │       └── agentvalid.contract.ts
│   └── agentescrow/
│       └── assembly/
│           └── agentescrow.contract.ts
├── sdk/
│   ├── src/
│   │   ├── index.ts
│   │   ├── AgentRegistry.ts
│   │   ├── FeedbackRegistry.ts
│   │   ├── ValidationRegistry.ts
│   │   ├── EscrowRegistry.ts
│   │   ├── A2AClient.ts          # A2A JSON-RPC client
│   │   ├── types.ts
│   │   └── utils.ts
│   └── package.json
├── openclaw/                    # OpenClaw plugin package
│   ├── openclaw.plugin.json     # Plugin manifest
│   ├── src/
│   │   ├── index.ts             # Plugin entry, registers 54 tools
│   │   ├── session.ts           # ProtonSession factory from env vars
│   │   ├── types.ts             # Plugin config/API interfaces
│   │   ├── tools/
│   │   │   ├── agent.ts         # 10 agentcore tools
│   │   │   ├── feedback.ts      # 7 agentfeed tools
│   │   │   ├── validation.ts    # 9 agentvalid tools
│   │   │   ├── escrow.ts        # 13 agentescrow tools
│   │   │   ├── indexer.ts       # 4 indexer query tools
│   │   │   └── a2a.ts           # 5 A2A protocol tools
│   │   └── util/
│   │       ├── validate.ts      # Input validation helpers
│   │       └── confirm.ts       # Confirmation gate logic
│   ├── skills/
│   │   └── xpr-agent-operator/
│   │       └── SKILL.md         # Agent operator role behavior
│   ├── starter/                 # Single-command deployment kit
│   │   ├── setup.sh             # Interactive/CLI setup wizard
│   │   ├── docker-compose.yml   # Indexer + agent runner services
│   │   ├── .env.example         # Configuration template
│   │   ├── README.md            # Deployment documentation
│   │   └── agent/               # Autonomous agent runner
│   │       ├── package.json
│   │       ├── Dockerfile
│   │       └── src/
│   │           └── index.ts     # Webhook listener + Claude agentic loop
│   └── tests/
│       ├── tools.test.ts
│       ├── confirm.test.ts
│       └── validate.test.ts
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   │   └── useProton.ts     # Singleton SDK hook
│   │   └── pages/
│   └── package.json
├── indexer/
│   └── src/
│       ├── index.ts             # Entry point, stream routing
│       ├── stream.ts            # Hyperion WebSocket
│       ├── handlers/
│       │   ├── agent.ts
│       │   ├── feedback.ts
│       │   ├── validation.ts
│       │   └── escrow.ts
│       ├── webhooks/
│       │   └── dispatcher.ts    # Webhook dispatch with retry
│       ├── db/
│       │   └── schema.ts        # SQLite schema + webhook tables
│       └── api/
│           └── routes.ts        # REST endpoints + webhook CRUD
└── scripts/
    ├── deploy-testnet.sh
    └── test-actions.sh
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

# Run all tests (456 total)
cd sdk && npm test                       # 183 tests (Jest)
cd contracts/agentcore && npm test       # 67 tests (ts-mocha + @proton/vert)
cd contracts/agentfeed && npm test       # 44 tests
cd contracts/agentvalid && npm test      # 37 tests
cd contracts/agentescrow && npm test     # 45 tests
cd openclaw && npx vitest run            # 52 tests (vitest)
cd indexer && npm test                   # 28 tests (vitest)
```

## Indexer Notes

### Synthetic ID Mapping

The indexer uses synthetic IDs (`MAX(id) + 1`) for records like jobs, challenges, and disputes. This works correctly when:
- The indexer starts from genesis (block 1)
- OR the indexer is seeded with a snapshot that matches chain state

**Important:** If the indexer misses blocks or starts mid-stream, its IDs will drift from on-chain IDs, causing resolution lookups to fail.

### Snapshot Seeding

To avoid ID drift when deploying a new indexer:

1. **Option A: Replay from genesis**
   ```bash
   # Clear database and replay all history
   rm ./data/agents.db
   # Start indexer - it will replay from first block
   npm start
   ```

2. **Option B: Seed from chain state**
   ```bash
   # Export current chain state for all tables
   proton table agentcore agents --limit 1000 > agents.json
   proton table agentfeed feedback --limit 10000 > feedback.json
   proton table agentvalid validators --limit 1000 > validators.json
   proton table agentvalid validations --limit 10000 > validations.json
   proton table agentvalid challenges --limit 1000 > challenges.json
   proton table agentescrow jobs --limit 10000 > jobs.json
   proton table agentescrow disputes --limit 1000 > disputes.json
   proton table agentescrow milestones --limit 10000 > milestones.json
   proton table agentescrow arbitrators --limit 100 > arbitrators.json

   # Import into SQLite (use provided seed script)
   ./scripts/seed-indexer.sh
   ```

3. **Option C: Use Hyperion history API**
   ```bash
   # Fetch historical actions and replay
   curl "https://proton.eosusa.io/v2/history/get_actions?account=agentcore&limit=10000" \
     | node scripts/replay-history.js
   ```

### Escrow Accounting

The indexer tracks two amounts for jobs:
- `funded_amount`: Incremented when tokens arrive with `fund:JOB_ID` memo, decremented on overfunding refunds
- `released_amount`: Set by terminal state actions (approve, arbitrate, cancel, timeout) and milestone approvals

Transfer-based release tracking was removed to prevent double-counting with action handlers.

## Resources

- [XPR Network Docs](https://docs.xprnetwork.org)
- [EIP-8004 Specification](https://eips.ethereum.org/EIPS/eip-8004)
- [proton-tsc Documentation](https://github.com/XPRNetwork/ts-smart-contracts)
- [Hyperion API Docs](https://hyperion.docs.eosrio.io/)
