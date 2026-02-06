import express from 'express';
import cors from 'cors';
import { initDatabase, updateStats, getLastCursor, updateCursor } from './db/schema';
import { HyperionStream, StreamAction } from './stream';
import { handleAgentAction, handleAgentCoreTransfer } from './handlers/agent';
import { handleFeedbackAction } from './handlers/feedback';
import { handleValidationAction, handleValidationTransfer } from './handlers/validation';
import { handleEscrowAction, handleEscrowTransfer } from './handlers/escrow';
import { createRoutes } from './api/routes';

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
app.use(cors());
app.use(express.json());

// Mount API routes
app.use('/api', createRoutes(db));

// Track stream connection status
let streamConnected = false;

// Health check with connection status
app.get('/health', (req, res) => {
  if (streamConnected) {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } else {
    res.status(503).json({ status: 'degraded', timestamp: new Date().toISOString() });
  }
});

// Start HTTP server
const server = app.listen(config.port, () => {
  console.log(`API server running on port ${config.port}`);
});

// Read cursor for resume
const lastBlock = getLastCursor(db);
if (lastBlock > 0) {
  console.log(`Resuming from block ${lastBlock}`);
}

// Initialize Hyperion stream with multi-endpoint support
const stream = new HyperionStream({
  endpoints: config.hyperionEndpoints,
  contracts: Object.values(config.contracts),
  irreversibleOnly: true,
  ...(lastBlock > 0 && { startBlock: lastBlock }),
});

// Handle stream events
stream.on('connected', () => {
  console.log('Connected to Hyperion stream');
  streamConnected = true;
});

stream.on('disconnected', () => {
  console.log('Disconnected from Hyperion stream');
  streamConnected = false;
});

stream.on('action', (action: StreamAction) => {
  const contract = action.act.account;

  try {
    if (contract === config.contracts.agentcore) {
      handleAgentAction(db, action);
    } else if (contract === config.contracts.agentfeed) {
      handleFeedbackAction(db, action);
    } else if (contract === config.contracts.agentvalid) {
      handleValidationAction(db, action);
    } else if (contract === config.contracts.agentescrow) {
      handleEscrowAction(db, action);
    } else if (contract === config.contracts.token && action.act.name === 'transfer') {
      const { from, to } = action.act.data;
      if (to === config.contracts.agentescrow || from === config.contracts.agentescrow) {
        handleEscrowTransfer(db, action, config.contracts.agentescrow);
      }
      if (to === config.contracts.agentvalid || from === config.contracts.agentvalid) {
        handleValidationTransfer(db, action, config.contracts.agentvalid);
      }
      if (to === config.contracts.agentcore) {
        handleAgentCoreTransfer(db, action);
      }
    }

    // Update cursor after successful processing
    updateCursor(db, action.block_num);
  } catch (error) {
    console.error(`Error handling action ${action.act.name}:`, error);
  }
});

stream.on('error', (error) => {
  console.error('Stream error:', error);
});

// Connect to stream
stream.connect();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  stream.disconnect();
  server.close();
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  stream.disconnect();
  server.close();
  db.close();
  process.exit(0);
});

console.log('XPR Agents Indexer started');
