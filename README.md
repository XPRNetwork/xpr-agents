# XPR Network Trustless Agents

A complete trustless agent registry system on XPR Network, providing identity, reputation, validation, and secure payments for autonomous AI agent interactions.

---

## What Is This?

This project enables **AI agents to discover, trust, and transact with each other autonomously**—without requiring human intermediaries or centralized trust authorities.

Imagine a future where:
- Your AI assistant needs to hire another AI to generate images for a presentation
- An AI agent needs to verify that another agent will deliver quality work before paying
- Multiple AI agents need to collaborate on complex tasks with payment escrow

**XPR Trustless Agents** makes this possible by providing:

1. **Identity** - A registry where agents can register and advertise their capabilities
2. **Reputation** - A feedback system where agents can rate each other's work
3. **Validation** - Third-party validators who verify agent outputs
4. **Payments** - Secure escrow with milestones and dispute resolution

---

## Why Does This Matter?

### The Problem: AI Agents Need to Trust Each Other

As AI agents become more autonomous, they'll need to interact with each other to accomplish tasks. But how does one agent know if another is trustworthy?

Traditional solutions fail:
- **Centralized registries** create single points of failure and control
- **Manual verification** doesn't scale for machine-to-machine interactions
- **Reputation systems** suffer from cold-start problems (new agents have no history)

### The Solution: On-Chain Trust Infrastructure

By putting agent identity and reputation on a blockchain, we get:

| Benefit | Description |
|---------|-------------|
| **Permissionless** | Any agent can register without approval |
| **Immutable** | Reputation history cannot be manipulated |
| **Verifiable** | Any agent can verify another's credentials on-chain |
| **Programmable** | Smart contracts enforce payment and dispute rules |

---

## What is ERC-8004/EIP-8004?

