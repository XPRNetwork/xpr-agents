# Securing an XPR Agent — the two-pillar model

This is the recommended security setup for any autonomous agent on XPR Network. It is **not** the default, it is **not** automated by the scaffold, and it is the single most important thing to do before your agent holds any meaningful value.

If you've already followed `npx create-xpr-agent` or the harness install in [`PINATA.md`](./PINATA.md), you have **Pillar 1** in place. This page is about **Pillar 2**, which most operators skip because nothing in the docs has named it until now.

## Background — the charliebot incident

On 2026-04-24 my agent `charliebot` was drained. The root cause: a tool inside the agent's process surfaced the account's `active` private key in a log line, the key was indexed by a public scraper, and an attacker used it to transfer the agent's funds and tokens within hours. No exploit of the chain, no contract bug — just a key that had no business being in the agent process in the first place.

Pillar 1 (the keychain refactor) fixes the class of bug that drained charliebot. Pillar 2 makes sure that **even when Pillar 1 fails**, the attacker still can't drain you.

## Pillar 1 — Active key in the proton CLI keychain (already done if you followed the scaffold)

Every signed transaction shells out to `proton transaction:push`. The blockchain private key lives in the proton CLI's encrypted keychain on disk; the agent's Node.js process never reads it, never holds it in memory, never serializes it anywhere. Leaking the agent's RAM, logs, prompts, or tool outputs cannot leak the key.

Confirm it's in place:

```bash
proton key:list                    # should show your agent's public key + the account
# If you have an XPR_PRIVATE_KEY env var set anywhere, the agent refuses to start.
# Remove it and use proton key:add instead.
```

**What Pillar 1 protects against:** prompt injection, tool-output exfiltration, log scraping, process memory dump, accidental commit of `.env` to a public repo, supply-chain compromise of a skill or dependency that reads `process.env.*` and POSTs it somewhere.

**What Pillar 1 does NOT protect against:** an attacker with shell access to the host can still read the keychain file. The keychain raises the bar from "any tool can leak the key" to "you have to get shell on the box" — a real improvement, but not the end of the story.

## Pillar 2 — Owner permission held by a separate, higher-trust account

This is what makes Pillar 1's failure recoverable instead of catastrophic.

In EOSIO/Antelope account permissions, every account has at least two permissions:
- `active` — used for normal transactions (transfers, contract calls, signing).
- `owner` — the root authority. Required to change other permissions, including replacing the `active` key.

By default, a newly created account has the **same key** controlling both. That means anyone who gets your `active` key also has `owner` and can rotate you out of your own account.

The fix: make `owner` controlled by a **different account entirely** — your human account, the one with KYC, WebAuth biometric signing, and that never touches any agent process.

```
                                    ┌────────────────────────────────────┐
                                    │  Your human account (KYC'd)         │
                                    │  • Active key in WebAuth (biometric)│
                                    │  • Never in any agent process       │
                                    └─────────────┬──────────────────────┘
                                                  │ controls (account-permission)
                                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Agent account                                                         │
│                                                                       │
│   owner   ← <your-human-account>@active   (Pillar 2)                  │
│   active  ← K1 key in proton CLI keychain   (Pillar 1)                │
│                                                                       │
│   Pillar 1 leak → attacker can spend agent's funds                    │
│   But Pillar 2 means attacker cannot:                                 │
│     • change `active` to a key they control                           │
│     • give themselves new permissions                                 │
│     • lock you out of recovery                                        │
│                                                                       │
│   You recover by signing `updateauth` from your human account →       │
│   rotate `active` to a fresh key → attacker is locked out.            │
└──────────────────────────────────────────────────────────────────────┘
```

**What Pillar 2 buys you:** even if your host is fully compromised and the attacker exfiltrates the active key from the keychain, they cannot rotate your account away from you. You can always reach back from your human account and replace the active key. The attacker has at most a one-shot window between the leak and your rotation.

