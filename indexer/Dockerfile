FROM node:20-alpine

WORKDIR /app

# Install build dependencies for better-sqlite3 native module
RUN apk add --no-cache python3 make g++

# Copy package files and install
COPY indexer/package.json indexer/tsconfig.json ./
RUN npm install

# Copy source and build
COPY indexer/src ./src
RUN npm run build

# Create data directory
RUN mkdir -p /data && chown node:node /data

USER node

ENV DB_PATH=/data/agents.db
ENV PORT=3001

EXPOSE 3001

CMD ["node", "dist/index.js"]
