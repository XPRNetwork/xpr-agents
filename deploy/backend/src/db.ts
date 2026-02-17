import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = process.env.DB_PATH || './data/deploy.db';

// Ensure data directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS deployments (
    agent_account TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    worker_name TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    encrypted_key TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'hosted',
    status TEXT NOT NULL DEFAULT 'provisioning',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_deployments_owner ON deployments(owner);
  CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);
`);
