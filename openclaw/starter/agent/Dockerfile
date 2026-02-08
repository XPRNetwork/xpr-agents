FROM node:20-alpine

WORKDIR /app

# Install build deps for native modules
RUN apk add --no-cache python3 make g++

# Copy SDK first (dependency of openclaw)
COPY sdk/package.json sdk/tsconfig.json /app/sdk/
COPY sdk/src /app/sdk/src
WORKDIR /app/sdk
RUN npm install && npm run build

# Copy openclaw plugin
COPY openclaw/package.json openclaw/tsconfig.json /app/openclaw/
COPY openclaw/src /app/openclaw/src
WORKDIR /app/openclaw
RUN npm install && npm run build

# Copy skills
COPY openclaw/skills /app/openclaw/skills

# Copy agent runner
COPY openclaw/starter/agent/package.json openclaw/starter/agent/tsconfig.json /app/agent/
COPY openclaw/starter/agent/src /app/agent/src
WORKDIR /app/agent
RUN npm install && npm run build

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --spider -q http://localhost:8080/health || exit 1

USER node

ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/index.js"]
