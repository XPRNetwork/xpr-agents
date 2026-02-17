# XPR Agent Deploy Service — Backend

The provisioning backend is maintained in a separate private repository for security.

## Repository

**Private repo:** `github.com/paulgnz/xpr-deploy-service`

## What it does

The deploy service orchestrates agent provisioning:

1. Verifies on-chain payment (agentdeploy contract subscription must be ACTIVE)
2. Generates a dedicated keypair for the agent
3. Creates a new XPR account on-chain
4. Registers the agent on agentcore
5. Approves the human owner's claim
6. Deploys a Cloudflare Worker with the agent runtime
7. Updates the agent's endpoint on-chain

## Security model

- **Payment-first:** The smart contract (public, in `deploy/contract/`) enforces payment before any deployment happens
- **No key storage:** Agent private keys exist only in memory during provisioning, then are set as Cloudflare secrets and discarded
- **Authenticated endpoints:** All API endpoints require Bearer token auth
- **Webhook auth:** Indexer webhooks use a separate WEBHOOK_SECRET
- **Rate limiting:** Deploy endpoint limited to 5/hour, auth endpoints to 20/15min
- **CORS restricted:** Only configured origins allowed

## API endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/health | None | Health check |
| GET | /api/check-name/:name | None | Check account name availability |
| GET | /api/pricing | None | Get subscription prices |
| POST | /api/deploy | Bearer | Deploy a new agent (requires on-chain payment) |
| GET | /api/status/:agent | Bearer | Get agent deployment status |
| GET | /api/deployments | Bearer | List deployments by owner |
| GET | /api/logs/:agent | Bearer | Get Cloudflare log tail session |
| POST | /api/webhook | Webhook | Indexer payment notifications |
| POST | /api/admin/* | Bearer | Admin operations |
