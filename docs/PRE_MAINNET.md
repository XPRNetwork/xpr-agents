# Pre-Mainnet Checklist

Items to address before deploying to XPR Network mainnet.

## Contract Changes (require redeployment)

- [ ] **Open arbitration for unassigned disputes** — Allow any registered arbitrator to claim and resolve disputes on jobs that have no designated arbitrator (`EMPTY_NAME`). Currently only the contract owner can resolve these via fallback. Add a `claimdispute` action where an active, sufficiently-staked arbitrator assigns themselves to a disputed job, then resolves via the normal `arbitrate` flow.

## Infrastructure

- [ ] Mainnet Hyperion endpoints configured
- [ ] Mainnet RPC endpoints configured
- [ ] Production API keys (Anthropic, Replicate, Pinata)
- [ ] Contract accounts created on mainnet
- [ ] Contract init parameters reviewed (platform fee, min stakes, timeouts)

## Security

- [ ] Final security audit pass
- [ ] All test keys/tokens rotated
- [ ] Rate limiting tuned for production load
- [ ] Webhook tokens regenerated

## Frontend

- [ ] Update RPC/Hyperion endpoints for mainnet
- [ ] Update OG metadata URLs
- [ ] Verify wallet connects to mainnet
