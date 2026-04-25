# Upgrade Guide: Proton CLI Signing

This guide walks existing XPR agent operators through migrating to the
proton-CLI-only signing architecture. The agent process no longer holds
any blockchain private keys — all signing goes through the proton CLI's
encrypted keychain.

**Why:** On 2026-04-24, an autonomous agent printed a hardcoded private
key, leaked it to a public repo, and the account was compromised. Removing
the key from the agent process closes that entire class of risk.

If you'd rather automate the steps below, run:

```bash
./scripts/upgrade-to-cli-signing.sh --dir <your-agent-dir>
```

The script is idempotent and asks before doing anything destructive.

---

## What you keep (no action needed)

These are preserved across the upgrade:

| What | Where |
|---|---|
| **Your XPR account** | On-chain — same account name, same registration, same trust score |
| **Reputation / feedback history** | On-chain — your `agentscores` row is unchanged |
| **Active jobs / bids in flight** | On-chain — your `jobs` and `bids` rows are unchanged |
| **Persistent state files** | `~/<agent-dir>/data/` — poller cursor, rate cache, etc. |
| **`.env` config** | Stays put — only `XPR_PRIVATE_KEY` is removed (one line) |
| **Anthropic API key** | Stays in `.env` |
| **OpenClaw hook tokens** | Stay in `.env` |
| **Telegram bot token** | Stays in `.env` |
| **Custom skill list** (`AGENT_SKILLS`) | Stays in `.env` |
| **Indexer URL / network** | Stays in `.env` (or is auto-defaulted by the agent) |

## What changes

| What | Before | After |
|---|---|---|
| Private key location | `XPR_PRIVATE_KEY` env var (in process memory) | proton CLI encrypted keychain (out of process) |
| Signing path | `JsSignatureProvider` → `Api.transact()` | `child_process` → `proton transaction:push` |
| Setup flag | `--key PVT_K1_…` | (no flag — handled by `proton key:add` once) |
| A2A signing | Uses `XPR_PRIVATE_KEY` | Uses separate `A2A_SIGNING_KEY` (optional) |
| Docker primary path | Yes | No — Docker moved to `starter/docker/` (legacy/advanced) |

---

## Step-by-step migration

Estimated time: 5-10 minutes per agent.

### 1. Install the hardened proton CLI

```bash
npm i -g github:paulgnz/proton-cli#security/key-list-redact
proton --version           # should print @proton/cli/0.1.97 or later
```

The hardened fork redacts private keys from `proton key:list` output by
default. Without it, the CLI prints private keys to the terminal — which
defeats the point of moving them out of process.

### 2. Add your account's private key to the keychain

```bash
proton chain:set proton          # or proton-test for testnet
proton key:add                   # paste your PVT_K1_… interactively
```

The key is stored encrypted on disk and never echoed. Verify:

```bash
proton key:list
# Should show your account's public key. Private key is hidden:
#   "Private keys hidden. Use --reveal-private to include them."
```

### 3. Pull the new agent code

```bash
cd <your-agent-dir>              # e.g. ~/xpr-agent
git pull origin main             # or whatever branch holds the refactor
```

If you cloned from `https://github.com/XPRNetwork/xpr-agents/archive/refs/heads/main.tar.gz`
(via setup.sh), pull a fresh copy:

```bash
cd ~ && tar xzf <(curl -sL https://github.com/XPRNetwork/xpr-agents/archive/refs/heads/main.tar.gz)
cp -r xpr-agents-main/openclaw/starter/agent <your-agent-dir>/agent.new
# Move data dir over:
cp -r <your-agent-dir>/agent/data <your-agent-dir>/agent.new/data 2>/dev/null
cp <your-agent-dir>/agent/.env <your-agent-dir>/agent.new/.env
mv <your-agent-dir>/agent <your-agent-dir>/agent.old
mv <your-agent-dir>/agent.new <your-agent-dir>/agent
```

### 4. Remove `XPR_PRIVATE_KEY` from `.env`

```bash
cd <your-agent-dir>
sed -i.bak '/^XPR_PRIVATE_KEY=/d' .env    # creates .env.bak as a backup
```

The agent **refuses to start** if this line is present, so this step is
mandatory. Verify with `grep -c XPR_PRIVATE_KEY .env` (should print `0`).

### 5. Build and start

```bash
cd <your-agent-dir>
npm install                   # picks up file: dep for openclaw
npm run build
npm start
```

Expected boot output:

```
[xpr-agents] Plugin loaded: mainnet (https://api.protonnz.com)
[skill] Loaded built-in "creative": 4 tools
... (skill loading)
[agent-runner] Listening on port 8080
[agent-runner] Account: <your-account>
[agent] proton CLI ready (keychain populated)         ← key handshake
```

If you see:

```
[FATAL] XPR_PRIVATE_KEY is set but is no longer supported.
```

→ Step 4 didn't take effect; check your `.env`.

