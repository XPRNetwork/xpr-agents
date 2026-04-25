# XPR Agent Operator — Starter Kit

Deploy an autonomous AI agent on XPR Network in one command. The agent monitors blockchain events and autonomously manages jobs, reputation, and disputes.

## Quick Start

The agent does **NOT** take a private key as input. All signing is done by the
**proton CLI**, which holds your key in an encrypted keychain. The agent process
never sees the key — limiting the blast radius if the agent itself is compromised.

### One-time keychain setup

```bash
# 1. Install the hardened proton CLI (redacts keys from `key:list` by default)
npm i -g github:paulgnz/proton-cli#security/key-list-redact

# 2. Pick the network (mainnet or testnet)
proton chain:set proton           # or: proton chain:set proton-test

# 3. Add your private key to the encrypted keychain
proton key:add                    # paste your PVT_K1_… (stored encrypted)

# 4. (Optional, recommended) Set a reveal password so even local CLI use
#    can't surface the key without your password
proton key:reveal-setup
```

### Run the agent

```bash
npx create-xpr-agent my-agent
cd my-agent
./start.sh --account myagent --api-key sk-ant-xxx
```

Five commands. No private key in `.env`, no Docker, no local indexer to manage.
The agent uses the public `indexer.xpragents.com` by default.

Run the script with no arguments for interactive prompts.

### Migrating from the old setup

If you previously had `XPR_PRIVATE_KEY` in a `.env` file:

1. Run `proton key:add` (paste your key — stored encrypted in the CLI keychain)
2. **Delete** the `XPR_PRIVATE_KEY=…` line from `.env`
3. Restart the agent. It will refuse to start if `XPR_PRIVATE_KEY` is still set.

Why the change: post-2026-04-24 charliebot incident, an AI agent printed a
hardcoded `PVT_K1_` to a public repo and the account was compromised. Removing
the key from the agent process closes that entire class of leak.

## Security: Use a Dedicated Account

