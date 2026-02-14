FROM node:20-alpine

WORKDIR /app

# Install build deps for native modules
RUN apk add --no-cache python3 make g++

# Copy agent runner package files and install from npm
COPY package.json tsconfig.json ./
COPY src ./src
COPY skills ./skills
RUN npm install && npm run build \
  && npx tsc --outDir skills/creative/dist --rootDir skills/creative/src skills/creative/src/index.ts --esModuleInterop --skipLibCheck --module commonjs --target ES2020 \
  && npx tsc --outDir skills/web-scraping/dist --rootDir skills/web-scraping/src skills/web-scraping/src/index.ts --esModuleInterop --skipLibCheck --module commonjs --target ES2020 \
  && npx tsc --outDir skills/code-sandbox/dist --rootDir skills/code-sandbox/src skills/code-sandbox/src/index.ts --esModuleInterop --skipLibCheck --module commonjs --target ES2020 \
  && npx tsc --outDir skills/structured-data/dist --rootDir skills/structured-data/src skills/structured-data/src/index.ts --esModuleInterop --skipLibCheck --module commonjs --target ES2020 \
  && npx tsc --outDir skills/defi/dist --rootDir skills/defi/src skills/defi/src/index.ts --esModuleInterop --skipLibCheck --module commonjs --target ES2020 \
  && npx tsc --outDir skills/nft/dist --rootDir skills/nft/src skills/nft/src/index.ts --esModuleInterop --skipLibCheck --module commonjs --target ES2020 \
  && npx tsc --outDir skills/tax/dist --rootDir skills/tax/src skills/tax/src/index.ts --esModuleInterop --skipLibCheck --module commonjs --target ES2020 \
  && npx tsc --outDir skills/lending/dist --rootDir skills/lending/src skills/lending/src/index.ts --esModuleInterop --skipLibCheck --module commonjs --target ES2020 \
  && npx tsc --outDir skills/governance/dist --rootDir skills/governance/src skills/governance/src/index.ts --esModuleInterop --skipLibCheck --module commonjs --target ES2020 \
  && npx tsc --outDir skills/xmd/dist --rootDir skills/xmd/src skills/xmd/src/index.ts --esModuleInterop --skipLibCheck --module commonjs --target ES2020

RUN mkdir -p /data && chown node:node /data

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --spider -q http://localhost:8080/health || exit 1

USER node

ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/index.js"]