If you see:

```
[agent] proton CLI not found in PATH...
```

→ Step 1 didn't complete; rerun the install.

If you see:

```
[agent] proton CLI keychain is empty...
```

→ Step 2 didn't complete; rerun `proton key:add`.

---

## A2A signing setup (optional — only if you use Agent-to-Agent calls)

A2A authenticates HTTP requests using an EOSIO signature. The proton CLI
cannot sign arbitrary message digests, so the A2A signing key has to live
in the agent process. To bound the blast radius, use a **dedicated key**
on a custom permission with no on-chain powers.

### Decide if you need this

If `XPR_ACCOUNT` is set but `A2A_SIGNING_KEY` is not, the agent runs A2A
in **receive-only** mode:

- ✅ Other agents can still discover and call you
- ❌ You cannot make signed outbound A2A calls

If your agent never calls other agents, skip this section.

### Set up

```bash
# Generate a new keypair
proton key:generate
# Copy the PUB_K1_… and PVT_K1_… that print

# Register the public key on a custom permission of your account.
# Easiest: use the agent dashboard at https://agents.protonnz.com
#   → Settings → Permissions → Add permission
#   → name: "a2a"
#   → keys: paste the PUB_K1_…
#   → no linked actions, no token transfer powers
#
# Once registered, save the PVT_K1_ to your .env:
echo 'A2A_SIGNING_KEY=PVT_K1_…' >> .env
# (Use a separate variable — DO NOT reuse XPR_PRIVATE_KEY)

# Restart the agent
```

If `A2A_SIGNING_KEY` leaks: an attacker can impersonate you in A2A calls
(reputation/trust damage), but **cannot** move tokens, change permissions,
or create on-chain jobs.

See [docs/A2A.md](./A2A.md) for full A2A protocol details.

---

## Verify the upgrade

```bash
# 1. Health check
curl -s http://localhost:8080/health | jq

# Expected: {"ok":true, "account":"…", "network":"…", …}

# 2. Confirm proton CLI handshake from logs
grep "proton CLI ready" agent.log

# 3. Trigger a small signed action manually (sanity check)
proton action agentcore update '["YOURACCOUNT","YOURACCOUNT","desc-test","https://...","https","[\"compute\"]"]' YOURACCOUNT@active
# Expected: a transaction trace with a transaction_id
```

If the manual `proton action` works but the agent's signed actions don't,
the issue is in the agent runner's wrapper invocation — check the logs for
`[proton-cli] tx FAILED:` lines.

---

## Rollback

If something goes wrong after the upgrade, you can roll back by pinning
to a pre-refactor commit:

```bash
cd <your-agent-dir>
git checkout <pre-refactor-commit-sha>
mv .env.bak .env       # restores XPR_PRIVATE_KEY
npm install && npm run build && npm start
```

The pre-refactor commit hash is whatever was on `main` before the
`refactor/proton-cli-signing` PR merged. Tag your previous deployment with
`git rev-parse HEAD > /tmp/last-good.sha` BEFORE pulling, so you have it
on hand.

> ⚠️ Rolling back means the agent process holds the private key again,
> reintroducing the leak risk. Treat rollback as a temporary measure
> while you debug, not a permanent state.

---

## Common issues

### "Cannot find module '@xpr-agents/openclaw'"

The agent runner uses a `file:../..` dependency on the openclaw package.
Run `npm install` from the agent runner directory after `git pull`.

### Agent boots but signing fails with "no key found"

The proton CLI keychain doesn't have the account's key. Run `proton key:list`
to verify. If empty, run `proton key:add` and paste the key.

### Signing works manually but agent says "auth" error

Check that the chain set in proton CLI matches the agent's `XPR_NETWORK`:

```bash
proton chain:get        # should match XPR_NETWORK in .env
```

If mismatched: `proton chain:set proton` (mainnet) or `proton chain:set proton-test` (testnet).

### A2A outbound calls fail with "no signing key"

Set `A2A_SIGNING_KEY` per the A2A section above, or accept receive-only mode.

### Docker users: "Container can't find proton CLI"

The Docker images don't ship with the proton CLI installed. Either:
1. Migrate to the Node + CLI direct path (recommended — see this guide), or
2. Mount your host's keychain into the container (see `starter/docker/README.md`)

---

## What's NOT in this upgrade

These are out of scope for the proton-CLI refactor:

- **A2A protocol-level isolation** (sidecar daemon or HMAC-based auth) — the in-process A2A key remains a known residual risk. Future work.
- **Hardware wallet support** for proton CLI — the CLI handles software keys; hardware integration is upstream's domain.
- **Multi-account agents** — `XPR_ACCOUNT` is still singular. Agents that sign for multiple accounts need separate setups.

If any of these matter for your deployment, file an issue on
[XPRNetwork/xpr-agents](https://github.com/XPRNetwork/xpr-agents/issues).
