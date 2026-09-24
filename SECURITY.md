# Security Policy

## There is no bug bounty

**We do not pay bounties.** Our previous bounty offer attracted a flood of low-quality, automated and
duplicate submissions, so it has been withdrawn. Reports are welcome, but no report will be paid,
regardless of severity.

## How to report

**Open a GitHub issue:** https://github.com/XPRNetwork/xpr-agents/issues/new

That is the only reporting channel. We do not accept reports by email, private message, or GitHub
private vulnerability reports, and those will not be answered.

Issues are public. If a finding would put funds on mainnet at immediate risk, describe the affected
component and the impact **without** a working exploit, and we will follow up in the issue.

### What to include

- The component and file (for example `contracts/agentescrow`, `openclaw/starter/agent/src/a2a-auth.ts`)
- The **commit hash** you reviewed
- What goes wrong, and the steps to reproduce it
- Suggested fix, if you have one

Issues without a commit hash and reproduction steps, and issues that appear to be unreviewed output
from an automated tool or AI agent, will be closed without a reply.

### Before you open an issue: check it against what is live

Most reports we received described bugs that were already fixed. Please check first:

1. **Off-chain code** (SDK, plugin, agent runner, indexer, frontend, install scripts): review the
   current `main` branch, not an older commit.
2. **Smart contracts**: confirm the finding against the deployed code. Compare the mainnet code hash
   with a build of the source you reviewed:

   ```bash
   curl -s -X POST https://api-xprnetwork-main.saltant.io/v1/chain/get_code_hash \
     -d '{"account_name":"agentvalid"}'          # agentcore | agentfeed | agentvalid | agentescrow
   sha256sum contracts/agentvalid/assembly/target/agentvalid.contract.wasm
   ```

   If the hashes differ, the issue may already be fixed on chain.
3. **Search existing issues** and [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md) for the same finding.

## Scope

- Smart contracts (`contracts/`) as deployed on XPR Network mainnet
- TypeScript SDK (`sdk/`)
- OpenClaw plugin and bundled skills (`openclaw/`)
- Agent runner and Telegram bridge (`openclaw/starter/`), including the shipped defaults in `start.sh`
  and `.env.example`
- Indexer (`indexer/`)
- Frontend (`frontend/`, xpragents.com)

Out of scope: third-party infrastructure (public RPC / Hyperion nodes, wallets, npm, Telegram);
volumetric denial of service; settings an operator must deliberately change to an unsafe value;
prompt injection or model behaviour that does not cross an authorization boundary; missing headers or
version banners without an exploit; social engineering.

## Rules

- Test on **testnet**, or against your own accounts and local deployments (`@proton/vert`).
  Never move, lock, or put at risk funds or stake that are not yours on mainnet.
- Do not access or keep other users' data beyond what is needed to show the issue.

## Security Audit

This project has been through several rounds of review. See [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md)
for the full report and every addendum.

## Known Limitations

- The indexer cannot read on-chain KYC levels (the `submit` action doesn't include `reviewer_kyc_level`).
  Indexer-computed scores may differ from on-chain scores.
- Agents sign through the proton CLI keychain, which stores keys unencrypted on the agent host unless
  `proton key:lock` is used. Treat the agent host as holding the agent's key.
- A2A request signing still needs an in-process key (`A2A_SIGNING_KEY`). Register it on a dedicated
  `a2a` permission with no on-chain powers, so a leaked key cannot move funds.
