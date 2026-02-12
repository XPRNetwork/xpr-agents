# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email: **security@metallicus.com**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge receipt within 48 hours and aim to provide a fix or mitigation within 7 days for critical issues.

## Security Audit

This project has undergone security review. See [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md) for the full audit report.

## Scope

The following are in scope for security reports:

- Smart contracts (`contracts/`)
- TypeScript SDK (`sdk/`)
- OpenClaw plugin (`openclaw/`)
- Indexer (`indexer/`)
- Agent runner (`openclaw/starter/agent/`)
- Frontend (`frontend/`)

## Known Limitations

- The indexer cannot read on-chain KYC levels (the `submit` action doesn't include `reviewer_kyc_level`). Indexer-computed scores may differ from on-chain scores.
- Private keys passed as Docker environment variables are visible via `docker inspect`. Use Docker secrets or a vault in production.
