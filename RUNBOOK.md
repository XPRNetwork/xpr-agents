# Go/No-Go Checklist & Launch Runbook

## Release Freeze

- [ ] Pin exact commit SHA for contracts, SDK, indexer, frontend
- [ ] Tag release versions (`contracts@1.0.0`, `sdk@0.1.0`, `indexer@1.0.0`, `frontend@1.0.0`) and lock dependency files

## Deterministic Build + Test

- [ ] Clean install from scratch on CI
- [ ] Run all contract suites (32 + 23 + 28 + 31 = 114 tests) plus SDK (172 tests)
- [ ] Build indexer and frontend from clean state
- [ ] Re-run indexer from empty DB and verify no migration/runtime errors

## Contract Safety

- [ ] Verify deployed account permissions (`owner`/`active`, `eosio.code`, msig policy)
- [ ] Confirm config values on-chain (fees, timeouts, min stake, `paused=false`)
- [ ] Confirm emergency pause and unpause paths work:
  ```bash
  # Pause
  proton action agentcore setconfig '["owner","agentcore",0,true]' owner@active
  proton action agentfeed setconfig '["agentcore",1,5,86400,3600,50,true,0]' owner@active
  proton action agentvalid setconfig '["agentcore",10000,50000,86400,3600,1000,172800,604800,true,0]' owner@active
  proton action agentescrow setconfig '["agentcore",10000,500,200,true]' owner@active

  # Unpause (same commands with paused=false)
  ```

## End-to-End Shadow Simulation

- [ ] **Agent lifecycle**: register → update → setstatus → deactivate/reactivate
- [ ] **Claim flow**: approveclaim → transfer deposit with `claim:agent:owner` memo → claim → verifyclaim
- [ ] **Transfer/release flow**: transfer ownership (3-sig) → release (deposit refunded)
- [ ] **Job lifecycle**: create → fund → accept → start → deliver → approve
- [ ] **Dispute lifecycle**: dispute → arbitrate (with explicit arbitrator)
- [ ] **Dispute fallback**: dispute → arbitrate (without arbitrator, owner fallback at 0% fee)
- [ ] **Validator lifecycle**: regval → stake → validate → challenge (funded + unfunded) → resolve → unstake → withdraw
- [ ] **Plugin lifecycle**: regplugin → addplugin → toggleplugin → pluginres → rmplugin
- [ ] **Escrow milestones**: add milestones → submit → approve milestones → verify partial `released_amount`
- [ ] **Cleanup actions**: cleanfback, cleandisps (feed), cleanvals, cleanchals (valid), cleanjobs, cleandisps (escrow)
- [ ] **Fee paths** (if fees enabled): regfee deposit → register, feedfee deposit → submit, valfee deposit → validate

## Indexer/API Integrity

- [ ] Replay from genesis or import trusted snapshot (required due to synthetic ID mapping)
- [ ] Compare sampled API rows vs chain tables for agents, jobs, disputes, challenges
- [ ] Validate ownership events (approveclaim/claim/verifyclaim/release/transfer) match chain state
- [ ] Verify cursor tracking: stop indexer, restart, confirm it resumes from last block

## Operational Readiness

- [ ] **Monitoring**: contract action failures, indexer lag, API error rate, DB growth
- [ ] **Alerts**: wired to on-call channel with escalation path
- [ ] **Runbooks written for**:
  - Pause all contracts (emergency)
  - Resume contracts
  - Indexer resync from scratch
  - Hotfix deploy (contract upgrade flow)

## Rollback Readiness

- [ ] Pre-approved rollback plan with exact commands and owners
- [ ] Backup/restore tested for indexer DB
- [ ] "Stop trading" path tested (pause contracts or frontend maintenance mode)
- [ ] Contract downgrade path documented (or decision to roll forward only)

## Risk Sign-Off

- [ ] Explicitly accept known limitations:
  - Indexer synthetic ID mapping requires genesis replay or trusted snapshot seeding
  - `reviewer_kyc_level` in indexer remains 0 unless external sync job is added (scores diverge from on-chain)
- [ ] Final security review recorded
- [ ] Legal/compliance sign-off recorded (if applicable)

---

## Launch Sequence

| Step | Action | Owner | Verification |
|------|--------|-------|--------------|
| 1 | Deploy contracts with final permissions | Contract deployer | `proton table` spot checks |
| 2 | Run smoke tests on live chain | QA | All shadow simulation items green |
| 3 | Start indexer from approved sync point | Infra | API returns correct data vs chain |
| 4 | Enable frontend for limited cohort | Frontend | Manual walkthrough of all flows |
| 5 | Expand traffic after 24h stable metrics | Ops | Monitoring dashboards clean |

---

## Emergency Procedures

### Pause All Contracts

```bash
# Requires owner authority on each contract
proton action agentcore setconfig '["owner","agentcore",0,true]' owner@active
proton action agentfeed setconfig '["agentcore",1,5,86400,3600,50,true,0]' owner@active
proton action agentvalid setconfig '["agentcore",10000,50000,86400,3600,1000,172800,604800,true,0]' owner@active
proton action agentescrow setconfig '["agentcore",10000,500,200,true]' owner@active
```

### Indexer Resync

```bash
# Stop indexer
# Back up current DB
cp ./data/agents.db ./data/agents.db.bak

# Option A: Full replay
rm ./data/agents.db
HYPERION_ENDPOINTS="https://proton.eosusa.io,https://proton.greymass.com" npm start

# Option B: Restore from backup
cp ./data/agents.db.bak ./data/agents.db
npm start  # resumes from cursor
```

### Frontend Maintenance Mode

```bash
# Deploy static maintenance page or set env flag
NEXT_PUBLIC_MAINTENANCE=true npm run build && npm run deploy
```
