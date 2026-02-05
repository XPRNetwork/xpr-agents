import express from 'express';
import cors from 'cors';
import { initDatabase, updateStats } from './db/schema';
import { HyperionStream, StreamAction } from './stream';
import { handleAgentAction } from './handlers/agent';
import { handleFeedbackAction } from './handlers/feedback';
import { handleValidationAction } from './handlers/validation';
import { handleEscrowAction } from './handlers/escrow';
import { createRoutes } from './api/routes';

// Configuration
const config = {
  port: parseInt(process.env.PORT || '3001'),
  dbPath: process.env.DB_PATH || './data/agents.db',
  hyperionEndpoint: process.env.HYPERION_ENDPOINT || 'https://proton.eosusa.io',
  contracts: {
    agentcore: process.env.AGENT_CORE_CONTRACT || 'agentcore',
    agentfeed: process.env.AGENT_FEED_CONTRACT || 'agentfeed',
    agentvalid: process.env.AGENT_VALID_CONTRACT || 'agentvalid',
    agentescrow: process.env.AGENT_ESCROW_CONTRACT || 'agentescrow',
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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start HTTP server
const server = app.listen(config.port, () => {
  console.log(`API server running on port ${config.port}`);
});

// Initialize Hyperion stream
const stream = new HyperionStream({
  endpoint: config.hyperionEndpoint,
  contracts: Object.values(config.contracts),
  irreversibleOnly: true,
});

// Handle stream events
stream.on('connected', () => {
  console.log('Connected to Hyperion stream');
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
    }
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
