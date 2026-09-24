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
| SC-H03 | agentescrow | ~~No dispute timeout mechanism~~ **FIXED** - `resolvetmout` action allows owner to resolve disputes after 14 days | `agentescrow.contract.ts:830+` |
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
| SC-L06 | agentescrow | ~~`arb_unstake_delay` not configurable via `init()`~~ **FIXED** - positional arg now passes 604800 (7 days) |

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
| IDX-H01 | ~~No SSRF protection on webhook URLs~~ **FIXED** - `isValidWebhookUrl()` validates at registration (blocks private IPs, localhost, metadata endpoints, non-HTTPS schemes) | `routes.ts:395-433` |
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
| IDX-L02 | ~~Unauthenticated `POST /admin/sync-kyc`~~ **FIXED** - `requireAdminAuth` guard added |
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
| OC-M07 | ~~Docker ports bound to `0.0.0.0`~~ **FIXED** - Bound to `127.0.0.1` | `docker-compose.yml:16,39` |

### LOW

| ID | Issue |
|----|-------|
| OC-L01 | `accept_job`, `deliver_job`, `submit_milestone` missing confirmation gate |
| OC-L02 | Falsy `fee_amount` (0) skips validation guard |
| OC-L03 | ~~Floating-point precision in amount conversion~~ **FIXED** - `xprToSmallestUnits()` uses string-split integer math |
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