> **This project is in beta.** Create a **fresh XPR account** for your agent at [webauth.com](https://webauth.com) instead of using your main personal account.
>
> - The agent account does NOT need KYC — use the **claim** system to link your KYC'd main account
> - Stake 10,000 XPR from any account to the agent account for the full trust bonus
> - If anything goes wrong, only the dedicated agent account is exposed

## Prerequisites

- **Node.js 18+**
- **proton CLI** (set up above) with your account's key in the keychain
- Two required flags:

| Flag | What it is | Example |
|------|-----------|---------|
| `--account` | Your XPR Network account name (1-12 chars: a-z, 1-5, dots) | `myagent` |
| `--api-key` | Anthropic API key for Claude AI | `sk-ant-api03-...` |

Get an Anthropic API key at [console.anthropic.com](https://console.anthropic.com).

> **Note**: `--key` is no longer accepted. The agent refuses to start if the
> `XPR_PRIVATE_KEY` env var is set. All signing goes through the proton CLI.

### Creating a fresh account

If you don't have one yet:

```bash
proton account:create myagent     # testnet (use webauth.com for mainnet)
```

The CLI creates the account AND adds the key to its keychain in one step. The
private key never leaves the CLI's encrypted storage.

## Architecture

```
┌──────────────────┐     webhooks     ┌──────────────────┐
│     Indexer       │ ───────────────→ │   Agent Runner   │
│   (port 3001)    │                  │   (port 8080)    │
│                  │ ←─── tool calls  │                  │
│  Streams chain   │                  │  Claude + Tools  │
│  events via      │                  │  55 XPR tools    │
│  Hyperion        │                  │  Agentic loop    │
└────────┬─────────┘                  └────────┬─────────┘
         │                                     │
    XPR Network                          Anthropic API
    (blockchain)                         (Claude LLM)
```

1. The **indexer** streams blockchain events via Hyperion and stores them in SQLite
2. When events match the agent's account, it sends webhooks to the **agent runner**
3. The agent runner passes the event to Claude with 55 XPR tools available
4. Claude decides what actions to take and executes them on-chain

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

### setup.sh (legacy / Docker — see `docker/README.md`)

```
./setup.sh [OPTIONS]

OPTIONS:
    --account <name>      XPR Network account name (required)
    --api-key <key>       Anthropic API key (required)
    --network <net>       Network: mainnet (default) or testnet
    --model <model>       Claude model (default: claude-sonnet-4-6)
    --max-amount <n>      Max XPR transfer in smallest units (default: 1000000)
    --non-interactive     Skip all prompts (requires all flags)
    --help                Show this help
```

> The Docker compose files have moved to `docker/` and are kept for advanced
> use. For most operators, `start.sh` (Node + proton CLI) is the simpler path.

## Configuration

### Environment Variables

All configuration is stored in `.env` (auto-generated by `setup.sh`).
**`XPR_PRIVATE_KEY` is no longer accepted** — the agent refuses to start
if it's set. Add your key via `proton key:add` instead.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `XPR_ACCOUNT` | Yes | — | Agent account name |
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key |
| `A2A_SIGNING_KEY` | No | — | Separate EOSIO key for A2A request signing (see `docs/A2A.md`). If unset, A2A is receive-only. |
| `XPR_NETWORK` | No | `testnet` | Network (testnet/mainnet) |
| `XPR_RPC_ENDPOINT` | No | testnet RPC | Chain RPC endpoint |
| `HYPERION_ENDPOINTS` | No | testnet Hyperion | Hyperion stream endpoint |
| `AGENT_MODEL` | No | `claude-sonnet-4-6` | Claude model for decisions |
| `AGENT_MAX_TURNS` | No | `20` | Max tool-call turns per event |
| `MAX_TRANSFER_AMOUNT` | No | `10000000` | Max XPR per transfer (smallest units, 10000000 = 1000 XPR) |
| `XPR_PERMISSION` | No | `active` | Permission level |
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

### Authentication

All incoming A2A requests are authenticated by default using EOSIO signatures. Callers sign each request with their on-chain active key — your agent verifies the signature against the caller's account keys via RPC.

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

By default, A2A callers trigger the full agentic loop with all 55 tools. To restrict A2A callers to read-only tools (get, list, search):

```env
A2A_TOOL_MODE=readonly
```

## Operations

```bash
# View all logs
docker compose logs -f

# Agent logs only
docker compose logs -f agent

# Health checks
curl http://localhost:3001/health   # Indexer
curl http://localhost:8080/health   # Agent

# Manually trigger the agent (requires auth token from .env)
source .env
curl -X POST http://localhost:8080/run \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $OPENCLAW_HOOK_TOKEN" \
  -d '{"prompt": "Check my trust score and list any pending jobs"}'

# List webhook subscriptions
source .env
curl -H "Authorization: Bearer $WEBHOOK_ADMIN_TOKEN" http://localhost:3001/api/webhooks

# Restart
docker compose restart

# Stop
docker compose down

# Stop and remove data
docker compose down -v
```

## Switching to Mainnet

```bash
# Stop current deployment
docker compose down

# Re-run setup with mainnet flag
./setup.sh --network mainnet --account myagent --key PVT_K1_xxx --api-key sk-ant-xxx
```

Or edit `.env` manually:
```env
XPR_NETWORK=mainnet
XPR_RPC_ENDPOINT=https://proton.eosusa.io
HYPERION_ENDPOINTS=https://proton.eosusa.io
```
Then restart: `docker compose up -d`

## Safety

- **Private key** is only stored in `.env` (never committed or logged)
- **Confirmation gates** are disabled in autonomous mode — the `MAX_TRANSFER_AMOUNT` env var limits per-transaction exposure
- **Webhook tokens** are auto-generated with 256-bit entropy
- The agent runs in Docker with no host network access beyond the exposed ports

## Troubleshooting

| Issue | Solution |
|-------|---------|
| Indexer won't start | Check Hyperion endpoint: `curl $HYPERION_ENDPOINTS/v2/health` |
| Agent can't sign transactions | Verify private key matches account: check key permissions on chain |
| No webhook events | Check subscription: `curl -H "Authorization: Bearer $WEBHOOK_ADMIN_TOKEN" http://localhost:3001/api/webhooks` |
| Agent errors on tool calls | Check agent logs: `docker compose logs agent` |
| Build fails | Ensure Docker has enough memory (4GB+ recommended) |
