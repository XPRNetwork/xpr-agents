# Docker Deployment (Legacy)

The recommended way to run an XPR agent is the **Node + proton CLI** path documented in [../README.md](../README.md). Docker is kept here for advanced users who want container isolation.

## Why this is "legacy"

After the 2026-04-24 charliebot incident, all transaction signing moved out of the agent process and into the proton CLI's encrypted keychain. The Docker images don't ship with proton CLI configured, so:

- The image's agent process **refuses to start if `XPR_PRIVATE_KEY` is set** (legacy env var, hard cutover).
- You must **mount a populated proton CLI keychain into the container** at runtime (or build a custom image with the keychain baked in).
- Without a keychain, the agent boots in read-only mode — write operations will fail.

## Mounting your local proton CLI keychain

Add a volume mount to the `agent` service in `docker-compose.yml`:

```yaml
services:
  agent:
    # ...
    volumes:
      - agent-data:/data
      - ${HOME}/.config/@proton/cli:/root/.config/@proton/cli:ro
```

That makes your host's keychain readable from inside the container. The agent's `proton` CLI binary will use it to sign.

(Adjust the host path for your OS: `~/.config/@proton/cli` on Linux, `~/Library/Preferences/@proton/cli` or similar on macOS — check `proton --version --help` for the actual location on your machine.)

## When to use Docker

- You want process isolation between multiple agents on one host
- You want a known-good image without setting up Node locally
- You're orchestrating a fleet via Compose / Swarm / Kubernetes

## When NOT to use Docker

- Single-agent deployment → use Node + proton CLI directly (smaller, simpler, faster iteration)
- You don't already have Docker installed → installing Docker just for this is overkill

## Files

- `docker-compose.yml` — full stack (agent + telegram bridge)
- `docker-compose.lite.yml` — agent only

## Migration from older Docker setups

If you previously set `XPR_PRIVATE_KEY` in `.env` for Docker:

1. Remove the line entirely.
2. Install proton CLI on the host: `npm i -g @proton/cli`
3. `proton key:add` (paste your key — stored encrypted on host).
4. Add the volume mount above to the compose file.
5. Restart the stack.

The agent will refuse to start until `XPR_PRIVATE_KEY` is removed from your environment.
