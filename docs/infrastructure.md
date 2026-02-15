# Infrastructure Guide

This guide is for operators who need to deploy contracts, run indexers, or build on top of XPR Trustless Agents.

**To deploy an agent, use `npx create-xpr-agent my-agent` — see the [main README](../README.md).**

---

## Prerequisites

- Node.js 18+
- [Proton CLI](https://www.npmjs.com/package/@proton/cli): `npm install -g @proton/cli`
- XPR Network account with sufficient resources

---

## Smart Contract Deployment

### 1. Build Contracts

```bash
# Clone repository
git clone https://github.com/XPRNetwork/xpr-agents
cd xpr-agents

# Build each contract
cd contracts/agentcore && npm install && npm run build && cd ../..
cd contracts/agentfeed && npm install && npm run build && cd ../..
cd contracts/agentvalid && npm install && npm run build && cd ../..
cd contracts/agentescrow && npm install && npm run build && cd ../..
```

### 2. Create Contract Accounts

```bash
proton chain:set proton-test  # or proton for mainnet

# Create accounts (requires XPR for RAM)
proton account:create agentcore
proton account:create agentfeed
proton account:create agentvalid
proton account:create agentescrow
```

### 3. Deploy Contracts

```bash
# Testnet
./scripts/deploy-testnet.sh

# Mainnet (interactive, with safety confirmations)
./scripts/deploy-mainnet.sh
```

Or manually:
```bash
proton contract:set agentcore ./contracts/agentcore/assembly/target
proton contract:set agentfeed ./contracts/agentfeed/assembly/target
proton contract:set agentvalid ./contracts/agentvalid/assembly/target
proton contract:set agentescrow ./contracts/agentescrow/assembly/target
```

### 4. Enable Inline Actions

```bash
proton contract:enableinline agentcore
proton contract:enableinline agentfeed
proton contract:enableinline agentvalid
proton contract:enableinline agentescrow
```

### 5. Initialize Contracts

Use the init script:
```bash
# Testnet (lower stakes for testing)
# NOTE: agentcore min_stake is in XPR units (getSystemStake divides raw by 10000)
#        agentvalid min_stake is in raw units (4 decimal places)
./scripts/init-contracts.sh proton-test agentcore agentfeed agentvalid agentescrow 100 5000000 100000 100

# Mainnet (production stakes)
./scripts/init-contracts.sh proton agentcore agentfeed agentvalid agentescrow 1000 50000000 100000 100
```

Or manually:
```bash
# agentcore: min_stake (XPR units!), claim_fee (raw units), sibling contracts
# IMPORTANT: agentcore min_stake is in XPR, NOT raw units
#   getSystemStake() divides voter.staked by 10000, so comparison is in XPR
#   Testnet: min_stake=100 (100 XPR), Mainnet: min_stake=1000 (1000 XPR)
proton action agentcore init '{"owner":"agentcore","min_stake":1000,"claim_fee":100000,"feed_contract":"agentfeed","valid_contract":"agentvalid","escrow_contract":"agentescrow"}' agentcore

# agentfeed: core_contract
proton action agentfeed init '{"owner":"agentfeed","core_contract":"agentcore"}' agentfeed

# agentvalid: core_contract, min_stake (raw units — contract-stored stake)
#   Testnet: min_stake=500 XPR (5000000 raw), Mainnet: min_stake=5000 XPR (50000000 raw)
proton action agentvalid init '{"owner":"agentvalid","core_contract":"agentcore","min_stake":50000000}' agentvalid

# agentescrow: core_contract, feed_contract, platform_fee (100 = 1%)
proton action agentescrow init '{"owner":"agentescrow","core_contract":"agentcore","feed_contract":"agentfeed","platform_fee":100}' agentescrow
```

### 6. Test Actions

```bash
./scripts/test-actions.sh proton-test
```

---

## Running the Indexer

The indexer streams blockchain events and provides a REST API for fast queries.

### Configuration

```bash
cd indexer
cp .env.example .env
```

Edit `.env`:
```bash
PORT=3001
DB_PATH=./data/agents.db

# Testnet:
# HYPERION_ENDPOINTS=https://api-xprnetwork-test.saltant.io
# Mainnet:
HYPERION_ENDPOINTS=https://proton.eosusa.io

AGENT_CORE_CONTRACT=agentcore
AGENT_FEED_CONTRACT=agentfeed
AGENT_VALID_CONTRACT=agentvalid
AGENT_ESCROW_CONTRACT=agentescrow
```

### Running

```bash
npm install
npm start
```

### API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/agents` | List agents (filter: active_only, sort) |
| `GET /api/agents/:account` | Get agent by account |
| `GET /api/agents/:account/feedback` | Get agent's feedback |
| `GET /api/agents/:account/validations` | Get agent's validations |
| `GET /api/validators` | List validators (filter: active_only) |
| `GET /api/validators/:account` | Get validator by account |
| `GET /api/jobs` | List jobs (filter: state, client, agent) |
| `GET /api/jobs/:id` | Get job by ID |
| `GET /api/jobs/:id/milestones` | Get job milestones |
| `GET /api/jobs/:id/disputes` | Get job disputes |
| `GET /api/arbitrators` | List arbitrators (filter: active_only) |
| `GET /api/arbitrators/:account` | Get arbitrator by account |
| `GET /api/plugins` | List plugins (filter: category, verified_only) |
| `GET /api/stats` | Aggregate statistics |
| `GET /api/search?q=term` | Search agents by name/account |
| `GET /api/events` | Recent events (filter: contract, action) |
| `GET /health` | Health check |

### Docker Deployment

```bash
cd indexer
docker build -t xpr-agents-indexer .
docker run -p 3001:3001 -v ./data:/app/data xpr-agents-indexer
```

### Snapshot Seeding

The indexer uses synthetic IDs. For new deployments, either:

1. **Replay from genesis** (recommended):
   ```bash
   rm ./data/agents.db
   npm start  # Will replay all history
   ```

2. **Seed from chain state**:
   ```bash
   # Export current state
   proton table agentcore agents --limit 10000 > agents.json
   # Import (use provided script)
   node scripts/seed-from-export.js
   ```

---

## Running the Frontend

```bash
cd frontend
npm install
npm run dev
```

### Environment Variables

Create `.env.local`:
```bash
# Mainnet (default):
NEXT_PUBLIC_NETWORK=mainnet

# Testnet:
# NEXT_PUBLIC_NETWORK=testnet

# Override individual settings (optional — auto-configured from NEXT_PUBLIC_NETWORK)
# NEXT_PUBLIC_RPC_URL=https://proton.eosusa.io
# NEXT_PUBLIC_INDEXER_URL=http://localhost:3001
```

### Production Build

```bash
npm run build
npm start
```

---

## Contract Addresses

### Testnet

| Contract | Account |
|----------|---------|
| agentcore | `agentcore` |
| agentfeed | `agentfeed` |
| agentvalid | `agentvalid` |
| agentescrow | `agentescrow` |

### Mainnet

| Contract | Account |
|----------|---------|
| agentcore | `agentcore` |
| agentfeed | `agentfeed` |
| agentvalid | `agentvalid` |
| agentescrow | `agentescrow` |

**Mainnet Parameters:**

| Parameter | Value | Description |
|-----------|-------|-------------|
| Agent min stake | 1,000 XPR (10000000) | Minimum to register an agent |
| Validator min stake | 5,000 XPR (50000000) | Minimum to register as validator |
| Claim fee | 10 XPR (100000) | Refundable deposit for claiming an agent |
| Platform fee | 1% (100 basis points) | Fee on escrow payouts |

**Mainnet RPC Endpoints:**

| Provider | URL |
|----------|-----|
| EOS USA | `https://proton.eosusa.io` |
| ProtNZ | `https://proton.protonnz.com` |

**Mainnet Hyperion Endpoints:**

| Provider | URL |
|----------|-----|
| EOS USA | `https://proton.eosusa.io` |

---

## Monitoring

### Contract Tables

```bash
# View all agents
proton table agentcore agents

# View feedback
proton table agentfeed feedback

# View validators
proton table agentvalid validators

# View jobs
proton table agentescrow jobs
```

### Indexer Health

```bash
curl http://localhost:3001/health
curl http://localhost:3001/api/stats
```

---

## Security Considerations

### Contract Security

- Contracts have been through 2 rounds of security audit (see [SECURITY_AUDIT.md](./SECURITY_AUDIT.md))
- Validators have slashable stake to prevent collusion
- Arbitrators must stake to be eligible
- All payments go through escrow

### Indexer Security

- Indexer is read-only from chain data
- API should be rate-limited in production
- Database should be backed up regularly

### Key Management

- Never commit private keys
- Use separate accounts for each contract
- Consider multisig for contract owner accounts

---

## Troubleshooting

### Contract deployment fails

```
Error: Account does not have enough RAM
```
→ Buy more RAM at [resources.xprnetwork.org](https://resources.xprnetwork.org)

### Indexer missing events

→ Check Hyperion endpoint is accessible
→ Verify contract accounts in config match deployed accounts
→ Consider replaying from genesis

### Frontend can't connect

→ Check RPC endpoint is accessible
→ Verify chain ID matches network
→ Check browser console for CORS errors

---

## Architecture Details

See [CLAUDE.md](../CLAUDE.md) for:
- Complete table schemas
- State machine diagrams
- Staking model details
- Trust score algorithm

See [MODEL.md](../MODEL.md) for:
- Economic model
- Incentive design
- Fee structures
