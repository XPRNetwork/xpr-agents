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
  # Pause all contracts
  # agentcore setconfig: min_stake, registration_fee, claim_fee, feed_contract, valid_contract, escrow_contract, paused
  proton action agentcore setconfig '[0,0,100000,"agentfeed","agentvalid","agentescrow",true]' owner@active
  # agentfeed setconfig: core_contract, min_score, max_score, dispute_window, decay_period, decay_floor, paused, feedback_fee
  proton action agentfeed setconfig '["agentcore",1,5,86400,3600,50,true,0]' owner@active
  # agentvalid setconfig: core_contract, min_stake, challenge_stake, unstake_delay, challenge_window, slash_percent, dispute_period, funded_challenge_timeout, paused, validation_fee
  proton action agentvalid setconfig '["agentcore",10000,50000,86400,3600,1000,172800,604800,true,0]' owner@active
  # agentescrow setconfig: platform_fee, min_job_amount, default_deadline_days, dispute_window, paused
  proton action agentescrow setconfig '[200,10000,30,604800,true]' owner@active

  # Unpause (same commands with paused=false)
  proton action agentcore setconfig '[0,0,100000,"agentfeed","agentvalid","agentescrow",false]' owner@active
  proton action agentfeed setconfig '["agentcore",1,5,86400,3600,50,false,0]' owner@active
  proton action agentvalid setconfig '["agentcore",10000,50000,86400,3600,1000,172800,604800,false,0]' owner@active
  proton action agentescrow setconfig '[200,10000,30,604800,false]' owner@active
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
- [ ] Verify `verifyclaim` with zero deposit does not desync indexer (known gap — reconcile via periodic chain sync or accept drift)

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
  - `verifyclaim` with zero-deposit owner removal may drift indexer state without periodic chain reconciliation
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
# agentcore: min_stake, registration_fee, claim_fee, feed_contract, valid_contract, escrow_contract, paused
proton action agentcore setconfig '[0,0,100000,"agentfeed","agentvalid","agentescrow",true]' owner@active
# agentfeed: core_contract, min_score, max_score, dispute_window, decay_period, decay_floor, paused, feedback_fee
proton action agentfeed setconfig '["agentcore",1,5,86400,3600,50,true,0]' owner@active
# agentvalid: core_contract, min_stake, challenge_stake, unstake_delay, challenge_window, slash_percent, dispute_period, funded_challenge_timeout, paused, validation_fee
proton action agentvalid setconfig '["agentcore",10000,50000,86400,3600,1000,172800,604800,true,0]' owner@active
# agentescrow: platform_fee, min_job_amount, default_deadline_days, dispute_window, paused
proton action agentescrow setconfig '[200,10000,30,604800,true]' owner@active
```

### Indexer Resync

```bash
# All commands run from the indexer/ directory
cd indexer/

# Stop indexer process
# Back up current DB
cp ./data/agents.db ./data/agents.db.bak

# Option A: Full replay from genesis
rm ./data/agents.db
HYPERION_ENDPOINTS="https://proton.eosusa.io,https://proton.greymass.com" npm start

# Option B: Restore from backup and resume from cursor
cp ./data/agents.db.bak ./data/agents.db
npm start  # resumes from last saved cursor block
```

### Frontend Maintenance Mode

```bash
# From frontend/ directory — Next.js has no built-in deploy script;
# use your hosting provider's CLI or CI/CD pipeline
cd frontend/
NEXT_PUBLIC_MAINTENANCE=true npm run build

# Deploy via your platform (e.g., Vercel, Netlify, or custom):
# vercel --prod
# netlify deploy --prod
# rsync -avz out/ user@host:/var/www/frontend/
```