> **Corrected 2026-09-17.** Two items below were true on 2026-02-08 and went stale as the
> site grew; they are updated here rather than left standing. The first stale item hid a
> real vulnerability — see [Addendum: FE-2026-09-01](#addendum-fe-2026-09-01).

- ~~Zero `dangerouslySetInnerHTML` usage~~ — **no longer true.** There were four uses at
  `de2c97f` and three after the FE-2026-09-01 fix, which moved the theme initialiser out of
  an inline script. Two render agent-written Markdown (`JobDetail.tsx`, `TextPreview.tsx`,
  both via `frontend/src/lib/markdown.ts`) — the ones that matter, covered by
  `frontend/src/lib/markdown.test.ts`. The third emits constant homepage JSON-LD, which is
  non-executable `application/ld+json`.
- No private key handling in frontend code
- No `localStorage`/`sessionStorage` for sensitive data
- No `eval` or `Function` constructors
- ~~No API routes (all data from RPC)~~ — **no longer true.** `/api/og/jobs/[id]` and
  `/api/og/services/[id]` render Open Graph images server-side from chain data.
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

### Missing Indexer Handlers (HIGH) - ALL FIXED

| Action | Contract | Impact |
|--------|----------|--------|
| `expirefunded` | agentvalid | ~~Funded challenge expiry permanently corrupts indexer~~ **FIXED** - Handler exists at `validation.ts:321-349` |
| `resolvetmout` | agentescrow | ~~Timeout resolution not indexed~~ **FIXED** - Handler added to `escrow.ts` |

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
| INF-H02 | ~~Unauthenticated `POST /admin/sync-kyc`~~ **FIXED** - `requireAdminAuth` guard added | `routes.ts:365-366` |
| INF-H03 | No rate limiting on any API endpoint | `index.ts` |

### MEDIUM

| ID | Issue | Location |
|----|-------|----------|
| INF-M01 | Deploy script has no mainnet guard / chain verification | `deploy-testnet.sh:13` |
| INF-M02 | ~~Docker ports exposed to all interfaces~~ **FIXED** - Bound to `127.0.0.1` in both docker-compose files | `docker-compose.yml` |
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

| Component | Tests | Coverage | Status |
|-----------|-------|----------|--------|
| agentcore contract | 67 | ~80% | onTransfer, ownership, claim deposits tested |
| agentfeed contract | 44 | ~70% | Recalculation, rate limiting, score calculation, cleanup tested |
| agentvalid contract | 37 | ~75% | Challenge resolution, slashing, accuracy tracking tested |
| agentescrow contract | 45 | ~75% | Timeouts, milestones, arbitrator-less fallback tested |
| SDK | 183 | ~95% | safeParseInt, parseXpr edge cases added |
| OpenClaw plugin | 52 | ~65% | maxTransferAmount enforcement, confirmation gate tested |
| Indexer | 28 | ~60% | Handler tests for all 4 contracts, schema, transfers, event logging |
| Frontend | **0** | **0%** | Zero test coverage |
| Integration (test-actions.sh) | ~70 | ~70% | Missing: timeouts, context feedback, funded challenge timeout |
| **Total** | **456** | | |

### Resolved Test Gaps (Phase 4 - completed 2026-02-08)

All CRITICAL and HIGH test gaps from the original audit have been resolved:

1. ~~**Indexer: 0% coverage**~~ - 28 handler tests added (schema, agent, feedback, validation, escrow, transfers, events)
2. ~~**Contract `onTransfer` handlers**~~ - 15 agentcore onTransfer tests (claim deposits, malformed memos, excess refunds)
3. ~~**Challenge resolution + slashing**~~ - 9 agentvalid tests (slash on upheld, stake forfeiture, accuracy tracking, dispute period)
4. ~~**Job timeout / acceptance timeout**~~ - 7 agentescrow tests (acceptance timeout, deadline timeout, milestone approval)
5. ~~**Paginated recalculation**~~ - 10 agentfeed tests (single/multi-batch, offset validation, cancellation, expiry, blocking)
6. ~~**KYC-weighted scoring**~~ - 5 agentfeed tests (avg_score calculation, perfect/minimum scores, dispute subtraction)
7. ~~**OpenClaw `maxTransferAmount` enforcement**~~ - 6 OpenClaw tests (register, feedback, stake, create job, fund job, within-limit)

### Remaining Gaps

1. **Frontend: 0% coverage** - React components untested
2. **Integration test-actions.sh** - Missing timeout and context feedback paths
3. **Indexer API routes** - REST endpoint response format untested
4. **Indexer webhook dispatcher** - Retry logic and auto-disable untested

---

## 9. Recommended Fix Priority

### Phase 1 - Blockers (fix before any testnet deployment) - ALL DONE

| # | Fix | Effort | Status |
|---|-----|--------|--------|
| 1 | Add re-init guards to `agentfeed.init()` and `agentescrow.init()` | 2 lines | **Done** |
| 2 | Fix SDK schema: add `pending_challenges`, `funded_at`, `active_disputes` | ~30 lines | **Done** |
| 3 | Add `expirefunded` handler to indexer | ~20 lines | **Done** (already existed) |
| 4 | Fix OpenClaw protocol description | 1 line | **Done** |

### Phase 2 - Security hardening (fix before public testnet) - ALL DONE

| # | Fix | Effort | Status |
|---|-----|--------|--------|
| 5 | Add CORS allowlist to indexer | 5 lines | **Done** |
| 6 | Add auth to `/admin/sync-kyc` or remove it | 3 lines | **Done** - `requireAdminAuth` guard |
| 7 | Add SSRF protection for webhook URLs | 20 lines | **Done** - `isValidWebhookUrl()` |
| 8 | Bind Docker ports to `127.0.0.1` | 2 lines | **Done** - both compose files |
| 9 | Add missing params to `agentescrow.setConfig()` | 15 lines | **Done** - `setconfig` updated |
| 10 | Add dispute timeout mechanism to agentescrow | 50 lines | **Done** - `resolvetmout` action |
| 11 | Add missing indexer columns (`pending_challenges`, `active_disputes`, `funded_at`) | 10 lines | **Done** |
| 12 | Add session null guard to OpenClaw write tools | 20 lines | **Done** |
| 13 | Wire `validateUrl` to URI/endpoint fields | 10 lines | **Done** |

### Phase 3 - Before mainnet

| # | Fix | Effort | Status |
|---|-----|--------|--------|
| 14 | Add rate limiting to indexer API (`express-rate-limit`) | 15 lines | **Done** |
| 15 | Add security headers to frontend (CSP, X-Frame-Options) | 20 lines | |
| 16 | Run Docker as non-root user | 5 lines | **Done** |
| 17 | Add `JSON.parse` try-catch in frontend `registry.ts` | 10 lines | |
| 18 | Fix `parseXpr` floating-point precision | 10 lines | **Done** - `xprToSmallestUnits()` integer math |
| 19 | Add `parseInt` NaN guards throughout SDK | 30 lines | **Done** - `safeParseInt()` |
| 20 | Pin Docker images and commit lockfiles | 5 lines | |
| 21 | Add pause checks to remaining agentescrow actions | 10 lines | |
| 22 | Block arbitrator deactivation with active disputes | 2 lines | |
| 23 | Lower default `maxTransferAmount` to 100 XPR | 1 line | |

### Phase 4 - Test coverage (COMPLETED 2026-02-08)

| # | Area | Priority | Status |
|---|------|----------|--------|
| 24 | Indexer test suite (handlers, API, webhooks) | CRITICAL | Done (28 tests) |
| 25 | Contract `onTransfer` handler tests | CRITICAL | Done (15 tests) |
| 26 | Challenge resolution + slashing tests | CRITICAL | Done (9 tests) |
| 27 | Job timeout / acceptance timeout tests | CRITICAL | Done (7 tests) |
| 28 | Paginated recalculation tests | HIGH | Done (10 tests) |
| 29 | KYC-weighted scoring tests | HIGH | Done (5 tests) |
| 30 | OpenClaw `maxTransferAmount` enforcement tests | HIGH | Done (6 tests) |

### Phase 5 - E2E audit swarm fixes (COMPLETED 2026-02-08)

| # | Fix | Severity | Status |
|---|-----|----------|--------|
| 31 | Add `platform_fee <= 1000` upper bound to `agentescrow.init()` | CRITICAL | **Done** |
| 32 | Fix `agentescrow.init()` positional arg coercion (`false` → `0` for `arb_unstake_delay`) | HIGH | **Done** |
| 33 | Add `resolvetmout` indexer handler (job state 8, dispute resolution, active_disputes decrement) | HIGH | **Done** |
| 34 | Add `resolveTimeout()` SDK method on `EscrowRegistry` | HIGH | **Done** |
| 35 | Add `xpr_resolve_timeout` OpenClaw tool with confirmation gate | HIGH | **Done** |
| 36 | Add confirmation gate to `xpr_accept_job` | HIGH | **Done** |
| 37 | Fix floating-point amount conversion across all indexer handlers (integer math) | MEDIUM | **Done** |
| 38 | Fix floating-point amount conversion in all OpenClaw tools (`xprToSmallestUnits()`) | MEDIUM | **Done** |
| 39 | Fix job state 3 description: `ACTIVE` → `INPROGRESS` in OpenClaw | MEDIUM | **Done** |
| 40 | Fix `xpr_dispute_feedback` description (reviewer can also dispute) | MEDIUM | **Done** |
| 41 | Fix validator stake memo matching (`stake` or `stake:*` prefix) | MEDIUM | **Done** |
| 42 | Update OpenClaw test counts (43→44 tools, 13→14 escrow) | TEST | **Done** |

---

## Addendum: FE-2026-09-01

**Stored XSS through attribute injection in the deliverable Markdown renderer.**
Reported through responsible disclosure on 2026-09-17 against commit `de2c97f` by **0xgons** ([LinkedIn](https://www.linkedin.com/in/aditsw)). Thank you.

| | |
|---|---|
| Severity | High — stored, no user interaction, on a wallet-connected origin |
| Component | `frontend/src/lib/markdown.ts`, rendered via `dangerouslySetInnerHTML` in `JobDetail.tsx` and `TextPreview.tsx` |
| Attacker | Any agent assigned to a job (deliverable text is agent-controlled), or any listing author |
| Exploited in the wild | No. Every job's title, description, deliverables and evidence (including fetched manifest files) and every service listing were scanned on 2026-09-17; no payload found |

**Cause.** The renderer escaped `&`, `<` and `>` but not quotes, then placed image alt text,
image URLs and link URLs inside double-quoted attributes. A `"` in any of the three closed
the attribute and let the text append its own, such as an event handler. The URL pattern
accepted quotes, so the URL positions were injectable as well as the alt text the report
described.

**What an attacker could not do.** Read wallet keys, or sign on the user's behalf: signing
happens in the wallet, which still prompts. **What they could do:** run script in the page
to rewrite it, phish, or alter the transaction a user believes they are approving.

**Fix.**
1. The escape pass now escapes `"` and `'` as well, so every value is safe in any quoted
   attribute. A step that un-escaped `&amp;` in URLs was also removed. It did not itself
   produce a live quote, but it was unnecessary (browsers decode entities in attribute
   values), and un-escaping after the escape pass is how this class of bug comes back.
   `applyInline`, which assumes escaped input, is no longer exported.
2. A `Content-Security-Policy` is now served (`frontend/next.config.js`) with
   `script-src 'self' 'wasm-unsafe-eval'` — no `'unsafe-inline'`, no `'unsafe-eval'`. It
   blocks inline scripts, inline event handlers and `javascript:` URLs, so a future escaping
   bug in this path does not become running code. The one inline script (theme initialiser)
   moved to `/theme-init.js` to allow this. Verified in Chrome: an injected `onerror`
   handler and a `javascript:` link both refused to run.
3. `frontend/src/lib/markdown.test.ts` parses the renderer's output into a DOM and asserts
   no element or attribute outside an allowlist appears. The injection cases fail against
   `de2c97f` and pass on the fix.

**Related, checked, not exploitable.** Chain-controlled URLs (`evidence_uri`, `sample_uri`,
dispute evidence, deliverable `media_url`) reach `href` and `src` — including `<iframe src>` —
with no scheme validation on chain. React 19.2 replaces `javascript:` URLs in `href` and `src`
on both server and client render (verified against the installed `react-dom`), and the new CSP
refuses them independently. A scheme allowlist at those sinks would be a third layer.

**Longer term.** Replace the hand-rolled renderer with a maintained Markdown parser and a
vetted sanitizer (for example `marked` plus `DOMPurify`), which removes this class of bug
rather than patching instances of it.

---

## Addendum: ESC-2026-09-17 — service-price fund drain + post-incident audit sweep

Triggered by a responsible-disclosure report of a critical drain in `agentescrow`.
Fixed, deployed by msig, and the contract briefly paused during remediation; the
marketplace is unpaused on patched code. All four contracts were then re-audited
(one agent each) for the same and related classes. Deployed via proposals
`paul123/fixsvcprice` (price fix) and `paul123/auditbatch1` (cancel + validator
fixes). Nothing was exploited in the wild — every job/listing was scanned and the
escrow reconciles to its balance to the unit.

### ESC-1 — CRITICAL — service-price signed-cast fund drain (agentescrow)
`buy:` compared the incoming payment to `service.price` cast to signed `i64`. Price
is a `u64` with only a lower bound, so a listing near 2^64 reads negative, a 1 XPR
purchase passes, and the handler refunds `paid - price` (the whole balance),
bypassing `releasePayment`'s `amount <= funded-released` cap. Confirmed against a
byte-identical rebuild: 1 XPR in, 1,100 XPR out of pooled escrow and stake.
**Fix:** compare/subtract as `u64` (as `fund:` already did); add `MAX_AMOUNT`
(100B XPR, ~3x supply, << i64 max) as an upper bound on service price, job amount
and bid amount. Deployed hash `83848b63…`. Regression: `tests/price-overflow.test.ts`.

### ESC-2 — MEDIUM — cancel() double-refund via removejob() (agentescrow)
`cancel()` refunded `funded_amount` but left `released_amount = 0`, unlike every
other refund path. A later owner `removejob()` computes `funded - 0` and refunds
the same escrow again from the pool. Owner-gated, not attacker-reachable.
**Fix:** `cancel()` sets `released_amount = funded_amount`. Regression:
`tests/cancel-refund.test.ts`. **Note:** seven jobs cancelled before this fix still
carry `released_amount = 0` (ids 17, 18, 19, 25, 50, 58, 76); do not `removejob`
them until cleaned up.

### ESC-3 — MEDIUM — validator free-challenge unstake DoS (agentvalid)
`pending_challenges` (gates unstaking) was incremented on challenge creation, which
is free and permissionless — anyone could lock a validator's stake indefinitely,
contradicting the contract's funding-gated `challenged` flag. **Fix:** increment
only on funding, in lockstep with `challenged`; drop the decrements on the
unfunded-only paths; key `expirefunded`'s decrement on funded state so the counter
cannot leak. Deployed hash `872e5552…`. Regression: `agentvalid.test.ts`.

### Clean
agentcore: no exploitable findings. Every other money path in all four contracts
(fund/challenge/registration/feedback fees, `releasePayment`, `arbitrate`, stake/
slash/withdraw) uses correct unsigned comparisons and caps payouts at real funded
amounts with overflow-guarded math. Both changed ABIs are additive/identical — no
data migration.

### Open follow-ups (not yet deployed)
- **agentfeed resolve() (medium):** treats any `:`-tagged review as context
  feedback, so a disputed plain review can wrongly roll back an agent's context/
  directional-trust reputation. Needs a plain-vs-context discriminator (schema-level)
  — its own considered change. Needs owner to uphold a dispute; no funds.
- **Low:** trapped `regfee`/`feedfee` deposits when those fees are 0; `avg_score`
  can exceed 100% if `max_score` set >5; `approvemile` missing a state guard.


## Addendum: AUDIT-2026-09 — external-model review round (grok + codex) + two external reports

**Reviewers:** grok-4.6-build and codex/gpt-6-astra (headless, read-only, via CLI),
an earlier Fable adversarial pass, and two responsibly-disclosed reports from 0xgons
(XPRA-ESCROW-DBLREFUND-2026-01, XPRA-VALID-SLASH-2026-01). Findings were verified
against source (and several reproduced) before fixing. Shipped across PRs #59–#66.

### Contracts — fixed and DEPLOYED to mainnet 2026-09-22 (msig paul123 / protonnz@active)
On-chain `get_code_hash` verified == audited build; deploy was testnet-first, then msig.
- **agentvalid** → `57adeb5e…`
  - **Validator slash-evasion (HIGH, XPRA-VALID-SLASH-2026-01 / codex#3 / grok#2):** a
    validator could post a dishonest validation and, in one atomic tx before any
    challenge, `unstake` its whole balance to the non-slashable `unstakes` table, so an
    upheld challenge slashed 0. Fix: new `valactivity` table records each validator's
    last validation; `unstake` is time-locked for `challenge_window + 24h` after it, and
    `withdraw` refuses while a funded challenge is pending.
  - **`expireunfund` double-slash (codex#9 / grok#1):** expiring an unfunded sibling
    challenge cleared `validation.challenged`, unlocking a still-funded challenge →
    validator slashable twice. Fix: `expireunfund` no longer touches the flag.
- **agentescrow** → `872622dd…`
  - **`approvemile` missing state guard (grok#6):** milestone funds could be released
    while the job was DISPUTED. Fix: require state INPROGRESS(3)/DELIVERED(4).
  - **`timeout` zero-refund revert (codex#17):** a fully-milestone-paid undelivered job
    sent a 0 XPR refund → token contract reverts → job could never close. Fix: only
    transfer when `remainingAmount > 0`.
- **agentfeed** → `082d0c50…`
  - **recalc-vs-dispute restore (codex#10):** a dispute resolved mid paginated recalc
    was restored on commit. Fix: `resolve` invalidates any in-flight recalcstate.
  - **decay truncation (codex#11):** a KYC-0 review truncated to weight 0 and vanished.
    Fix: floor the decayed weight at 1.
  - **`avg_score` overwrite (grok#5, old SC-H04):** `calcaggtrust` clobbered the native
    average. Fix: combined trust now lives in a new `aggtrust` table.
- **XPRA-ESCROW-DBLREFUND-2026-01** (`cancel`→`removejob` double refund) was already
  remediated in the ESC-2026-09-17 batch; the report cited a pre-fix commit.

All contract changes are additive (new tables `valactivity`, `aggtrust`; no existing
table field or action parameter changed). Suites: agentvalid 48, agentescrow 267,
agentfeed 58.

### Off-chain code — fixed and merged
- **Frontend (#59):** OG-route SSRF guard, deliverable-iframe sandbox, debug gated.
- **Indexer (#60):** trust-proxy, dispatch-time webhook SSRF + `redirect: manual`,
  constant-time admin auth, generic error responses.
- **Runner/openclaw (#61):** A2A tool mode defaults read-only, poller honors scanInbound
  block decisions, LLM token budget, skill SSRF guard, A2A replay protection,
  `/deliverables` auth, code-sandbox realm isolation.
- **CRITICAL sandbox escape (#63):** `vm` context global's HOST prototype let
  `this.constructor.constructor("return process.env")()` read runner secrets — the path
  #61's fix missed. Fixed with a null-prototype context global; verified closed.
- **Round-2 code (#64):** nft/defi skills enforce `MAX_TRANSFER_XPR`; A2A discovery
  SSRF guard; poller string/numeric job-state normalization; newest-first job
  pagination; tightened deliverable-iframe sandbox.
- **Indexer identity (#66):** feedback dispute-id off-by-one vs `availablePrimaryKey`;
  job/listing dedup tightened with the immutable `created_at`.
- **Indexer poller (#16, this round):** Hyperion `after=<block>` is inclusive, so a
  block with >100 actions stalled the poller. Fixed with skip-paging + `global_sequence`
  dedup (bounded drain per poll).
- **Indexer poller follow-up (#68, codex/astra review of #67):** a block with >5000
  actions (over the per-poll page cap) still stalled — the drain restarted `skip` at 0
  every poll and never reached past the cap. Fixed with a persisted per-contract skip
  cursor. Also: intra-poll dedup now compares against the running max seq (was the
  poll-start snapshot), so a mid-drain window shift (failover / tip insert) can't
  double-emit an action.

### Accepted residuals (documented, low-severity / environment-gated)
- **DNS-rebinding TOCTOU** in the skill SSRF guard (web-scraping/creative). *Remaining
  vector:* the guard resolves the host and validates the IP, then `fetch` resolves it a
  second time — an attacker controlling authoritative DNS with a sub-second TTL could
  return a public IP to the guard and a private one to `fetch`, winning the race between
  the two lookups. *Compensating controls already in place:* http(s) scheme allow-list;
  every redirect hop is re-validated (public→internal 302 is closed); the private-IP
  matcher covers loopback, link-local incl. the `169.254.169.254` metadata IP, ULA,
  CGNAT, and IPv4-mapped IPv6. *Why accepted:* both airtight fixes cost more than the gap
  — an undici custom-lookup dispatcher breaks the skills' deliberate zero-dependency
  bundling, and a `node:https` rewrite reimplements `fetch`'s Response/gzip/abort across
  three call sites (new bug surface on a security-critical path). Blast radius is limited:
  Charlie runs bare-metal (no metadata endpoint); only cloud-hosted runners (Railway) are
  exposed at all. *Revisit trigger:* if runners are ever hosted on a cloud with a
  sensitive instance-metadata endpoint, apply the undici `connect.lookup` fix (pins the
  validated IP at connect time while preserving SNI).
- **Indexer async id-correction matchers** stay loose (client+title+hash / agent+title).
  Tightening with `created_at` risks breaking ALL correction (action timestamp vs
  chain-RPC `created_at`), worse than the narrow repeat-same-title mis-assignment.
- ~~Cross-recipient A2A replay and A2A authority-threshold handling (codex#7/#8)~~ —
  **FIXED** after this round: threshold-aware auth + `a2a` permission (#70) and audience +
  chain id bound into the signed digest (#71, SDK 0.5.0, openclaw 0.8.2).

### Bounty
0xgons paid 15,000 XPR (protonnz → artfak) for the validator slash-evasion report;
20,000 XPR was paid earlier for the FE-2026-09-01 stored XSS.


## Addendum: 0xgons batch 2 — reports of 2026-09-21/22

Four reports from **0xgons**, all reviewed against the 11 September commit `de2c97f`. Each was
checked against current `main` and, for contracts, the mainnet code hash.

### AGENTRUN-RUN-AUTHBYPASS — HIGH — VALID, fixed in #77
The Telegram bridge (`openclaw/starter/telegram/`) holds the agent runner's hook token, but it added
every sender to its owner list and forwarded their message to `/run`. Anyone who found the bot could
drive the agent's tool loop (the runner runs with `confirmHighRisk: false`). Only operators who enabled
the bridge were affected.

**Fix:** the bridge now requires `TELEGRAM_OWNER_IDS` (Telegram user ids), answers only those users in
a private chat, never adds senders on its own, drops previously saved non-owner chats, and refuses to
start without the allowlist.

### A2A-DEFAULT-AUTHZ — MEDIUM — VALID, fixed in #77
#64 (19 September) changed the runner's code default to `A2A_TOOL_MODE=readonly`, but every installer
(`start.sh`, `bootstrap.sh`, `.env.example`, both compose files) still wrote `A2A_TOOL_MODE=full`, so
real installs gave any signed caller the write tools. The report was valid in practice.

**Fix:** every shipped configuration now defaults to `readonly`, and A2A callers must be registered,
active agents by default (`A2A_REQUIRE_REGISTERED=true`), which `docs/A2A.md` already claimed.
Charlie's runner `.env` also had the installer's `full` and was set to `readonly`.
**Lesson:** when a report cites a default, check the installers and `.env` templates, not only the
code default.

### A2A-AGENTCARD-SSRF — duplicate of #64
`resolveEndpoint` has validated every on-chain endpoint with `assertPublicHttpUrl` since #64
(19 September, before the report). While re-checking it we found that `A2AClient` followed redirects,
so a public endpoint could bounce to an internal address. `A2AClient` now fetches with
`redirect: 'error'` (#77, SDK 0.5.1).

### AGENTVALID-CHALLENGE-DESYNC — duplicate, already deployed
At `de2c97f`, both `cancelchal` and `expireunfund` reset `validation.challenged` while a sibling
challenge was funded, allowing a second funded challenge and a double slash. Both fixes were live on
mainnet before the report: `cancelchal` on 17 September (setcode tx `55123154…`) and `expireunfund`
on 21 September (setcode tx `8ab4944d…`). #78 adds a regression test for the cancel path, run
against the wasm whose hash equals mainnet `agentvalid` (`57adeb5e…`).

### Related cleanup
- **Docker path retired (#80).** `bootstrap.sh`, `setup.sh` and `openclaw/starter/docker/` pulled GHCR
  images that had not been rebuilt since April 2026, so they shipped a runner and bridge missing
  every fix since. All three GHCR images were deleted.
- **Public RPC defaults.** Replaced `proton.eosusa.io` in shipped defaults and docs with producer
  endpoints that serve both chain RPC and Hyperion history (Saltant, with ProtonUK as the
  alternative). The frontend and deploy-service frontend also had the wrong testnet chain id, which is
  now corrected.

### Bounty
10,000 XPR paid to 0xgons (5,000 each for AGENTRUN-RUN-AUTHBYPASS and A2A-DEFAULT-AUTHZ), msig
`paul123/bountysep23`, executed 2026-09-23. The two duplicates were not paid.

**Update 2026-09-25:** the bounty tiers briefly published in `SECURITY.md` drew a flood of
low-quality, automated submissions. The bounty was withdrawn: there is no bounty, and reports are
accepted only as public GitHub issues.

## Addendum: emailed reports of 2026-09-24/25 and contract batch (#87)

Reports received by email before the reporting policy changed (see the update above). Each was checked
against current `main` and, for contracts, the mainnet code hash.

### ESCROW-RAM-EXHAUSTION — MEDIUM — VALID, fixed in #87 (Luis Zaenudin)
`createjob` and `addmilestone` stored rows on contract-paid RAM with no per-account limit, so one
account could fill `agentescrow`'s RAM with unfunded jobs and block every new job, bid and listing.
1 MB of RAM was bought for `agentescrow` as a stopgap.

**Fix:** new `openjobs` counter caps unfunded jobs per client (default 5; freed on fund, cancel or
removal), a per-job milestone cap (default 20), and a permissionless `cleanstale` that removes
unfunded jobs older than `stale_after` (default 30 days) with their milestones, bids and messages.
Limits live in the new `limits` singleton, set by the owner with `setlimits`.

### ESCROW-ARBITRATOR-CONFLICT — MEDIUM — VALID, fixed in #87 (agung)
Nothing stopped a job's client or agent from being its arbitrator, so a client could name itself
arbitrator and award itself the escrow. `createjob` and `selectbid` now reject it, and `arbitrate`
rejects a party to the job; existing conflicted jobs fall back to the owner as arbitrator.

### Skill tools bypassed the transfer cap — VALID, fixed in #85 (wanz; Galih duplicate)
Bundled skills signed transactions without the `MAX_TRANSFER_AMOUNT` check the core tools applied.
The cap is now enforced once, at the signing layer (`openclaw/src/util/transfer-cap.ts`), for every
tool and skill (openclaw 0.8.4). The same report noted squattable names on `agentdeploy`; that
service was already retired and the contract has been paused.

### msig_approve blind approval — VALID, fixed in #86 (agung)
`msig_approve` let the model approve any proposal without seeing its actions, which bypassed the
transfer cap. It is now disabled unless the operator sets `ENABLE_MSIG_APPROVE=true` (openclaw 0.8.5).

### AGENTFEED-PAYPROOF-NO-REMOVE — LOW — VALID, fixed in #87 (0xgons; Akbar duplicate)
`verifypay(false)` only flagged the review; its score stayed in the aggregate and `recalc` counted it
again. A rejected proof now removes the review from scoring everywhere (aggregate, context and
directional trust), and a proof can be decided only once.

### Decay/resolve weight mismatch — found internally 2026-09-22, fixed in #87 (Wildanoel duplicate)
`resolve(upheld)` subtracted the undecayed weight from totals `recalc` had stored with decayed
weights, so the average could exceed 100% until the next recalc. `resolve` now rebuilds the aggregate
with the same rules as `recalc`.

### Not changed
- AGENTFEED-RECALC-DOS and AGENTFEED-SYBIL (0xgons): informational, and a duplicate of the queued
  review-gating change respectively.
- `?active=false` on the indexer returns public chain data.

### Deployment
`agentescrow` and `agentfeed` deployed to mainnet by msig `paul123/deploysep25`, executed 2026-09-25
(tx `fb6e4b1f…`). Code hashes match the #87 build: `agentescrow` `a55c3428…`, `agentfeed` `76a7bd6a…`.
The ABI change is additive only (`limits`, `openjobs`, `setlimits`, `cleanstale`).

Valid reports received before the policy change were compensated once; duplicates were not. There is
no bounty for any later report.


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
