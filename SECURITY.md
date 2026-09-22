# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email: **security@metallicus.com**

Include:
- Description of the vulnerability and its impact
- The **commit hash** you reviewed (and, for contract findings, the on-chain code hash — see below)
- Steps to reproduce, ideally a runnable proof of concept (a `@proton/vert` test for contracts)
- Suggested fix (if any)
- The XPR account you would like any bounty paid to

We will acknowledge receipt within 48 hours and aim to provide a fix or mitigation within 7 days for critical issues.

## Before you submit: test against what is live

Most duplicate reports we receive were found against an older commit and had already been fixed.
Please check both of these first:

1. **Off-chain code** (SDK, plugin, agent runner, indexer, frontend, install scripts): review the
   current `main` branch, not a tagged or older commit.
2. **Smart contracts**: confirm your finding against the code that is actually deployed. Compare the
   mainnet code hash with a build of the source you reviewed:

   ```bash
   curl -s -X POST https://api-xprnetwork-main.saltant.io/v1/chain/get_code_hash \
     -d '{"account_name":"agentvalid"}'          # agentcore | agentfeed | agentvalid | agentescrow
   sha256sum contracts/agentvalid/assembly/target/agentvalid.contract.wasm
   ```

   If the hashes differ, your finding may already be fixed on chain.

## Scope

In scope:

- Smart contracts (`contracts/`) as deployed on XPR Network mainnet
- TypeScript SDK (`sdk/`)
- OpenClaw plugin and bundled skills (`openclaw/`)
- Agent runner and Telegram bridge (`openclaw/starter/`), **including the shipped defaults** in
  `start.sh` and `.env.example` — an insecure default counts even when a safe setting exists
- Indexer (`indexer/`)
- Frontend (`frontend/`, xpragents.com)

Out of scope:

- Third-party infrastructure (public RPC / Hyperion nodes, wallets, npm, Telegram)
- Volumetric denial of service and rate-limit exhaustion without a further impact
- Findings that only apply when an operator deliberately sets a non-default, documented-as-unsafe
  option (for example `A2A_TOOL_MODE=full` with no trust threshold)
- Prompt injection or model misbehaviour that does not cross an authorization boundary
  (for example the model saying something wrong, as opposed to signing an unauthorized transaction)
- Missing best-practice headers or version banners without a demonstrated exploit
- Social engineering and physical attacks

## Rules of engagement

- Test on **testnet** or against your own accounts and local deployments (`@proton/vert`).
  Never move, lock, or put at risk funds or stake that are not yours on mainnet.
- Do not access, modify, or retain other users' data beyond what is needed to prove the issue.
- Give us a reasonable time to fix before any public disclosure; we will coordinate a date with you.

Good-faith research that follows these rules will not be pursued legally, and we will credit you in
[docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md) unless you ask us not to.

## Bounties

Bounties are paid in XPR, at our discretion, based on real impact in the shipped configuration.
Typical ranges:

| Severity | Examples | Typical bounty |
|----------|----------|----------------|
| Critical | Theft or loss of funds held by the contracts or users; stored XSS on the wallet-connected site | 15,000 – 25,000 XPR |
| High | Slashing or penalty evasion; unauthorized on-chain writes or signing; authentication bypass on the agent runner | 5,000 – 15,000 XPR |
| Medium | SSRF or information disclosure; insecure shipped defaults; reputation-score corruption | 1,000 – 5,000 XPR |
| Low / informational | Hardening suggestions, defense-in-depth | Credit, discretionary |

- **Duplicates:** the first report of an issue is eligible. An issue that is already fixed on `main`
  (or, for contracts, already deployed on chain) before your report arrives, or that our own review
  found first, is a duplicate and is not paid. We will still tell you where and when it was fixed.
- One root cause is one bounty, even if it shows up in several places.
- Payment goes to the XPR account you name, after the fix is merged (and deployed, for contracts).

## Security Audit

This project has undergone several rounds of review. See [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md)
for the full report and every addendum.

## Known Limitations

- The indexer cannot read on-chain KYC levels (the `submit` action doesn't include `reviewer_kyc_level`).
  Indexer-computed scores may differ from on-chain scores.
- Agents sign through the proton CLI keychain, which stores keys unencrypted on the agent host unless
  `proton key:lock` is used. Treat the agent host as holding the agent's key.
- A2A request signing still needs an in-process key (`A2A_SIGNING_KEY`). Register it on a dedicated
  `a2a` permission with no on-chain powers, so a leaked key cannot move funds.
