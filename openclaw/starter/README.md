# XPR Agent Operator — Starter Kit

Deploy an autonomous AI agent on XPR Network in one command. The agent monitors blockchain events and autonomously manages jobs, reputation, and disputes.

## Two ways to deploy — pick the right one

This starter kit is the **standalone** path — you run a self-contained Node.js process on a host you own (VPS, Mac mini, dedicated server), and that process owns its own LLM access. **Your choice of LLM provider** — Anthropic, OpenAI, xAI Grok, or Google Gemini.

If you're already inside an OpenClaw harness (**Pinata Agents, gateway-hosted OpenClaw, dashboard runtime**) that already provides model access, **don't use this starter** — use the plugin path instead:

| You are… | Use this | LLM API key? |
|----------|----------|--------------|
| **On your own host** | This starter kit (`./start.sh`) | Yes — Anthropic, OpenAI, xAI, or Gemini |
| **Inside Pinata / OpenClaw harness** | `npm i @xpr-agents/openclaw` plugin + `xpr-*` skills on ClawHub | **No** — harness routes the model |

Step-by-step for the harness path: see [`docs/PINATA.md`](../../docs/PINATA.md).

If you're on a standalone host, continue below.

## Quick Start

```bash
# 1. Install proton CLI and load your blockchain key into its keychain
npm i -g @proton/cli

# If `proton: command not found` after the install, the npm global bin isn't
# on your PATH. Fix it once (or add to your shell rc):
#   export PATH="$(npm config get prefix)/bin:$PATH"

proton chain:set proton              # or proton-test
proton key:add                       # interactive — entered once, stored encrypted

# 2. Bootstrap the agent
npx create-xpr-agent my-agent
cd my-agent

# 3. Start it. Pick any one LLM provider — auto-detected from key prefix.
./start.sh --account myagent --api-key sk-ant-xxx    # Anthropic Claude
./start.sh --account myagent --api-key sk-xxx        # OpenAI
./start.sh --account myagent --api-key xai-xxx       # xAI Grok
./start.sh --account myagent --api-key AIxxx         # Google Gemini
```

`start.sh` downloads the agent runner, installs deps, verifies the proton CLI has your account key, resolves the LLM provider from the key prefix (or use `--provider <name>` to be explicit), and starts the agentic loop + A2A server. Run with no arguments for interactive mode.

The agent process **never reads your blockchain key** — every signed transaction shells out to `proton transaction:push`, which signs from the encrypted keychain.

### Running on a managed console (Pinata Agents, browser shells, etc.)

`proton key:add` is interactive — it prompts you twice ("Would you like to encrypt your stored keys with a password?" then "Enter private key"). Some hosted consoles can't drive a real TTY, so the prompts hang or your pasted key gets mangled (`Error: invalid base-58 value`).

The non-interactive form works everywhere:

```bash
echo "no" | proton key:add PVT_K1_yourkey
```

That auto-answers "no" to the encrypt prompt and feeds the key as a positional argument — one shot, no TTY needed. Keys land in the CLI's keychain as plaintext on disk (same threat model as the agent host itself — if the host is compromised, you've already lost).

If you later want the keychain encrypted, `proton key:lock` will prompt for a password and re-encrypt everything. Then every signing op asks for the password — fine on your laptop, painful for autonomous agents — so most operators stay unlocked.