**What Pillar 2 costs you:** nothing in day-to-day operation. The agent never uses owner. Setup is a one-time `updateauth` call.

## Setup — locking owner to your human account

The setup depends on **how your agent account was created**. Check first:

```bash
proton account <your-agent-account>
```

Look at the `owner` and `active` permission rows. Match what you see to one of the two flows below.

---

### Flow A — Your account was created via webauth.com (most common path for new operators)

You'll see something like:

```
permissions:
  owner:    threshold 1, keys: [PUB_K1_xxx]          ← regular K1 backup key
  active:   threshold 1, keys: [PUB_WA_yyy]          ← WebAuth biometric key
```

The K1 key on `owner` is your exportable backup key. The seed phrase WebAuth gave you during account creation encodes the matching private key. The `PUB_WA_` key on `active` is biometric — **it cannot be exported**, can only be used from your phone with Face ID / fingerprint, and is therefore **unusable for autonomous signing**.

The setup moves the K1 from owner to active so the agent can sign with it via the proton CLI keychain, and replaces owner with your human account's active permission. One atomic transaction so the agent is never in an unsignable mid-state.

First, extract the `PVT_K1_` from your seed phrase via either of these paths:

- **Explorer utility:** open [`https://explorer.xprnetwork.org/wallet/utilities/format-keys`](https://explorer.xprnetwork.org/wallet/utilities/format-keys), find the "Mnemonic to Private Key" section, paste your 12-word seed phrase, copy the resulting `PVT_K1_...`.
- **WebAuth mobile app:** open the account → "Backup Wallet" → reveal / export private key. Copy the `PVT_K1_...`.

Both paths produce the same K1 — the one currently on `owner`.

```bash
# 1. Load the K1 (the one currently on owner) into the proton CLI keychain:
proton key:add                  # paste PVT_K1_yourkey

# 2. Sign one transaction with two updateauth actions:
#    (a) replace active with the same K1 → agent signs daily transactions with it
#    (b) replace owner with your human account → recovery & permission control
proton transaction:push '{
  "actions": [
    {
      "account": "eosio",
      "name": "updateauth",
      "authorization": [{"actor": "<your-agent>", "permission": "owner"}],
      "data": {
        "account": "<your-agent>",
        "permission": "active",
        "parent": "owner",
        "auth": {
          "threshold": 1,
          "keys": [{"key": "PUB_K1_<your-k1-pubkey>", "weight": 1}],
          "accounts": [],
          "waits": []
        }
      }
    },
    {
      "account": "eosio",
      "name": "updateauth",
      "authorization": [{"actor": "<your-agent>", "permission": "owner"}],
      "data": {
        "account": "<your-agent>",
        "permission": "owner",
        "parent": "",
        "auth": {
          "threshold": 1,
          "keys": [],
          "accounts": [{"permission": {"actor": "<your-human-account>", "permission": "active"}, "weight": 1}],
          "waits": []
        }
      }
    }
  ]
}'
```

The order matters: the `active` change runs first, the `owner` change runs second. Both are signed under the **current** `owner` auth (your K1), so the keychain just needs that one key to do the whole flow.

After this lands, your WebAuth `PUB_WA_` key is no longer on the agent account at all. You don't need it — daily signing happens via the K1 in the keychain (active), and recovery happens via your human account (owner). The WebAuth key stays on **your human account** where it belongs.

---

### Flow B — Your account was created via `proton account:create-funded`

`proton account:create-funded <name> --creator <funded-account>` puts the same generated K1 on both permissions:

```
permissions:
  owner:    threshold 1, keys: [PUB_K1_xxx]          ← same K1 on both
  active:   threshold 1, keys: [PUB_K1_xxx]          ← controls both
```

If you passed `--owner <your-human-account>` at creation, `owner` also carries that account:

```
permissions:
  owner:    threshold 1, keys: [PUB_K1_xxx], accounts: [<your-human-account>@active]
  active:   threshold 1, keys: [PUB_K1_xxx]
```

`--owner` **adds** a recovery path; it does not remove the agent's key from `owner`. Threshold is 1, so the raw K1 alone still has owner authority — the lockdown below is still required either way.

Simpler case than Flow A: the K1 is already on active and only needs to be removed from owner. Single `updateauth`:

```bash
# 1. Load the K1 into the proton CLI keychain (if you haven't already):
#    account:create-funded with no --key already did this for you.
proton key:add                  # paste PVT_K1_yourkey

# 2. Rewrite owner to point at your human account, removing the raw K1:
proton account:updateauth <your-agent> owner '' \
  '{"threshold":1,"keys":[],"accounts":[{"permission":{"actor":"<your-human-account>","permission":"active"},"weight":1}],"waits":[]}' \
  --auth <your-agent>@owner
```

The agent's `active` permission isn't named in the call, so it keeps the same K1 — same key the agent was already signing with, no rotation.

(`proton account:create`, without `-funded`, is a different command — the email + 6-digit verification-code flow. Accounts made that way land in the same shape as Flow B, so use the same lockdown.)

---

### Verify (both flows)

```bash
proton account <your-agent>
```

Expected end state:

```
permissions:
  owner:    threshold 1, accounts: [<your-human-account>@active], keys: []
  active:   threshold 1, keys: [PUB_K1_xxx]
```

If `owner.keys` still lists a `PUB_K1_...`, Pillar 2 isn't complete — owner has a raw-key fallback and a compromise of that key still gives the attacker owner authority. Re-run the updateauth with `"keys":[]` (no raw keys on owner).

---

### Optional — test recovery before you need it

While the agent isn't holding live value, do a dry run so you know the recovery path works:

1. Generate a fresh keypair: `proton key:generate`.
2. From your human account's wallet (WebAuth on your phone), send a transaction that updates the agent's `active` permission to the new pubkey.
3. Load the new private key into the keychain: `proton key:add`.
4. Confirm the agent can still sign transactions with the new key.
5. (Optional) Rotate back, or keep the new key as your live one.

Practising this once when nothing is at stake makes it routine when you need it.

## What about `active` multisig?

In theory, you could add `<your-human-account>@active` as a second authorizer on the agent's `active` permission with threshold 2 — every transaction would need both the agent's keychain signature AND your biometric tap. Strongest possible setup.

In practice, it breaks autonomous operation. The whole point of an XPR agent is that it acts without you in the loop. Bidding on a job, accepting work, delivering a milestone — if every action needs a thumbprint, you've built a co-pilot, not an autonomous agent.

The practical answer: **owner locked to human, active in keychain for autonomous use**. Pillar 2 contains the blast radius of Pillar 1 failure without breaking the agent. Don't overshoot.

## What about KYC and the `claim` system?

XPR Network has a built-in mechanism for an agent account to be claimed by a KYC'd human, which transfers ownership and adds KYC-weighted trust score points (up to 30). That mechanism **is** a form of Pillar 2 — when you claim the agent, ownership moves to your account.

If you've claimed your agent, you already have Pillar 2 (and the trust score bonus). If you haven't, the manual flow above gets you the same recovery property without the claim/KYC path.

For maximum trust score + Pillar 2 together: do both. Claim first (gets the trust points), then verify with `proton account <your-agent>` that the resulting owner permission points at your human account with no raw keys.

## Checklist

- [ ] Pillar 1: `proton key:list` shows the agent's account, no `XPR_PRIVATE_KEY` set in env, agent boots clean.
- [ ] Pillar 2: `proton account <your-agent>` shows `owner` controlled by `<your-human-account>@active` with **no raw keys**.
- [ ] Optional: dry-run recovery, then revert.
- [ ] Optional: claim the agent via your KYC'd human account for +30 trust score points.

If both pillars are in place, an attacker would need to compromise both your host (to read the keychain) AND your human account (to change permissions) to drain you. Two independent compromises is the security model.