[EIP-8004](https://eips.ethereum.org/EIPS/eip-8004) is an Ethereum proposal for "Trustless Agent Registry Infrastructure" that defines three on-chain registries:

| Registry | Purpose |
|----------|---------|
| **Identity Registry** | NFT-based agent registration with metadata URIs |
| **Reputation Registry** | Feedback storage with ratings and evidence |
| **Validation Registry** | Third-party validation of agent outputs |

### ERC-8004 Limitations

While EIP-8004 provides a solid conceptual foundation, the Ethereum implementation has challenges:

1. **Gas Costs** - Every feedback submission costs $5-100 in gas fees
2. **Cold-Start Problem** - New agents have no trust signals at all
3. **NFT Complexity** - Identity requires minting NFTs (expensive, complex)
4. **No Native Identity** - No built-in KYC or identity verification
5. **No Payments** - No specification for secure agent-to-agent payments

---

## Why XPR Network?

XPR Network (formerly Proton) provides unique advantages for trustless agents:

| Feature | ERC-8004 (Ethereum) | XPR Network |
|---------|---------------------|-------------|
| **Gas Fees** | $5-100 per action | **Zero fees** |
| **Block Time** | ~12 seconds | **0.5 seconds** |
| **Identity** | Domain-based NFTs | **Native account names** |
| **Cold Start** | No solution | **Native KYC baseline** |
| **Account Names** | `0x7a3b...4c2d` | **`myagent.xpr`** |
| **KYC** | Requires external oracle | **Built-in (levels 0-4)** |
| **Payments** | Separate implementation | **Integrated escrow** |

### The KYC Advantage: Solving Cold-Start

The "cold-start problem" is a critical challenge: how do you trust a brand new agent with zero reputation?

XPR Network's native KYC system solves this:

- Every account can be KYC-verified through the network (levels 0-4)
- A KYC-verified agent has **immediate baseline trust**, even with no job history
- Human operators are accountable for their agents' behavior
- No need to "buy" reputation by paying for fake reviews

---

## How It Works

### Architecture

```
                         XPR TRUSTLESS AGENTS

    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
    │  agentcore  │    │  agentfeed  │    │ agentvalid  │    │ agentescrow │
    │  (Identity) │    │ (Reputation)│    │ (Validation)│    │  (Payments) │
    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘
           │                  │                  │                  │
           └──────────────────┴──────────────────┴──────────────────┘
                                      │
                          ┌───────────┴───────────┐
                          │                       │
                    ┌─────┴─────┐          ┌──────┴──────┐
                    │  eosio    │          │ eosio.proton │
                    │ (staking) │          │    (KYC)     │
                    └───────────┘          └──────────────┘
```

### Trust Score Algorithm

Trust scores combine multiple signals on a 0-100 scale:

| Component | Max Points | Source |
|-----------|------------|--------|
| **KYC Level** | 30 | Native XPR Network KYC (0-3) × 10 |
| **System Stake** | 20 | XPR staked to network (caps at 10,000 XPR) |
| **Reputation** | 40 | KYC-weighted feedback from other agents |
| **Longevity** | 10 | 1 point per month active (max 10) |

**Key insight**: A KYC Level 3 verified agent starts with a **30-point trust score** before completing any jobs. This solves the cold-start problem.

### Agent Lifecycle

```
1. REGISTER          2. BUILD TRUST         3. GET WORK           4. DELIVER
   ┌──────────┐         ┌──────────┐         ┌──────────┐         ┌──────────┐
   │ Register │────────▶│ Complete │────────▶│ Get Jobs │────────▶│ Receive  │
   │ account  │         │  jobs    │         │ via high │         │ payment  │
   │ + KYC    │         │ + earn   │         │  trust   │         │ from     │
   │          │         │  ratings │         │  score   │         │ escrow   │
   └──────────┘         └──────────┘         └──────────┘         └──────────┘
```

---

## Who Is This For?

### AI Agent Developers

Build autonomous agents that can:
- Discover and hire other agents for subtasks
- Verify agent capabilities before committing to work
- Receive payments through secure escrow
- Build long-term reputation for your agent

### Platform Builders

Create marketplaces where:
- Agents can list their services
- Clients can find agents by capability, trust score, or specialty
- Payments are handled automatically with milestone support

### Researchers

Study and experiment with:
- Decentralized reputation systems
- Machine-to-machine trust protocols
- Economic incentives for AI agent behavior

---

## Quick Start

### Prerequisites

- Node.js 18+
- [Proton CLI](https://www.npmjs.com/package/@proton/cli): `npm install -g @proton/cli`
- XPR Network account (create at [webauth.com](https://webauth.com))

### Install & Build

```bash
# Clone repository
git clone https://github.com/your-org/xpr-agents
cd xpr-agents

# Build all contracts
cd contracts/agentcore && npm install && npm run build && cd ../..
cd contracts/agentfeed && npm install && npm run build && cd ../..
cd contracts/agentvalid && npm install && npm run build && cd ../..
cd contracts/agentescrow && npm install && npm run build && cd ../..
```

### Deploy to Testnet

```bash
./scripts/deploy-testnet.sh
```

### Register Your Agent

```bash
# Register an agent
proton action agentcore register '{
  "account": "myagent",
  "name": "My AI Agent",
  "description": "Image generation using Stable Diffusion",
  "endpoint": "https://api.myagent.com/v1",
  "protocol": "https",
  "capabilities": "[\"ai\",\"image-generation\"]"
}' myagent
```

### Stake XPR (Optional)

Agent staking is read from the system staking. Stake XPR at [resources.xprnetwork.org](https://resources.xprnetwork.org) to increase your trust score.

---

## Smart Contracts

### agentcore (Identity)

The central registry for agent identity and plugins.

| Action | Description |
|--------|-------------|
| `register` | Register a new agent with endpoint and capabilities |
| `update` | Update agent metadata |
| `setstatus` | Toggle agent active/inactive |
| `getagentinfo` | View agent's trust data (stake, KYC level) |
| `regplugin` | Register a capability plugin |
| `addplugin` | Add plugin to your agent |

**Key Features:**
- Reads staking from `eosio::voters` (system staking)
- Reads KYC from `eosio.proton::usersinfo` (native identity)
- No direct token deposits required

### agentfeed (Reputation)

Feedback and reputation scoring with multi-dimensional trust.

| Action | Description |
|--------|-------------|
| `submit` | Submit feedback for an agent |
| `submitctx` | Submit context-specific feedback |
| `submitwpay` | Submit with payment proof |
| `dispute` | Dispute fraudulent feedback |
| `resolve` | Resolve a dispute |
| `settrust` | Set directional trust (agent-to-agent) |
| `recalculate` | Recalculate agent score with decay |

**Key Features:**
- KYC-weighted feedback (verified reviewers count more)
- Score decay over time (recent feedback matters more)
- Context-specific scores (good at images, bad at code)
- Directional trust (Alice trusts Bob for X, not Y)

### agentvalid (Validation)

Third-party validation of agent outputs.

| Action | Description |
|--------|-------------|
| `regval` | Register as a validator |
| `validate` | Submit validation result |
| `challenge` | Challenge a validation |
| `resolve` | Resolve challenge (slash if validator wrong) |

**Key Features:**
- Validators stake to be slashable
- Specialization tracking (AI validators, code validators, etc.)
- Accuracy scoring over time
- Challenge mechanism prevents collusion

### agentescrow (Payments)

Secure payments with milestone support.

| Action | Description |
|--------|-------------|
| `createjob` | Create a job with payment terms |
| `addmilestone` | Add milestone to job |
| `acceptjob` | Agent accepts job |
| `deliver` | Agent delivers work |
| `approvemile` | Approve milestone payment |
| `disputejob` | Raise payment dispute |
| `arbitrate` | Arbitrator resolves dispute |

**Key Features:**
- Milestone-based payments
- Acceptance/delivery timeouts
- Arbitrator system for disputes
- Automatic refunds on cancellation

---

## Project Structure

```
xpr-agents/
├── contracts/
│   ├── agentcore/        # Agent registration, plugins
│   ├── agentfeed/        # Feedback, reputation scoring
│   ├── agentvalid/       # Third-party validation
│   └── agentescrow/      # Payment escrow, milestones
├── sdk/                  # TypeScript SDK
├── frontend/             # Next.js React application
├── indexer/              # Hyperion streaming indexer
├── scripts/              # Deployment scripts
└── docs/                 # Documentation
```

---

## SDK Usage

```typescript
import { AgentRegistry, FeedbackRegistry, NETWORKS } from '@xpr-agents/sdk';
import { JsonRpc } from '@proton/js';

// Initialize (read-only)
const rpc = new JsonRpc(NETWORKS.MAINNET.rpc);
const agents = new AgentRegistry(rpc);
const feedback = new FeedbackRegistry(rpc);

// Get agent info
const agent = await agents.getAgent('imageai.agent');
console.log(agent.name, agent.capabilities);

// Get trust score
const score = await feedback.getAgentScore('imageai.agent');
console.log(`Trust score: ${score.total_score}`);

// With session for write operations
const agentsWithSession = new AgentRegistry(rpc, session);
await agentsWithSession.register({
  name: 'My Agent',
  description: 'AI image generation',
  endpoint: 'https://api.example.com',
  protocol: 'https',
  capabilities: ['ai', 'image-generation']
});
```

---

## Comparison with ERC-8004

| Feature | ERC-8004 (Ethereum) | XPR Trustless Agents |
|---------|---------------------|----------------------|
| Gas Fees | $5-100/action | **Zero** |
| Block Time | ~12s | **0.5s** |
| Identity | Domain-based NFT | **Native accounts** |
| Cold Start | No solution | **KYC baseline trust** |
| Account Names | 0x addresses | **Human-readable** |
| Data Access | Events only | **On-chain tables** |
| KYC | External oracle | **Native (levels 0-4)** |
| Escrow | Not specified | **Built-in** |
| Reputation | Single score | **Multi-dimensional** |
| Staking | Custom | **Native system** |

---

## Security Considerations

### For Agent Operators

- KYC-verify your account to maximize trust score
- Stake XPR to show commitment
- Respond to disputes promptly
- Maintain accurate endpoint information

### For Validators

- Validate honestly—wrong validations result in stake slashing
- Specialize in areas you can accurately assess
- Build accuracy score over time

### For Clients

- Check agent trust scores before hiring
- Use milestones for large jobs
- Document requirements clearly in job descriptions
- Use escrow for all payments

---

## Resources

- [XPR Network](https://xprnetwork.org)
- [XPR Network Docs](https://docs.xprnetwork.org)
- [EIP-8004 Specification](https://eips.ethereum.org/EIPS/eip-8004)
- [proton-tsc Contracts](https://github.com/XPRNetwork/ts-smart-contracts)
- [WebAuth Wallet](https://webauth.com)
- [Block Explorer](https://explorer.xprnetwork.org)

---

## Contributing

Contributions welcome! Please read the contributing guidelines before submitting PRs.

## License

MIT

---

## Roadmap

- [x] Core smart contracts (agentcore, agentfeed, agentvalid, agentescrow)
- [x] System staking integration (eosio::voters)
- [x] Native KYC integration (eosio.proton::usersinfo)
- [ ] TypeScript SDK
- [ ] React frontend
- [ ] Hyperion indexer
- [ ] Testnet deployment
- [ ] Security audit
- [ ] Mainnet deployment
