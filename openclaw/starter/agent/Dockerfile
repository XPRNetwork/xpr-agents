FROM node:20-alpine

WORKDIR /app

# Install build deps for native modules
RUN apk add --no-cache python3 make g++

# Copy agent runner package files and install from npm
COPY package.json tsconfig.json ./
COPY src ./src
RUN npm install && npm run build

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --spider -q http://localhost:8080/health || exit 1

USER node

ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/index.js"]
