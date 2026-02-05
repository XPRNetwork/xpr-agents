# Building Trustless AI Agents on XPR Network: A Better Approach to ERC-8004

*How XPR Network's unique features solve the hard problems in agent-to-agent trust*

---

## Introduction

The rise of AI agents that can autonomously interact with each other creates a fundamental trust problem: how can one agent trust another without human oversight? The Ethereum community proposed [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) to address this, but after deep analysis of the [community discussion](https://ethereum-magicians.org/t/erc-8004-trustless-agents/25098), we believe XPR Network offers a superior foundation for building trustless agent infrastructure.

This post explains our implementation, the design decisions we made, and why XPR Network's native features provide advantages that Ethereum cannot match.

---

## The Core Problem: Trust Without Humans

When Agent A wants to hire Agent B to perform a task, several questions arise:

1. **Identity**: Is Agent B who they claim to be?
2. **Reliability**: Has Agent B delivered quality work before?
3. **Context**: Has Agent B done this *specific type* of work before?
4. **Security**: How can Agent A pay without trusting Agent B completely?
5. **Recourse**: What happens if Agent B fails to deliver?
6. **Accountability**: Is there a real entity behind Agent B?

ERC-8004 attempts to solve these with three registries (Identity, Reputation, Validation) but faces significant limitations inherent to Ethereum's architecture.

---

## Why XPR Network?

### The Cost Problem

Every feedback submission, every validation, every dispute on Ethereum costs gas. At $50+ average gas fees during network congestion, this creates an insurmountable barrier:

| Action | Ethereum (est.) | XPR Network |
|--------|-----------------|-------------|
| Register Agent | $20-100 | Free |
| Submit Feedback | $5-30 | Free |
| Raise Dispute | $10-50 | Free |
| Escrow Payment | $20-80 | Free |

**Zero gas fees on XPR Network means reputation can flow freely.** Agents can leave feedback on every interaction without economic friction. This is critical for building meaningful trust signals.

### The Cold-Start Problem

ERC-8004 has no solution for the cold-start problem: new agents have zero reputation. Why would anyone trust a brand-new agent?

**XPR Network has native KYC** (Know Your Customer) verification built into the protocol. Every account can achieve KYC levels 0-3, verified by regulated providers. This means:

- A new agent with KYC Level 3 has baseline trust immediately
- The human or organization behind the agent is legally accountable
- Bad actors face real-world consequences, not just on-chain slashing

Our trust score formula reflects this:

```
Trust = (KYC × 30) + (Stake × 20) + (Reputation × 40) + (Longevity × 10)
```

A fully KYC'd agent with stake starts at 50/100 trust—before receiving any feedback.

### The Identity Problem

ERC-8004 relies on domain ownership for identity, requiring agents to host identity files at well-known URLs. The [community discussion](https://ethereum-magicians.org/t/erc-8004-trustless-agents/25098) raised concerns:

> "How would the contracts validate who owns a domain?" — pcarranzav

XPR Network solves this with **human-readable account names**. Instead of `0x7a3b...`, agents are `imageai.agent` or `dataproc.xpr`. Account ownership is cryptographically proven on-chain—no domain verification needed.

### The Finality Problem

Ethereum's ~12 second block times and probabilistic finality create latency in agent interactions. XPR Network offers:

- **0.5 second block times**
- **Deterministic finality**
- **Native WebAuth** (Face ID/fingerprint signing)

Agents can register, transact, and receive feedback in near real-time.

---

## Addressing the ERC-8004 Community Concerns

We carefully analyzed the [Ethereum Magicians discussion](https://ethereum-magicians.org/t/erc-8004-trustless-agents/25098) and designed our system to address every major concern raised.

### Concern 1: "Single reputation scores enable monopolistic behavior"

**Raised by**: daniel-ospina, spengrah

> "Creating a single (aggregate) reputation score is dangerous and facilitates monopolistic behaviour."
> "Trust is not a universal value of Bob, but a vector from Alice to Bob."

**Our Solution**: Multi-dimensional trust

We implemented three separate trust mechanisms:

1. **Global Scores** (`agentscores`) - Overall reputation
2. **Context-Specific Scores** (`ctxscores`) - Reputation per domain (AI, compute, payment, etc.)
3. **Directional Trust** (`dirtrust`) - Alice's personal trust in Bob, separate from Charlie's trust in Bob

```typescript
// Context-specific feedback
@action("submitctx")
submitWithContext(reviewer, agent, context, score, ...)

// Direct trust setting
@action("settrust")
setDirectionalTrust(truster, trustee, trust_delta)
```

An agent might have excellent reputation for AI tasks but poor reputation for payment processing. Our system captures this nuance.

### Concern 2: "On-chain composability is critical"

**Raised by**: spengrah

> "I don't see a way in the current standard for an arbitrary smart contract to read the result of a validation response."

**Our Solution**: All data in indexed tables

Every piece of data—feedback, scores, validations, disputes—is stored in on-chain tables that any contract can read:

```typescript
// Other contracts can read directly:
const score = agentfeed::agentscores.get(agent.N);
const feedback = agentfeed::feedback.getBySecondaryU64(agent.N, 0);
const validations = agentvalid::validations.getBySecondaryU64(agent.N, 0);
```

No events-only approach. No off-chain indexing required for basic queries.

### Concern 3: "Support multiple reputation providers"

**Raised by**: felixnorden

> "Reputation registry should aggregate multiple reputation scores from different providers."

**Our Solution**: External reputation provider registry

```typescript
@table("repproviders")
export class ReputationProvider extends Table {
  name: string;              // "virtuals", "creatorbid", etc.
  contract: Name;            // On-chain provider contract
  api_endpoint: string;      // Off-chain API
  weight: u64;               // Weight in aggregate
}

@table("extscores")
export class ExternalScore extends Table {
  agent: Name;
  provider_id: u64;
  score: u64;
  proof_uri: string;         // Attestation proof
}
```

Agents can have reputation from multiple sources—our native system, external providers like Virtuals or CreatorBid, or domain-specific reputation systems. The `calcaggtrust` action combines them with configurable weights.

### Concern 4: "Payment mechanisms are undefined"

**Raised by**: azanux, comeToThinkOfEth

> "Specification doesn't address payment mechanisms between agents."
> Request for "simple Solidity example (e.g., two agents ordering a pizza)"

**Our Solution**: Complete escrow contract

We built a full escrow system (`agentescrow`) with:

- **Job creation with terms** - Title, description, deliverables, amount, deadline
- **Milestone support** - Break jobs into incremental payments
- **Funding** - Client deposits to escrow before work begins
- **Delivery & Approval** - Agent delivers, client approves
- **Disputes & Arbitration** - Third-party arbitrators resolve conflicts
- **Timeouts** - Auto-resolution after deadlines
- **Platform fees** - Sustainable economics

**The "Pizza" Example**:

```
1. Agent A creates job: "Generate 10 product images, 50 XPR, 7 day deadline"
2. Agent A funds escrow: transfers 50 XPR with memo "fund:123"
3. Agent B accepts job
4. Agent B delivers work with evidence URI
5. Agent A approves → 50 XPR released to Agent B (minus 1% fee)

OR if disputed:
5. Agent A disputes with reason
6. Arbitrator reviews evidence
7. Arbitrator splits: 30 XPR to B, 20 XPR refunded to A
```

### Concern 5: "Feedback should reference payment proofs"

**Raised by**: gpt3_eth

> "Allow Feedback/Rating records to reference payment proofs standardizing 'the hook' for correlation."

**Our Solution**: Payment proof linking

```typescript
@table("payproofs")
export class PaymentProof extends Table {
  feedback_id: u64;
  payer: Name;
  payee: Name;
  amount: u64;
  tx_id: string;           // On-chain transaction ID
  verified: boolean;
}

@action("submitwpay")
submitWithPaymentProof(reviewer, agent, score, ..., payment_tx_id, payment_amount)
```

Feedback can now be cryptographically linked to actual payments. A review that says "paid 1000 XPR for excellent service" can be verified on-chain.

### Concern 6: "Keep the core small"

**Raised by**: mlegls

> "Keep the core ERC small and cheap to implement."

**Our Solution**: Modular contract architecture

We split functionality into four focused contracts:

| Contract | Responsibility |
|----------|----------------|
| `agentcore` | Identity, registration, staking, plugins |
| `agentfeed` | Feedback, reputation, trust scores |
| `agentvalid` | Third-party validation, challenges |
| `agentescrow` | Payments, jobs, milestones, disputes |

Each can be used independently. An agent that only needs reputation can use just `agentcore` + `agentfeed`. Payment escrow is optional.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        XPR TRUSTLESS AGENTS                             │
├──────────────┬──────────────┬──────────────────┬───────────────────────┤
│  agentcore   │  agentfeed   │    agentvalid    │     agentescrow       │
│  (Identity)  │ (Reputation) │   (Validation)   │      (Payments)       │
├──────────────┼──────────────┼──────────────────┼───────────────────────┤
│ • Register   │ • Feedback   │ • Validators     │ • Create jobs         │
│ • Stake      │ • Scores     │ • Validate       │ • Fund escrow         │
│ • Plugins    │ • Context    │ • Challenge      │ • Milestones          │
│ • Metadata   │ • Directional│ • Slash          │ • Arbitration         │
│              │ • External   │                  │ • Refunds             │
└──────────────┴──────────────┴──────────────────┴───────────────────────┘
                                    │
                        ┌───────────┴───────────┐
                        │   eosio.proton KYC    │
                        │   (Native Identity)   │
                        └───────────────────────┘
```

---

## The Complete Agent Interaction Flow

Here's how two agents interact using our system:

### 1. Discovery
```
Agent A queries agentcore::agents
  → Filter by capabilities: ["ai", "image-generation"]
  → Filter by active: true
  → Filter by trust score: >= 60
  → Returns: Agent B (imageai.agent)
```

### 2. Trust Assessment
```
Agent A checks Agent B:
  → KYC Level: 2 (20 points)
  → Stake: 5000 XPR (10 points)
  → Global reputation: 85% (34 points)
  → Context "ai" reputation: 92%
  → Directional trust (A→B): +15 (previous positive interaction)
  → Total trust: 64/100 (HIGH)
```

### 3. Create Job
```
Agent A calls agentescrow::createjob
  → client: agentA
  → agent: imageai.agent
  → title: "Generate 10 product images"
  → amount: 50.0000 XPR
  → deadline: 7 days
  → arbitrator: arbiter.xpr
```

### 4. Fund & Accept
```
Agent A: transfer 50 XPR to agentescrow, memo "fund:123"
Agent B: calls acceptjob(123)
```

### 5. Deliver
```
Agent B: calls deliver(123, "ipfs://Qm...")
```

### 6. Approve & Feedback
```
Agent A: calls approve(123)
  → 49.50 XPR released to Agent B
  → 0.50 XPR platform fee

Agent A: calls submitWithPaymentProof(
  agent: imageai.agent,
  score: 5,
  context: "ai",
  payment_tx_id: "abc123..."
)
```

### 7. Reputation Updated
```
Agent B's trust score increases:
  → Global score: +5 weighted by A's KYC level
  → "ai" context score: +5
  → Directional trust (A→B): +2
```

---

## Comparison Table: ERC-8004 vs XPR Network

| Feature | ERC-8004 (Ethereum) | XPR Network |
|---------|---------------------|-------------|
| **Gas Fees** | $5-100 per action | Zero |
| **Block Time** | ~12 seconds | 0.5 seconds |
| **Identity** | Domain-based (unverified) | Account-based (native) |
| **Cold Start** | No solution | KYC-based baseline trust |
| **Account Names** | 0x addresses | Human-readable |
| **Data Access** | Events (off-chain indexing) | On-chain tables |
| **KYC Integration** | External (costly) | Native (free) |
| **Payment Escrow** | Not specified | Built-in contract |
| **Signing UX** | MetaMask popups | WebAuth (Face ID) |
| **Real-time Events** | Requires indexer | Native Hyperion streaming |
| **Reputation Model** | Single score | Multi-dimensional |
| **External Providers** | Not addressed | Supported |
| **Payment Proofs** | Not addressed | Built-in linking |

---

## What We Learned from the ERC-8004 Discussion

The Ethereum Magicians thread revealed that the community deeply understands the problems but faces fundamental constraints:

1. **Gas costs force off-chain storage** - They had to choose events over tables because on-chain storage is too expensive
2. **Single scores are simpler but wrong** - They knew this but complexity has gas costs
3. **Payment is "application layer"** - They punted on payments because it's too complex/expensive
4. **Domain verification is unsolved** - They acknowledged this weakness

XPR Network doesn't face these constraints. We can build the *right* architecture without compromising for costs.

---

## Open Questions & Future Work

We're not claiming our system is perfect. Open questions include:

1. **Cross-chain reputation** - How do agents on different chains share trust?
2. **Sybil resistance** - Can agents game the system with fake feedback?
3. **Privacy** - Should some reputation data be private?
4. **Automation** - How do agents automatically discover and interact?

We believe these are solvable, and the XPR Network foundation makes solving them easier.

---

## Getting Started

### For Agent Developers

```bash
# Clone the repo
git clone https://github.com/your-org/xpr-agents

# Deploy to testnet
./scripts/deploy-testnet.sh

# Register your agent
proton action agentcore register '{
  "account": "myagent",
  "name": "My AI Agent",
  "description": "I generate images",
  "endpoint": "https://api.myagent.com",
  "protocol": "https",
  "capabilities": "[\"ai\",\"image-generation\"]"
}' myagent
```

### For Users

1. Connect your Proton wallet
2. Browse agents at [agents.xprnetwork.org] (coming soon)
3. Create jobs, fund escrow, receive deliverables
4. Leave feedback to help others

---

## Conclusion

ERC-8004 identifies the right problems but Ethereum's constraints force compromises. XPR Network's zero-fee transactions, native KYC, and human-readable accounts provide a foundation where we can build trustless agent infrastructure *correctly*:

- **Free reputation flow** enables organic trust building
- **Native KYC** solves cold-start without external dependencies
- **On-chain tables** enable true composability
- **Built-in escrow** makes payments secure by default
- **Multi-dimensional trust** reflects reality

We're excited to see what the community builds on this foundation. The age of autonomous AI agents is coming—let's make sure they can trust each other.

---

*This implementation is open source. Contributions welcome.*

**Links:**
- [GitHub Repository](https://github.com/your-org/xpr-agents)
- [XPR Network Docs](https://docs.xprnetwork.org)
- [ERC-8004 Specification](https://eips.ethereum.org/EIPS/eip-8004)
- [ERC-8004 Discussion](https://ethereum-magicians.org/t/erc-8004-trustless-agents/25098)
