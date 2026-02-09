import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { initDatabase, updateStats, getLastCursor, updateCursor, ensureContractCursors, getContractCursors, updateContractCursor, isActionProcessed, pruneProcessedActions } from './db/schema';
import { HyperionStream, StreamAction } from './stream';
import { HyperionPoller } from './poller';
import { handleAgentAction, handleAgentCoreTransfer } from './handlers/agent';
import { handleFeedbackAction } from './handlers/feedback';
import { handleValidationAction, handleValidationTransfer } from './handlers/validation';
import { handleEscrowAction, handleEscrowTransfer } from './handlers/escrow';
import { createRoutes } from './api/routes';
import { WebhookDispatcher } from './webhooks/dispatcher';

// Configuration
const config = {
  port: parseInt(process.env.PORT || '3001'),
  dbPath: process.env.DB_PATH || './data/agents.db',
  hyperionEndpoints: (process.env.HYPERION_ENDPOINTS || process.env.HYPERION_ENDPOINT || 'https://proton.eosusa.io')
    .split(',')
    .map(e => e.trim())
    .filter(e => e.length > 0),
  contracts: {
    agentcore: process.env.AGENT_CORE_CONTRACT || 'agentcore',
    agentfeed: process.env.AGENT_FEED_CONTRACT || 'agentfeed',
    agentvalid: process.env.AGENT_VALID_CONTRACT || 'agentvalid',
    agentescrow: process.env.AGENT_ESCROW_CONTRACT || 'agentescrow',
    token: 'eosio.token',
  },
};

// Initialize database
console.log('Initializing database...');
const db = initDatabase(config.dbPath);
updateStats(db);

// Create Express app
const app = express();

// CORS: use allowlist from env, default to localhost origins for development
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:3001')
  .split(',')
  .map(o => o.trim())
  .filter(o => o.length > 0);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl, health checks)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
}));
app.use(express.json());

// Rate limiting: 100 requests per minute per IP
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_RPM || '100'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api', limiter);

// Initialize webhook dispatcher
const dispatcher = new WebhookDispatcher(db);

// Mount API routes (pass dispatcher so webhook CRUD can reload the in-memory cache)
app.use('/api', createRoutes(db, dispatcher));

// Track stream connection status
let streamConnected = false;

// Health check — always 200 so Railway/Docker health checks pass.
// Stream status is informational only.
app.get('/health', (req, res) => {
  const status = streamConnected ? 'ok' : 'degraded';
  res.json({ status, stream: streamConnected, timestamp: new Date().toISOString() });
});

// Start HTTP server
const server = app.listen(config.port, () => {
  console.log(`API server running on port ${config.port}`);
});

// Ensure all configured contracts have cursor rows (seeds missing ones with block 0)
const allContracts = Object.values(config.contracts);
ensureContractCursors(db, allContracts);

// Read cursors for resume — per-contract cursors are authoritative
const lastBlock = getLastCursor(db);
const contractCursors = getContractCursors(db);
if (lastBlock > 0 || [...contractCursors.values()].some(b => b > 0)) {
  console.log('Resuming per-contract cursors:');
  for (const [c, b] of contractCursors) {
    console.log(`  ${c}: block ${b}`);
  }
}

// Frozen snapshot of per-contract cursors at startup for bulk skip optimization.
const resumeCursors: ReadonlyMap<string, number> = new Map(contractCursors);

// Prune old dedup entries on startup to bound table size
pruneProcessedActions(db, 0);

// Action handler shared by both stream and poller.
// Two-layer dedup:
//   1. Block-level: skip actions in blocks strictly below the contract's persisted cursor (fast bulk skip)
//   2. Action-level: skip actions by global_sequence if already in processed_actions (exact boundary dedup)
function handleAction(action: StreamAction): void {
  const contract = action.act.account;

  // Layer 1: bulk skip — blocks well below this contract's cursor are definitely done
  const resumeBlock = resumeCursors.get(contract) || 0;
  if (resumeBlock > 0 && action.block_num < resumeBlock) {
    return;
  }

  // Layer 2: exact dedup via global_sequence — prevents boundary-block duplicates
  if (isActionProcessed(db, action.global_sequence)) {
    return;
  }

  try {
    if (contract === config.contracts.agentcore) {
      handleAgentAction(db, action, dispatcher);
    } else if (contract === config.contracts.agentfeed) {
      handleFeedbackAction(db, action, dispatcher);
    } else if (contract === config.contracts.agentvalid) {
      handleValidationAction(db, action, dispatcher);
    } else if (contract === config.contracts.agentescrow) {
      handleEscrowAction(db, action, dispatcher);
    } else if (contract === config.contracts.token && action.act.name === 'transfer') {
      const { from, to } = action.act.data;
      if (to === config.contracts.agentescrow || from === config.contracts.agentescrow) {
        handleEscrowTransfer(db, action, config.contracts.agentescrow, dispatcher);
      }
      if (to === config.contracts.agentvalid || from === config.contracts.agentvalid) {
        handleValidationTransfer(db, action, config.contracts.agentvalid, dispatcher);
      }
      if (to === config.contracts.agentcore) {
        handleAgentCoreTransfer(db, action);
      }
    }

    // Update cursors after successful processing
    updateCursor(db, action.block_num);
    updateContractCursor(db, contract, action.block_num);
  } catch (error) {
    console.error(`Error handling action ${action.act.name}:`, error);
  }
}

// Auto-detect streaming support and choose stream vs poller
const usePolling = process.env.USE_POLLING === 'true';

async function checkStreamingSupport(endpoint: string): Promise<boolean> {
  try {
    const res = await fetch(`${endpoint}/v2/health`);
    if (!res.ok) return false;
    const data = await res.json() as any;
    return data?.features?.streaming?.enable === true;
  } catch {
    return false;
  }
}

let source: HyperionStream | HyperionPoller;

async function startIngestion(): Promise<void> {
  const endpoint = config.hyperionEndpoints[0];
  const streamingAvailable = !usePolling && await checkStreamingSupport(endpoint);

  // Per-contract cursors are always populated (ensureContractCursors seeds missing ones with 0).
  // For streaming (single start block), use the minimum across all contracts as safe resume point.
  const safeResumeBlock = Math.min(...contractCursors.values());

  if (streamingAvailable) {
    console.log('Streaming supported — using WebSocket mode');
    const stream = new HyperionStream({
      endpoints: config.hyperionEndpoints,
      contracts: allContracts,
      irreversibleOnly: true,
      ...(safeResumeBlock > 0 && { startBlock: safeResumeBlock }),
    });
    source = stream;
  } else {
    console.log('Streaming not available — using polling mode');
    const poller = new HyperionPoller({
      endpoint,
      contracts: allContracts,
      pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '5000'),
      contractStartBlocks: contractCursors,
    });
    source = poller;
  }

  source.on('connected', () => {
    console.log('Ingestion connected');
    streamConnected = true;
  });

  source.on('disconnected', () => {
    console.log('Ingestion disconnected');
    streamConnected = false;
  });

  source.on('action', handleAction);

  source.on('error', (error) => {
    console.error('Ingestion error:', error);
  });

  if (source instanceof HyperionStream) {
    source.connect();
  } else {
    source.start();
  }
}

startIngestion();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  if (source) source.disconnect();
  server.close();
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  if (source) source.disconnect();
  server.close();
  db.close();
  process.exit(0);
});

console.log('XPR Agents Indexer started');
