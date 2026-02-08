# Testnet Go-Live Checklist (Operator + Bot)

## Unit Tests (456 total - all passing)

- [x] SDK: 183 tests (`cd sdk && npm test`)
- [x] agentcore: 67 tests (`cd contracts/agentcore && npm test`)
- [x] agentfeed: 44 tests (`cd contracts/agentfeed && npm test`)
- [x] agentvalid: 37 tests (`cd contracts/agentvalid && npm test`)
- [x] agentescrow: 45 tests (`cd contracts/agentescrow && npm test`)
- [x] OpenClaw: 52 tests (`cd openclaw && npx vitest run`)
- [x] Indexer: 28 tests (`cd indexer && npm test`)

## Chain + Contracts

- [ ] `deploy-testnet.sh` completes with no failed action
- [ ] `test-actions.sh proton-test` passes (all 70+ assertions green)
- [ ] `config.paused == false` on all 4 contracts
- [ ] Contract accounts have expected permissions (`eosio.code` inline enabled)

## Core Agent Lifecycle

- [ ] Register/update/setstatus works for operator account
- [ ] Claim flow works end-to-end: `approveclaim` -> claim deposit transfer -> `claim`
- [ ] `verifyclaim` works for valid KYC path (no unintended ownership changes)

## Escrow Lifecycle

- [ ] `createjob` -> `fund` -> `accept` -> `start` -> `deliver` -> `approve` succeeds
- [ ] Milestone path works and `released_amount` increments on milestone approvals
- [ ] Dispute path works with explicit arbitrator
- [ ] Dispute path works with fallback arbitrator (owner fallback case)

## Validation Lifecycle

- [ ] `regval` -> `stake` -> `validate` succeeds
- [ ] Challenge created unfunded does not mark `challenged`
- [ ] Funding challenge marks `challenged` and can be resolved
- [ ] `unstake` -> `withdraw` works with delay rules

## Feedback Lifecycle

- [ ] Submit feedback with and without fee
- [ ] Dispute/resolve feedback updates score as expected
- [ ] `recalc` action behaves as expected under current config

## Indexer Correctness

- [ ] Start from fresh DB or approved snapshot
- [ ] `/health` is healthy and stream connected
- [ ] `/api/agents`, `/api/jobs`, `/api/events`, `/api/stats` return expected data
- [ ] Ownership events reflected (`approveclaim`/`claim`/`transfer`/`release`)
- [ ] Known limitation acknowledged: indexer KYC weight is always 0 (scores may differ from on-chain; requires periodic chain-sync)

## Webhook + OpenClaw

- [ ] Webhook registration works (`POST /api/webhooks`) and dispatcher picks up immediately
- [ ] Receive and process events: `job.created`, `job.funded`, `job.delivered`, `job.completed`, `job.disputed`, `dispute.resolved`, `feedback.received`, `validation.challenged`
- [ ] High-risk tools require confirmation unless `confirmed=true`
- [ ] `maxTransferAmount` blocks oversized fee/fund/stake inputs

## Bot Security

- [ ] Use dedicated bot key (not owner key)
- [ ] `XPR_PERMISSION` set explicitly (prefer custom permission over raw `active`)
- [ ] Admin actions (`setconfig`, `setowner`) excluded from bot runtime
- [ ] Secrets only in env/secret store, never committed

## Ops Readiness

- [ ] Runbook commands validated on your environment
- [ ] Indexer backup/restore tested
- [ ] Pause/unpause commands tested once on testnet
- [ ] Alerting in place for indexer health and webhook delivery failures
