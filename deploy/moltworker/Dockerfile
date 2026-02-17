# XPR Agent Moltworker
# Based on cloudflare/moltworker with @xpr-agents/openclaw pre-installed
#
# This Dockerfile extends the base moltworker image to include:
# 1. The @xpr-agents/openclaw plugin (55 tools)
# 2. All 13 built-in agent skills (184+ total tools)
# 3. XPR-specific startup configuration
#
# Build: docker build -t xpr-agent-moltworker .
# Run:   docker run -e XPR_ACCOUNT=... -e XPR_PRIVATE_KEY=... xpr-agent-moltworker

FROM ghcr.io/cloudflare/moltworker:latest

# Install the OpenClaw plugin for XPR agents
RUN openclaw plugins install @xpr-agents/openclaw

# Copy XPR-specific startup script
COPY start-openclaw.sh /app/start-openclaw.sh
RUN chmod +x /app/start-openclaw.sh

# Override entrypoint to use our startup script
ENTRYPOINT ["/app/start-openclaw.sh"]
