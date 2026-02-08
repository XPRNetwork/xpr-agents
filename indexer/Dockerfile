FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDeps for tsc)
RUN npm ci

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# ---- Production stage ----
FROM node:20-alpine

WORKDIR /app

# Install native-module build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Create data directory and set ownership for non-root user
RUN mkdir -p /data && chown node:node /data

# Run as non-root user
USER node

# Expose port
EXPOSE 3001

# Start the indexer
CMD ["node", "dist/index.js"]