> Looking for the old Docker compose path? It lives in the main repo at [`openclaw/starter/docker/`](https://github.com/XPRNetwork/xpr-agents/tree/main/openclaw/starter/docker) for advanced/legacy use, but it isn't the supported path and we no longer publish images to GHCR.

## Security: Use a Dedicated Account

> **This project is in beta.** Create a **fresh XPR account** for your agent at [webauth.com](https://webauth.com) instead of using your main personal account.
>
> - **Never put your main account's private key in a `.env` file.** The starter kit doesn't read keys from env at all — they live in the proton CLI's encrypted keychain and the agent shells out to sign.
> - The agent account does NOT need KYC — use the **claim** system to link your KYC'd main account
> - Stake 10,000 XPR from any account to the agent account for the full trust bonus
> - If anything goes wrong, only the dedicated agent account is exposed

## Prerequisites

- **Node.js 18+**
- **proton CLI** with your account's active key loaded (`proton key:add`)
- The two required flags:

| Flag | What it is | Example |
|------|-----------|---------|
| `--account` | Your XPR Network account name (1-12 chars: a-z, 1-5, dots) | `myagent` |
| `--api-key` | An LLM API key from any supported provider | `sk-ant-...` / `sk-...` / `xai-...` / `AI...` |

Supported providers — the runner detects which one from the key prefix:

| Provider | Key prefix | Default model | Get a key |
|---|---|---|---|
| Anthropic | `sk-ant-...` | `claude-sonnet-4-6` | [console.anthropic.com](https://console.anthropic.com) |
| OpenAI | `sk-...` / `sk-proj-...` | `gpt-5` | [platform.openai.com](https://platform.openai.com) |
| xAI | `xai-...` | `grok-4.3` | [console.x.ai](https://console.x.ai) |
| Gemini | `AI...` | `gemini-2.5-flash` | [aistudio.google.com](https://aistudio.google.com) |

Override the auto-detection with `--provider <anthropic|openai|xai|gemini>`. Override the model with `--model <model-id>`. The agent's blockchain signing key is **not** passed via CLI — `start.sh` calls `proton key:list` at boot to verify your account has a key in the keychain.

### Creating an Account & Loading the Signing Key

The canonical flow:

1. **Create the agent account at [webauth.com](https://webauth.com)** — pick a 1-12 char name (`a-z`, `1-5`, dots). WebAuth gives you a 12-word seed phrase. Save it offline.
2. **Extract the K1 private key from the seed phrase.** Two paths:
   - **Explorer utility:** open [`explorer.xprnetwork.org/wallet/utilities/format-keys`](https://explorer.xprnetwork.org/wallet/utilities/format-keys) → "Mnemonic to Private Key" → paste seed → copy `PVT_K1_...`
   - **WebAuth mobile app:** open the account → "Backup Wallet" → reveal / export private key → copy `PVT_K1_...`
3. **Load the private key into the proton CLI keychain:**

   ```bash
   npm install -g @proton/cli
   proton chain:set proton              # mainnet (or proton-test for testnet)
   proton key:add                       # paste the PVT_K1_ from step 2
   # Or for hosted consoles without a TTY:
   #   echo "no" | proton key:add PVT_K1_yourkey
   proton key:list                      # verify
   ```

The key now lives encrypted on disk. The agent shells out to `proton transaction:push` for every signed action — the key never enters the agent process's memory.

> **Already have a funded XPR account?** You can create the agent account from the proton CLI instead: `proton account:create myagent`. You'll get the `PVT_K1_` directly — skip step 2. This path only works if you already control a funded creator account; most operators come through the webauth.com path.

> **Pillar 2 lockdown after first boot:** once the agent is running, run `./setup-security.sh` to delegate the agent's `owner` permission to a separate human account. Even if the keychain key ever leaks, an attacker can't rotate you out of the account. See [`docs/SECURITY.md`](https://github.com/XPRNetwork/xpr-agents/blob/main/docs/SECURITY.md).

> **Security tip:** Create a **dedicated account** for the agent. With the proton CLI keychain, the chain key never enters your `.env` file or the agent process — even if the agent is fully compromised, the attacker cannot leak the key directly.

## Architecture

```
┌──────────────────┐     webhooks     ┌──────────────────┐
│     Indexer       │ ───────────────→ │   Agent Runner   │
│   (port 3001)    │                  │   (port 8080)    │
│                  │ ←─── tool calls  │                  │
│  Streams chain   │                  │  Claude + Tools  │
│  events via      │                  │  72 XPR tools    │
│  Hyperion        │                  │  Agentic loop    │
└────────┬─────────┘                  └────────┬─────────┘
         │                                     │
    XPR Network                          Anthropic API
    (blockchain)                         (Claude LLM)
```

1. The **indexer** streams blockchain events via Hyperion and stores them in SQLite
2. When events match the agent's account, it sends webhooks to the **agent runner**
3. The agent runner passes the event to Claude with 72 XPR tools available
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

### start.sh

```
./start.sh [OPTIONS]

OPTIONS:
    --account <name>      XPR Network account name (required)
    --api-key <key>       LLM API key — any of: sk-ant-... / sk-... / xai-... / AI... (required)
    --provider <name>     anthropic | openai | xai | gemini (auto-detected from key prefix when omitted)
    --network <net>       mainnet (default) or testnet
    --model <model>       LLM model override (per-provider default applied when omitted)
    --poll-interval <n>   Seconds between chain polls (default: 60)
    --rpc <url>           Custom RPC endpoint
```

The signing key is **not** a flag — `start.sh` checks that `proton key:list` shows a key for `--account` before booting. If your key isn't loaded, it tells you to run `proton key:add`.

### Docker (legacy)

The docker-compose configs are kept in the main repo under [`openclaw/starter/docker/`](https://github.com/XPRNetwork/xpr-agents/tree/main/openclaw/starter/docker) for advanced/legacy use. They're unsupported and we no longer publish images to GHCR.

## Configuration

### Environment Variables

All configuration is stored in `.env` (auto-generated by `start.sh`). **There is no `XPR_PRIVATE_KEY` env var** — the agent shells out to the proton CLI keychain for every signature. If you set `XPR_PRIVATE_KEY`, the agent refuses to start with a migration message.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `XPR_ACCOUNT` | Yes | — | Agent account name (proton CLI must have its key loaded). Without this, the plugin loads in read-only mode and every write tool silently fails. |
| `AGENT_LLM_PROVIDER` | No | auto-detected | `anthropic` / `openai` / `xai` / `gemini`. When unset, auto-detected from whichever provider's API key env var is populated. |
| `ANTHROPIC_API_KEY` | one-of | — | Anthropic Claude key (`sk-ant-...`). Set this OR one of the three below. |
| `OPENAI_API_KEY` | one-of | — | OpenAI key (`sk-...` / `sk-proj-...`). |
| `XAI_API_KEY` | one-of | — | xAI Grok key (`xai-...`). |
| `GEMINI_API_KEY` | one-of | — | Google Gemini key (`AI...`). |
| `XPR_NETWORK` | No | `mainnet` | Network (`mainnet` or `testnet`) |
| `XPR_RPC_ENDPOINT` | No | auto from network | Chain RPC endpoint — leave unset to auto-select |
| `INDEXER_URL` | No | `https://indexer.xpragents.com` | Public XPR Agents indexer. 4 read tools depend on this. Override only if you run your own. |
| `AGENT_MODE` | No | `worker` | `worker` / `delegator` / `hybrid` / `validator` / `social` |
| `AGENT_PUBLIC_URL` | No\* | — | Public URL where this agent can be reached for A2A. **\*Required if other agents need to discover yours** — without it the agent registers on chain as `http://localhost:8080` and A2A discovery fails. |
| `A2A_SIGNING_KEY` | No | — | Separate EOSIO key for outbound A2A signatures (limited blast radius — register on a custom permission with no powers). If unset, A2A runs receive-only. |
| `AGENT_MODEL` | No | per-provider default | Override the LLM model. Defaults: `claude-sonnet-4-6` (anthropic), `gpt-5` (openai), `grok-4.3` (xai), `gemini-2.5-flash` (gemini). |
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
| `POLL_INTERVAL` | No | `60` | Poll interval in seconds (lower = snappier, higher = gentler on RPC) |

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

By default, A2A callers trigger the full agentic loop with all 72 tools. To restrict A2A callers to read-only tools (get, list, search):

```env
A2A_TOOL_MODE=readonly
```

## Operations

```bash
# Tail agent logs (start.sh runs in foreground; for daemonized setups,
# write the stdout to a file via your launchd/systemd unit and tail it)
tail -f logs/agent.out.log

# Health check
curl http://localhost:8080/health

# Manually trigger the agent (requires auth token from .env)
source .env
curl -X POST http://localhost:8080/run \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $OPENCLAW_HOOK_TOKEN" \
  -d '{"prompt": "Check my trust score and list any pending jobs"}'

# Restart
# (no docker compose — kill the start.sh process and re-run, or
#  restart your launchd/systemd unit)
```

## Switching to Mainnet

Edit `.env`:
```env
XPR_NETWORK=mainnet
XPR_RPC_ENDPOINT=https://proton.eosusa.io
INDEXER_URL=https://indexer.xpragents.com
```

Make sure proton CLI is on the right chain too:
```bash
proton chain:set proton              # mainnet
proton key:list                      # confirm the mainnet key is loaded
```

Then restart `start.sh` (or your daemon).

## Safety

- **No chain key in process.** Every signed transaction shells out to `proton transaction:push`, which signs from the encrypted keychain. Leaking the agent's RAM cannot leak the chain key.
- **Boot-time refusal of legacy `XPR_PRIVATE_KEY`** — if the env var is set, the agent prints a migration message and exits. Hard cutover, no silent fallback.
- **Confirmation gates** are disabled in autonomous mode — the `MAX_TRANSFER_AMOUNT` env var limits per-transaction exposure.
- **Security tripwires** scan every inbound prompt and tool result for private-key shapes (`PVT_K1_`, WIF) and proton CLI exfiltration patterns (`reveal-private`, `proton-cli.json`). Configurable via `SECURITY_ENABLED` / `SECURITY_MODE`.
- **Webhook tokens** are auto-generated with 256-bit entropy.
- **A2A signing** uses a separate `A2A_SIGNING_KEY` — register it on a custom permission with no powers so a leak only damages reputation, not funds.

## Troubleshooting

| Issue | Solution |
|-------|---------|
| `start.sh` reports "proton CLI key not found" | Run `proton key:add` and paste the private key for `--account`. Check with `proton key:list`. |
| `sh: proton: command not found` after `npm i -g @proton/cli` | npm's global bin isn't on PATH. Run `export PATH="$(npm config get prefix)/bin:$PATH"` (and add to your shell rc). |
| `proton key:add` hangs in a hosted/web console, or paste returns `Error: invalid base-58 value` | The console can't drive an interactive TTY. Use the non-interactive form: `echo "no" \| proton key:add PVT_K1_yourkey`. |
| Every signing op prompts for a 32-character password | Keychain is locked. Run `proton key:unlock <password>` (decrypts in place, signing proceeds without prompts). Re-lock anytime with `proton key:lock`. |
| Agent can't sign transactions | Verify the loaded key has `active` permission on chain: `proton account <account>` |
| Agent refuses to start with "XPR_PRIVATE_KEY is set but no longer supported" | Remove `XPR_PRIVATE_KEY` from `.env` and load it via `proton key:add` instead |
| No A2A outbound calls | Set `A2A_SIGNING_KEY` (separate key, custom permission) — without it A2A runs receive-only |
| Agent errors on tool calls | Check agent logs (`tail -f logs/agent.out.log`) — security tripwires may be blocking input/output |

## Escrow housekeeping

Every poll cycle the runner closes out jobs the contract allows it to, without involving the model:

| Situation | Action | Who benefits |
|---|---|---|
| You delivered, the client never approved, deadline and 3-day review window passed | `timeout` | You get paid |
| You funded a job, the agent never delivered by the deadline | `timeout` | You get refunded |
| You created a job that was never funded and its deadline passed | `cancel` | Board stays clean |

At most three actions per cycle, three failed attempts per job before it is left alone, counters on `/health` under `poller.housekeeping`. Set `AUTO_CLAIM_TIMEOUTS=false` to disable.

## Updating a running agent

`./start.sh --update` re-downloads the runner from this repo's `main` branch, reinstalls the published `@xpr-agents/openclaw` plugin (which bundles the 13 skills) and keeps your `.env`. Existing agents keep running old tools and delivery logic until you do this.

## Developing against a local plugin build

The runner depends on the published `@xpr-agents/openclaw` package so that copies made by `start.sh` and `create-xpr-agent` resolve it from npm. To test unreleased plugin or skill changes from this checkout:

```bash
cd openclaw && npm run build          # builds dist + skills/*/dist
cd starter/agent && npm link ../..    # point the runner at the local build
```

Run `npm install` in `starter/agent` again to go back to the published version.
