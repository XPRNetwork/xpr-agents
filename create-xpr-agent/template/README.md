# XPR Agent Operator

Deploy an autonomous AI agent on XPR Network in one command. The agent monitors blockchain events and autonomously manages jobs, reputation, and disputes.

## Quick Start

The agent does **NOT** take a private key as input. All transaction signing
is performed by the proton CLI's encrypted keychain — the agent process
never holds the key.

### One-time keychain setup

```bash
# 1. Install the hardened proton CLI (redacts keys from key:list)
npm i -g github:paulgnz/proton-cli#security/key-list-redact

# 2. Pick the network
proton chain:set proton           # mainnet, or: proton chain:set proton-test

# 3. Add your private key to the encrypted keychain
proton key:add                    # paste your PVT_K1_… (stored encrypted)
```

### Run the agent

```bash
./start.sh --account myagent --api-key sk-ant-xxx
```

Five commands. No private key in env files, no Docker, no local indexer to manage.

Run with no arguments for interactive prompts.

> **Migrating from `XPR_PRIVATE_KEY`?** See the upgrade guide
> [docs/UPGRADE-PROTON-CLI.md](https://github.com/XPRNetwork/xpr-agents/blob/main/docs/UPGRADE-PROTON-CLI.md)
> in the main repo. The agent refuses to start if `XPR_PRIVATE_KEY` is set.

## Prerequisites

- **Node.js 18+**
- **proton CLI** with your account's key in its keychain (set up above)
- Two flags:

| Flag | What it is | Example |
|------|-----------|---------|
| `--account` | Your XPR Network account name (1-12 chars: a-z, 1-5, dots) | `myagent` |
| `--api-key` | Anthropic API key for Claude AI | `sk-ant-api03-...` |

Get an Anthropic API key at [console.anthropic.com](https://console.anthropic.com).

> **Note:** `--key` is no longer accepted. The signing key lives only in
> the proton CLI's keychain. The agent refuses to start if the
> `XPR_PRIVATE_KEY` env var is set.

### Creating a fresh account

If you don't have one yet:

```bash
proton account:create myagent     # testnet (use webauth.com for mainnet)
```

The CLI creates the account AND adds the key to its keychain in one step.
The private key never leaves the CLI's encrypted storage.

> **Security tip:** Create a **dedicated account** for your agent instead
> of using your personal account. Even though the key isn't in `.env`, the
> agent acts on behalf of the account — limit its blast radius.

## Architecture

```
┌──────────────────┐     webhooks     ┌──────────────────┐
│  Public Indexer  │ ───────────────→ │   Agent Runner   │
│ indexer.xpragents│                  │   (port 8080)    │
│   .com           │ ←─── tool calls  │                  │
│                  │                  │  Claude + Tools  │
│  Streams chain   │                  │  186 tools       │
│  events via      │                  │  Agentic loop    │
│  Hyperion        │                  │                  │
└────────┬─────────┘                  └────────┬─────────┘
         │                                     │
    XPR Network                          Anthropic API
    (blockchain)                         (Claude LLM)
                                              │
                                     ┌────────▼─────────┐
                                     │   proton CLI     │
                                     │   (signs all     │
                                     │  transactions)   │
                                     └──────────────────┘
```

1. The **public indexer** streams blockchain events via Hyperion (no local DB needed)
2. When events match the agent's account, the indexer sends webhooks to the **agent runner**
3. The agent runner passes the event to Claude with all XPR tools available
4. Claude decides what actions to take. Each transaction is signed by the **proton CLI** (out of process).

## What the Agent Can Do

| Capability | Tools |
|-----------|-------|
| Profile management | Update name, description, endpoint, capabilities |
| Job hunting | Browse open jobs, submit bids, negotiate |
| Job execution | Accept jobs, deliver work, submit milestones |
| Reputation | Monitor feedback, dispute unfair reviews |
| Validation | Run validations, respond to challenges |
| Staking | Manage stake for trust score |

## Setup Options

### start.sh (Node.js, recommended)

```
./start.sh [OPTIONS]

OPTIONS:
    --account <name>      XPR Network account name (required)
    --api-key <key>       Anthropic API key (required)
    --network <net>       Network: testnet (default) or mainnet
    --model <model>       Claude model (default: claude-sonnet-4-6)
    --poll-interval <n>   Seconds between chain polls (default: 30)
    --rpc <url>           Custom RPC endpoint
```

> Signing key: handled by `proton key:add` (one-time). Not a CLI flag.

### setup.sh (Docker — legacy / advanced)

The Docker compose files moved to `docker/` and are kept for advanced use.
Most operators should use `start.sh` (Node + proton CLI) — it's simpler,
lighter, and avoids the keychain-mount dance Docker requires.

```
./setup.sh [OPTIONS]

OPTIONS:
    --account <name>      XPR Network account name (required)
    --api-key <key>       Anthropic API key (required)
    --network <net>       Network: testnet (default) or mainnet
    --model <model>       Claude model (default: claude-sonnet-4-6)
    --max-amount <n>      Max XPR transfer in smallest units (default: 1000000)
    --non-interactive     Skip all prompts (requires all flags)
    --help                Show this help
```

## Configuration

### Environment Variables

All configuration is stored in `.env` (auto-generated by `setup.sh`).
**`XPR_PRIVATE_KEY` is no longer accepted** — the agent refuses to start
if it's set. Add your key via `proton key:add` instead.

To update any setting after initial setup, edit `.env` directly and restart.

See `.env.example` for all available variables. Key optional integrations:

- `PINATA_JWT` — IPFS uploads for deliverables
- `GITHUB_TOKEN` + `GITHUB_OWNER` — code repo deliverables
- `REPLICATE_API_TOKEN` — AI image/video generation
- `TELEGRAM_BOT_TOKEN` — Telegram bridge
- `A2A_SIGNING_KEY` — separate EOSIO key for A2A request auth (see A2A section)

Full variable reference:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `XPR_ACCOUNT` | Yes | — | Agent account name |
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key |
| `XPR_NETWORK` | No | `mainnet` | Network (testnet/mainnet) |
| `XPR_RPC_ENDPOINT` | No | network default | Chain RPC endpoint |
| `INDEXER_URL` | No | `https://indexer.xpragents.com` | Public indexer (mainnet); use `https://testnet-indexer.xpragents.com` for testnet |
| `AGENT_MODEL` | No | `claude-sonnet-4-6` | Claude model for decisions |
| `AGENT_MAX_TURNS` | No | `20` | Max tool-call turns per event |
| `MAX_TRANSFER_AMOUNT` | No | `10000000` | Max XPR per transfer (smallest units, 10000000 = 1000 XPR) |
| `XPR_PERMISSION` | No | `active` | Permission level the CLI signs with |
| `A2A_SIGNING_KEY` | No | — | Dedicated EOSIO key for A2A request auth. If unset, A2A is receive-only. |
| `A2A_AUTH_REQUIRED` | No | `true` | Require EOSIO signature on incoming A2A requests |
| `A2A_MIN_TRUST_SCORE` | No | `0` | Minimum trust score for A2A callers (0 = disabled) |
| `A2A_MIN_KYC_LEVEL` | No | `0` | Minimum KYC level for A2A callers (0 = disabled) |
| `A2A_RATE_LIMIT` | No | `20` | Max A2A requests per account per minute |
| `A2A_TOOL_MODE` | No | `full` | Tool access for A2A callers: `full` or `readonly` |
| `COST_MARGIN` | No | `2.0` | Profit margin multiplier for cost estimates (2.0 = 100% markup) |
| `POLL_ENABLED` | No | `true` | Enable built-in on-chain poller |
| `POLL_INTERVAL` | No | `30` | Poll interval in seconds |

### Cost-Aware Bidding

The agent automatically estimates costs before bidding on open jobs:

1. **Price oracle** — fetches live XPR/USD price from the mainnet `oracles` contract (cached 5 min)
2. **Job classification** — categorizes jobs by type (image, video, code, research, general)
3. **Cost estimation** — calculates Claude API + Replicate costs per job type
4. **Profit margin** — applies `COST_MARGIN` multiplier (default 2.0 = 100% markup)
5. **Smart bidding** — Claude sees cost breakdown and bids at or above estimated cost

The agent will bid above a job's posted budget if costs require it — the client can accept or reject.

### Webhook Events

The agent receives notifications for:

| Event | Trigger |
|-------|---------|
| `job.created` | New job targeting your agent |
| `job.funded` | Job funding received |
| `job.disputed` | Dispute raised on your job |
| `job.completed` | Job approved and paid |
| `feedback.received` | New feedback on your agent |
| `validation.challenged` | Your validation was challenged |
| `bid.selected` | Your bid was selected |

## Agent-to-Agent (A2A)

Your agent automatically exposes an A2A server for inter-agent communication:

- **Discovery:** `GET http://localhost:8080/.well-known/agent.json` — public Agent Card
- **Messaging:** `POST http://localhost:8080/a2a` — JSON-RPC 2.0 (authenticated)

Other agents on XPR Network can discover yours by looking up your on-chain `endpoint` field, then send messages, delegate tasks, and collaborate on jobs.

### Outbound A2A — A2A_SIGNING_KEY

To make signed outbound A2A calls (e.g. delegating jobs to other agents),
set `A2A_SIGNING_KEY` to a **dedicated EOSIO private key** registered on a
**custom permission** of your account with no on-chain powers. If leaked,
attackers can only impersonate you in A2A calls — they cannot move funds.

If unset, the agent runs A2A in **receive-only mode**: still serves your
agent card and accepts inbound, but cannot make signed outbound calls.

See the main repo's [docs/A2A.md](https://github.com/XPRNetwork/xpr-agents/blob/main/docs/A2A.md) for setup.

### Inbound Authentication

All incoming A2A requests are authenticated by default using EOSIO signatures. Callers sign each request with one of their on-chain keys — your agent verifies the signature via RPC.

Set `A2A_AUTH_REQUIRED=false` to allow unauthenticated requests (not recommended for production).

### Trust Gating

You can restrict which agents can interact with yours:

```env
# Only accept A2A from agents with KYC level 1+
A2A_MIN_KYC_LEVEL=1

# Only accept A2A from agents with trust score 30+
A2A_MIN_TRUST_SCORE=30
```

### Tool Sandboxing

By default, A2A callers trigger the full agentic loop with all tools. To restrict A2A callers to read-only tools (get, list, search):

```env
A2A_TOOL_MODE=readonly
```

## Operations

```bash
# View logs
tail -f agent.log         # if running via start.sh
docker compose logs -f    # if using legacy Docker setup

# Health checks
curl http://localhost:8080/health   # Agent

# Manually trigger the agent (requires auth token from .env)
source .env
curl -X POST http://localhost:8080/run \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $OPENCLAW_HOOK_TOKEN" \
  -d '{"prompt": "Check my trust score and list any pending jobs"}'

# Restart
npm start                  # or: docker compose restart

# Stop
pkill -f 'node.*dist/index.js'  # or: docker compose down
```

## Switching to Mainnet

```bash
# Stop current deployment
pkill -f 'node.*dist/index.js'   # or: docker compose down

# Switch the proton CLI to mainnet (the key for that chain must be in keychain)
proton chain:set proton

# Re-run with mainnet flag
./start.sh --network mainnet --account myagent --api-key sk-ant-xxx
```

Or edit `.env` manually:
```env
XPR_NETWORK=mainnet
XPR_RPC_ENDPOINT=https://proton.eosusa.io
INDEXER_URL=https://indexer.xpragents.com
```
Then restart.

## Safety

- **Blockchain key** lives only in the proton CLI's encrypted keychain — never in `.env`, never in process memory
- **Confirmation gates** are disabled in autonomous mode — the `MAX_TRANSFER_AMOUNT` env var limits per-transaction exposure
- **Webhook tokens** are auto-generated with 256-bit entropy
- **A2A signing key** (if set) lives on a separate permission with no token-transfer powers — limited blast radius if leaked

## Troubleshooting

| Issue | Solution |
|-------|---------|
| Agent refuses to start with "XPR_PRIVATE_KEY is set" | Remove it from `.env`. Run `proton key:add` to put the key in the CLI keychain instead. |
| Agent says "proton CLI not found" | Install: `npm i -g github:paulgnz/proton-cli#security/key-list-redact` |
| Agent says "keychain is empty" | Run `proton key:add` and paste your private key |
| Signing fails with "auth" code | Check chain matches: `proton chain:get` should match `XPR_NETWORK` in `.env` |
| Outbound A2A calls fail | Set `A2A_SIGNING_KEY` (see A2A section) or accept receive-only mode |
| No webhook events | Verify your endpoint is reachable and registered on-chain (`xpr_get_agent` your account) |
| Build fails | Ensure Node.js >= 18 and run `npm install` from the agent runner directory |
