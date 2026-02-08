# XPR Trustless Agents - Security Audit Report

**Date:** 2026-02-08
**Auditor:** 8-agent parallel audit swarm (Claude Opus 4.6)
**Scope:** Full stack - 4 smart contracts, SDK, indexer, OpenClaw plugin, frontend, deployment/infra, cross-component consistency, test coverage

---

## Executive Summary

8 specialized audit agents examined every source file across the entire XPR Agents stack. The audit identified **3 CRITICAL**, **21 HIGH**, **38 MEDIUM**, and **40+ LOW** severity findings. The most urgent issues are missing re-initialization guards on two contracts (allowing owner takeover), schema mismatches between the SDK/indexer and contracts (causing silent data corruption), and a missing indexer handler that permanently corrupts indexed state.

The codebase demonstrates strong fundamentals: parameterized SQL queries, proper auth checks on most actions, token transfer safety patterns (checks-effects-interactions), and no hardcoded secrets. The issues found are primarily gaps rather than flaws in existing logic.

---

## Table of Contents

1. [Smart Contracts](#1-smart-contracts)
2. [SDK](#2-sdk)
3. [Indexer](#3-indexer)
4. [OpenClaw Plugin](#4-openclaw-plugin)
5. [Frontend](#5-frontend)
6. [Cross-Component Consistency](#6-cross-component-consistency)
7. [Deployment & Infrastructure](#7-deployment--infrastructure)
8. [Test Coverage Gaps](#8-test-coverage-gaps)
9. [Recommended Fix Priority](#9-recommended-fix-priority)

---

## 1. Smart Contracts

### CRITICAL

| ID | Contract | Issue | Location |
|----|----------|-------|----------|
| SC-C01 | agentfeed | `init()` has no re-initialization guard - config can be overwritten by anyone with contract authority | `agentfeed.contract.ts:532-548` |
| SC-C02 | agentescrow | `init()` has no re-initialization guard - same issue | `agentescrow.contract.ts:264-283` |
| SC-C03 | agentescrow | `setConfig()` cannot update `core_contract`, `feed_contract`, `acceptance_timeout`, `min_arbitrator_stake`, or `arb_unstake_delay` - contract becomes unmanageable if core migrates | `agentescrow.contract.ts:285-311` |

**SC-C01 / SC-C02 Details:** Both `agentcore` and `agentvalid` correctly check `existingConfig.owner == EMPTY_NAME` before allowing initialization. The `agentfeed` and `agentescrow` contracts skip this check, meaning `init()` can be called again to overwrite the owner field.

**Fix:** Add `const existingConfig = this.configSingleton.get(); check(existingConfig.owner == EMPTY_NAME, "Contract already initialized.");` to both contracts.

### HIGH

| ID | Contract | Issue | Location |
|----|----------|-------|----------|
| SC-H01 | agentfeed | FeedbackRateLimit secondary index uses XOR (`reviewer.N ^ agent.N`) - guaranteed collisions can cause CPU exhaustion DoS | `agentfeed.contract.ts:329-331` |
| SC-H02 | agentfeed/agentvalid/agentescrow | Permissionless cleanup actions can delete live data, desync scores when followed by `recalculate()` | `agentfeed.contract.ts:1107-1128`, `agentvalid.contract.ts:994-1015`, `agentescrow.contract.ts:1058-1088` |
| SC-H03 | agentescrow | No dispute timeout mechanism - funds permanently locked if arbitrator refuses to act but is technically active | `agentescrow.contract.ts:682-694` |
| SC-H04 | agentfeed | `calcaggtrust` overwrites native `avg_score` in `agentscores` table - next `submit()` overwrites it back, causing score oscillation | `agentfeed.contract.ts:1517-1573` |

### MEDIUM

| ID | Contract | Issue | Location |
|----|----------|-------|----------|
| SC-M01 | agentfeed | `init()` does not validate `core_contract` is a real account | `agentfeed.contract.ts:532-548` |
| SC-M02 | agentfeed | `submit()` does not call `updateDirectionalTrust()` but `submitctx()` and `submitwpay()` do | `agentfeed.contract.ts:630-697` |
| SC-M03 | agentescrow | No validation that `symbol` parameter matches XPR in `createJob()` | `agentescrow.contract.ts:324-388` |
| SC-M04 | agentescrow | Most actions missing pause check (`createjob`, `addmilestone`, `acceptjob`, `startjob`, `submitmile`, `deliver`, `dispute`) | Multiple locations |
| SC-M05 | agentescrow | Arbitrator can deactivate while assigned to active disputes, triggering owner fallback (0% fee dodge) | `agentescrow.contract.ts:937-944` |
| SC-M06 | agentcore | `getSystemStake()` integer truncation at boundary (9999 / 10000 = 0) | `agentcore.contract.ts:289-301` |
| SC-M07 | agentfeed | `amount_paid` is self-reported and unverified in `submit()` | `agentfeed.contract.ts:630-697` |
| SC-M08 | agentcore | `hashString()` (DJB2) collisions for plugin name secondary index | `agentcore.contract.ts:144-150` |

### LOW

| ID | Contract | Issue |
|----|----------|-------|
| SC-L01 | agentvalid | `cleanValidations` can delete validations with pending unfunded challenges |
| SC-L02 | agentfeed | `cleanFeedback` deletes records without updating `agentscores` |
| SC-L03 | agentescrow | Milestone order not validated for uniqueness |
| SC-L04 | agentescrow | No maximum deadline enforcement on `createJob()` |
| SC-L05 | agentvalid | `resolve()` resets `challenged = false`, enabling cumulative slashing |
| SC-L06 | agentescrow | `arb_unstake_delay` not configurable via `init()` or `setConfig()` |

### INFO

| ID | Contract | Issue |
|----|----------|-------|
| SC-I01 | All | Rounding dust from integer division in fee calculations |
| SC-I02 | agentcore | `transfer` action name collision with token notify handler |
| SC-I03 | All | Singleton config defaults create valid-looking config with `owner == EMPTY_NAME` |
| SC-I04 | agentfeed | Context embedded in tags field causes false colon detection |
| SC-I05 | agentvalid | Accuracy dilutable by volume padding |

---

## 2. SDK

### HIGH

| ID | Issue | Location |
|----|-------|----------|
| SDK-H01 | `ValidatorRaw` missing `pending_challenges` field - positional data corruption for `registered_at` and `active` | `types.ts:191-213` |
| SDK-H02 | Challenge field order mismatch / missing `funded_at` - every field after `stake` reads wrong value | `ValidationRegistry.ts:155-176` |
| SDK-H03 | Arbitrator missing `active_disputes` field - `active` filter permanently broken | `EscrowRegistry.ts:317-343` |
| SDK-H04 | No validation on `amount` string in `registerWithFee`, `claimWithFee`, and fee methods | Multiple locations |

### MEDIUM

| ID | Issue | Location |
|----|-------|----------|
| SDK-M01 | `listFeedbackForAgent` secondary index queries fetch globally, not scoped to account | `FeedbackRegistry.ts:52-105` |
| SDK-M02 | No validation on `score` (1-5 range) before transaction | `FeedbackRegistry.ts:189-215` |
| SDK-M03 | No validation on `confidence` (0-100 range) before transaction | `ValidationRegistry.ts:307-332` |
| SDK-M04 | `parseInt()` without radix or NaN guard throughout all parse methods | Multiple files |
| SDK-M05 | Trust score longevity uses client `Date.now()` instead of chain time | `utils.ts:50-52` |
| SDK-M06 | `safeJsonParse<T>` does type assertion not runtime validation (prototype pollution risk) | `utils.ts:129-135` |
| SDK-M07 | Account names never validated on write operations despite `isValidAccountName()` existing | Multiple write methods |
| SDK-M08 | `parseXpr` uses floating-point math, losing precision (`0.7 * 10000 = 6999.999...`) | `utils.ts:171-175` |

### LOW

| ID | Issue |
|----|-------|
| SDK-L01 | `DISPUTE_RESOLUTIONS` array index access without bounds check |
| SDK-L02 | `console.warn` in `transferOwnership` leaks implementation details |
| SDK-L03 | `listPlugins` hardcoded limit of 1000 with no pagination |
| SDK-L04 | Cleanup methods have no `maxAge`/`maxDelete` validation |
| SDK-L05 | `MilestoneRaw.order` typed as `number` inconsistent with other raw fields |
| SDK-L06 | `@proton/js` caret version range allows untested minor versions |

---

## 3. Indexer

### HIGH

| ID | Issue | Location |
|----|-------|----------|
| IDX-H01 | No SSRF protection on webhook URLs - can target internal services, cloud metadata | `routes.ts:375-403`, `dispatcher.ts:110` |
| IDX-H02 | SQL sort column interpolation pattern - safe by accident, fragile to future changes | `routes.ts:28-29` |

### MEDIUM

| ID | Issue | Location |
|----|-------|----------|
| IDX-M01 | Webhook admin token comparison uses `!==` (timing attack susceptible) | `routes.ts:366-367` |
| IDX-M02 | Unbounded `webhook_deliveries` table growth (no cleanup) | `dispatcher.ts:173-186` |
| IDX-M03 | Unbounded `events` table growth (no TTL or rotation) | `schema.ts:136-144` |
| IDX-M04 | No rate limiting on any endpoint | `index.ts` |
| IDX-M05 | Synthetic ID drift (`MAX(id) + 1`) on missed blocks | All handlers |

### LOW

| ID | Issue |
|----|-------|
| IDX-L01 | CORS fully open (`Access-Control-Allow-Origin: *`) |
| IDX-L02 | Unauthenticated `POST /admin/sync-kyc` stub endpoint |
| IDX-L03 | Webhook tokens stored in plaintext in SQLite |
| IDX-L04 | No validation of Hyperion stream data schema |
| IDX-L05 | Docker container runs as root |
| IDX-L06 | No WebSocket origin/auth validation on reconnect |
| IDX-L07 | Error handler logs full error objects (may leak internals) |
| IDX-L08 | Unbounded concurrent webhook deliveries (no concurrency limit) |

### Positive Findings

- All SQL queries properly parameterized
- Webhook auto-disable after 50 failures
- Query result limits enforced (500 max)
- 10-second webhook delivery timeout with AbortSignal
- 4xx errors not retried
- Graceful shutdown (SIGINT/SIGTERM)
- Irreversible-only stream processing
- Exponential backoff on reconnection

---

## 4. OpenClaw Plugin

### HIGH

| ID | Issue | Location |
|----|-------|----------|
| OC-H01 | Contract names from config not validated - config compromise redirects all financial operations | `index.ts:38-51` |
| OC-H02 | `indexerUrl` not validated - config compromise enables SSRF and data exfiltration | `indexer.ts:10-17` |

### MEDIUM

| ID | Issue | Location |
|----|-------|----------|
| OC-M01 | 3 agent write tools missing confirmation gate (`update_agent`, `set_status`, `manage_plugin`) | `agent.ts:191-292` |
| OC-M02 | `dispute_feedback` and `recalculate_score` missing confirmation gate | `feedback.ts:161-201` |
| OC-M03 | `register_validator`, `submit_validation`, `challenge_validation` missing confirmation gate | `validation.ts:140-232` |
| OC-M04 | Default `maxTransferAmount` is 10,000 XPR - very generous for autonomous agent | `index.ts:53` |
| OC-M05 | `validateUrl` function exists but is never called on any URI/endpoint field | `agent.ts`, `feedback.ts`, `validation.ts`, `escrow.ts` |
| OC-M06 | No session null guard on 18+ write tools - cryptic errors in read-only mode | All write tool files |
| OC-M07 | Docker ports bound to `0.0.0.0` (all interfaces) | `docker-compose.yml:16,39` |

### LOW

| ID | Issue |
|----|-------|
| OC-L01 | `accept_job`, `deliver_job`, `submit_milestone` missing confirmation gate |
| OC-L02 | Falsy `fee_amount` (0) skips validation guard |
| OC-L03 | Floating-point precision in amount conversion (`Math.floor(0.7 * 10000) = 6999`) |
| OC-L04 | No string length limits on any field |
| OC-L05 | Account name regex allows leading/trailing dots |
| OC-L06 | Private key in memory with no zeroization (inherent JS limitation) |
| OC-L07 | Internal URL leaked in health check error response |
| OC-L08 | Raw error messages propagated to tool output |
| OC-L09 | Private key passed as Docker environment variable (visible via `docker inspect`) |
| OC-L10 | `setup.sh` appends tokens without dedup on re-run |

---

## 5. Frontend

### MEDIUM

| ID | Issue | Location |
|----|-------|----------|
| FE-M01 | Unprotected `JSON.parse` on chain-sourced `capabilities` field - crashes agent list | `registry.ts:84,112` |
| FE-M02 | Missing security headers (CSP, X-Frame-Options, HSTS, etc.) | `next.config.js` |
| FE-M03 | Agent endpoint URL rendered without protocol validation - future XSS risk if made clickable | `[id].tsx:119-121` |
| FE-M04 | Agent description injected into `<meta>` tag without sanitization | `[id].tsx:43` |

### LOW

| ID | Issue |
|----|-------|
| FE-L01 | Raw error messages from RPC surfaced to UI |
| FE-L02 | No client-side score range validation (1-5) |
| FE-L03 | Tag field allows comma injection |
| FE-L04 | Wallet session not shared via React Context (stale state across components) |
| FE-L05 | Staking amount parsed as float without NaN/negative checks |
| FE-L06 | No rate limiting on form submissions |
| FE-L07 | Inconsistent `rel="noopener noreferrer"` on external links |

### Positive Findings

- Zero `dangerouslySetInnerHTML` usage
- No private key handling in frontend code
- No `localStorage`/`sessionStorage` for sensitive data
- No `eval` or `Function` constructors
- No API routes (all data from RPC)
- CSRF inherently mitigated by wallet signing
- Self-review prevention in FeedbackForm
- Environment variables use `NEXT_PUBLIC_` prefix correctly

---

## 6. Cross-Component Consistency

### Schema Mismatches (HIGH)

| Entity | Missing Field | SDK Impact | Indexer Impact |
|--------|--------------|------------|----------------|
| Validator | `pending_challenges` | Fields after `accuracy_score` read wrong values | Column missing, can't track |
| Challenge | `funded_at` | Missing critical timestamp for dispute period | Column missing |
| Arbitrator | `active_disputes` | `active` filter permanently broken | Column missing |

### Missing Indexer Handlers (HIGH)

| Action | Contract | Impact |
|--------|----------|--------|
| `expirefunded` | agentvalid | Funded challenge expiry permanently corrupts indexer (challenge stays pending, validation stays challenged) |

### Missing Indexer Handlers (LOW - cleanup actions)

| Actions | Impact |
|---------|--------|
| `cleanjobs`, `cleandisps` (agentescrow) | Indexer retains records chain has pruned |
| `cleanvals`, `cleanchals` (agentvalid) | Same |
| `cleanfback`, `cleandisps` (agentfeed) | Same |

### Other Mismatches

| Severity | Issue |
|----------|-------|
| MEDIUM | SDK trust score hardcodes `'agentfeed'` instead of reading from config |
| MEDIUM | OpenClaw protocol description suggests invalid values (`a2a`, `mcp`, `rest`) - contract requires `http`, `https`, `grpc`, `websocket`, `mqtt`, `wss` |
| MEDIUM | Indexer feedback `reviewer_kyc_level` always 0 (contract reads it internally, not in action data) |
| MEDIUM | Indexer lacks time-based score decay that contract applies |
| LOW | Indexer `agents.stake` column never populated (agents use system staking) |
| LOW | Indexer `agents.trust_score` column always 0 (never computed) |
| LOW | Milestone column naming: contract `order` vs indexer `milestone_order` |

---

## 7. Deployment & Infrastructure

### HIGH

| ID | Issue | Location |
|----|-------|----------|
| INF-H01 | Wildcard CORS on indexer (`Access-Control-Allow-Origin: *`) | `index.ts:36` |
| INF-H02 | Unauthenticated `POST /admin/sync-kyc` endpoint | `routes.ts:350` |
| INF-H03 | No rate limiting on any API endpoint | `index.ts` |

### MEDIUM

| ID | Issue | Location |
|----|-------|----------|
| INF-M01 | Deploy script has no mainnet guard / chain verification | `deploy-testnet.sh:13` |
| INF-M02 | Docker ports exposed to all interfaces | `docker-compose.yml:15-16,38-39` |
| INF-M03 | Docker container runs as root | `indexer/Dockerfile` |
| INF-M04 | `setup.sh` token duplication on re-run | `setup.sh:52-61` |
| INF-M05 | Webhook tokens stored in plaintext in SQLite | `schema.ts:286` |
| INF-M06 | No backup/recovery mechanism for indexer database | `docker-compose.yml:46` |

### LOW

| ID | Issue |
|----|-------|
| INF-L01 | OpenClaw gateway image not pinned (`latest` tag) |
| INF-L02 | All dependencies use caret ranges + `package-lock.json` gitignored |
| INF-L03 | `next-env.d.ts` not in `.gitignore` |

### Positive Findings

- No hardcoded secrets anywhere in codebase
- `.env` files properly gitignored
- Cryptographically secure token generation (`openssl rand -hex 32`)
- Environment variable validation in `setup.sh`
- Multi-stage Docker build
- `set -e` / `set -euo pipefail` in shell scripts
- Sensitive database files gitignored

---

## 8. Test Coverage Gaps

### Estimated Coverage by Component

| Component | Coverage | Status |
|-----------|----------|--------|
| agentcore contract | ~60% | Missing: `onTransfer`, ownership transfer, registration fees |
| agentfeed contract | ~25% | Missing: `resolve`, `recalculate`, KYC weighting, rate limiting, all advanced features |
| agentvalid contract | ~63% | Missing: `resolve` (slashing), `unstake`/`withdraw`, `expirefunded` |
| agentescrow contract | ~55% | Missing: milestones, timeouts, platform fees, overfunding |
| SDK | ~90% | Good mock coverage, but no real RPC response testing |
| OpenClaw plugin | ~40% | Registration tested, handler execution untested |
| Indexer | **0%** | Zero test coverage - critical gap |
| Frontend | **0%** | Zero test coverage |
| Integration (test-actions.sh) | ~70% | Missing: timeouts, context feedback, funded challenge timeout |

### CRITICAL Test Gaps (must fix before mainnet)

1. **Indexer: 0% coverage** - processes all events, serves all API queries
2. **Contract `onTransfer` handlers** - all money enters through these, none tested
3. **Challenge resolution + slashing** - financial consequences untested
4. **Job timeout / acceptance timeout** - fund recovery paths untested
5. **Paginated recalculation** - core reputation engine untested
6. **KYC-weighted scoring** - project's differentiator untested
7. **OpenClaw `maxTransferAmount` enforcement** - safety limit never verified

---

## 9. Recommended Fix Priority

### Phase 1 - Blockers (fix before any testnet deployment)

| # | Fix | Effort |
|---|-----|--------|
| 1 | Add re-init guards to `agentfeed.init()` and `agentescrow.init()` | 2 lines |
| 2 | Fix SDK schema: add `pending_challenges`, `funded_at`, `active_disputes` | ~30 lines |
| 3 | Add `expirefunded` handler to indexer | ~20 lines |
| 4 | Fix OpenClaw protocol description | 1 line |

### Phase 2 - Security hardening (fix before public testnet)

| # | Fix | Effort |
|---|-----|--------|
| 5 | Add CORS allowlist to indexer | 5 lines |
| 6 | Add auth to `/admin/sync-kyc` or remove it | 3 lines |
| 7 | Add SSRF protection for webhook URLs | 20 lines |
| 8 | Bind Docker ports to `127.0.0.1` | 2 lines |
| 9 | Add missing params to `agentescrow.setConfig()` | 15 lines |
| 10 | Add dispute timeout mechanism to agentescrow | 50 lines |
| 11 | Add missing indexer columns (`pending_challenges`, `active_disputes`, `funded_at`) | 10 lines |
| 12 | Add session null guard to OpenClaw write tools | 20 lines |
| 13 | Wire `validateUrl` to URI/endpoint fields | 10 lines |

### Phase 3 - Before mainnet

| # | Fix | Effort |
|---|-----|--------|
| 14 | Add rate limiting to indexer API (`express-rate-limit`) | 15 lines |
| 15 | Add security headers to frontend (CSP, X-Frame-Options) | 20 lines |
| 16 | Run Docker as non-root user | 5 lines |
| 17 | Add `JSON.parse` try-catch in frontend `registry.ts` | 10 lines |
| 18 | Fix `parseXpr` floating-point precision | 10 lines |
| 19 | Add `parseInt` NaN guards throughout SDK | 30 lines |
| 20 | Pin Docker images and commit lockfiles | 5 lines |
| 21 | Add pause checks to remaining agentescrow actions | 10 lines |
| 22 | Block arbitrator deactivation with active disputes | 2 lines |
| 23 | Lower default `maxTransferAmount` to 100 XPR | 1 line |

### Phase 4 - Test coverage (ongoing)

| # | Area | Priority |
|---|------|----------|
| 24 | Indexer test suite (handlers, API, webhooks) | CRITICAL |
| 25 | Contract `onTransfer` handler tests | CRITICAL |
| 26 | Challenge resolution + slashing tests | CRITICAL |
| 27 | Job timeout / acceptance timeout tests | CRITICAL |
| 28 | Paginated recalculation tests | HIGH |
| 29 | KYC-weighted scoring tests | HIGH |
| 30 | OpenClaw `maxTransferAmount` enforcement tests | HIGH |

---

## Methodology

This audit was conducted by 8 specialized agents running in parallel:

1. **Smart Contract Agent** - Read all 4 contracts line-by-line checking for auth flaws, reentrancy, integer overflow, state machine violations, economic exploits
2. **SDK Agent** - Audited type safety, cross-contract schema consistency, input validation, key exposure
3. **Indexer Agent** - Checked for SQL injection, webhook SSRF, DoS, data integrity, WebSocket security
4. **OpenClaw Plugin Agent** - Audited confirmation gates, amount limits, input validation, starter kit security
5. **Frontend Agent** - Checked for XSS, CSRF, SSR issues, wallet state management, URL rendering
6. **Cross-Component Agent** - Verified schema consistency, state machine agreement, fee handling, memo parsing across all 6 components
7. **Test Coverage Agent** - Analyzed every test file against source code to find gaps
8. **Deployment/Infra Agent** - Audited scripts, Docker configs, secret handling, dependency supply chain

Each agent read every relevant source file in its domain and cross-referenced findings against the contract source of truth.
