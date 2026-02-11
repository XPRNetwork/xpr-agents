import Database from 'better-sqlite3';

export function initDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
    -- Agents table
    -- P2 FIX: Added ownership fields (owner, pending_owner, claim_deposit, deposit_payer)
    CREATE TABLE IF NOT EXISTS agents (
      account TEXT PRIMARY KEY,
      owner TEXT,
      pending_owner TEXT,
      name TEXT NOT NULL,
      description TEXT,
      endpoint TEXT,
      protocol TEXT,
      capabilities TEXT,
      stake INTEGER DEFAULT 0,
      total_jobs INTEGER DEFAULT 0,
      registered_at INTEGER,
      active INTEGER DEFAULT 1,
      trust_score INTEGER DEFAULT 0,
      claim_deposit INTEGER DEFAULT 0,
      deposit_payer TEXT,
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    -- Index for querying agents by owner
    CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner);

    -- Agent scores table
    CREATE TABLE IF NOT EXISTS agent_scores (
      agent TEXT PRIMARY KEY,
      total_score INTEGER DEFAULT 0,
      total_weight INTEGER DEFAULT 0,
      feedback_count INTEGER DEFAULT 0,
      avg_score INTEGER DEFAULT 0,
      last_updated INTEGER
    );

    -- Feedback table
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY,
      agent TEXT NOT NULL,
      reviewer TEXT NOT NULL,
      reviewer_kyc_level INTEGER DEFAULT 0,
      score INTEGER NOT NULL,
      tags TEXT,
      job_hash TEXT,
      evidence_uri TEXT,
      amount_paid INTEGER DEFAULT 0,
      timestamp INTEGER,
      disputed INTEGER DEFAULT 0,
      resolved INTEGER DEFAULT 0,
      FOREIGN KEY (agent) REFERENCES agents(account)
    );

    -- Feedback Disputes table (maps dispute_id -> feedback_id)
    CREATE TABLE IF NOT EXISTS feedback_disputes (
      id INTEGER PRIMARY KEY,
      feedback_id INTEGER NOT NULL,
      disputer TEXT NOT NULL,
      reason TEXT,
      evidence_uri TEXT,
      status INTEGER DEFAULT 0,
      resolver TEXT,
      resolution_notes TEXT,
      created_at INTEGER,
      resolved_at INTEGER,
      FOREIGN KEY (feedback_id) REFERENCES feedback(id)
    );

    -- Validators table
    CREATE TABLE IF NOT EXISTS validators (
      account TEXT PRIMARY KEY,
      stake INTEGER DEFAULT 0,
      method TEXT,
      specializations TEXT,
      total_validations INTEGER DEFAULT 0,
      incorrect_validations INTEGER DEFAULT 0,
      accuracy_score INTEGER DEFAULT 10000,
      registered_at INTEGER,
      active INTEGER DEFAULT 1
    );

    -- Validations table
    CREATE TABLE IF NOT EXISTS validations (
      id INTEGER PRIMARY KEY,
      validator TEXT NOT NULL,
      agent TEXT NOT NULL,
      job_hash TEXT,
      result INTEGER,
      confidence INTEGER,
      evidence_uri TEXT,
      challenged INTEGER DEFAULT 0,
      timestamp INTEGER,
      FOREIGN KEY (validator) REFERENCES validators(account),
      FOREIGN KEY (agent) REFERENCES agents(account)
    );

    -- Validation Challenges table (maps challenge_id -> validation_id)
    CREATE TABLE IF NOT EXISTS validation_challenges (
      id INTEGER PRIMARY KEY,
      validation_id INTEGER NOT NULL,
      challenger TEXT NOT NULL,
      reason TEXT,
      evidence_uri TEXT,
      stake INTEGER DEFAULT 0,
      funding_deadline INTEGER DEFAULT 0,
      status INTEGER DEFAULT 0,
      resolver TEXT,
      resolution_notes TEXT,
      created_at INTEGER,
      resolved_at INTEGER,
      FOREIGN KEY (validation_id) REFERENCES validations(id)
    );

    -- Plugins table
    CREATE TABLE IF NOT EXISTS plugins (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT,
      contract TEXT,
      action TEXT,
      schema TEXT,
      category TEXT,
      author TEXT,
      verified INTEGER DEFAULT 0
    );

    -- Events table for historical tracking
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      block_num INTEGER,
      transaction_id TEXT,
      action_name TEXT,
      contract TEXT,
      data TEXT,
      timestamp INTEGER DEFAULT (strftime('%s', 'now'))
    );

    -- Statistics table
    CREATE TABLE IF NOT EXISTS stats (
      key TEXT PRIMARY KEY,
      value INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    -- Initialize stats
    INSERT OR IGNORE INTO stats (key, value) VALUES ('total_agents', 0);
    INSERT OR IGNORE INTO stats (key, value) VALUES ('active_agents', 0);
    INSERT OR IGNORE INTO stats (key, value) VALUES ('total_validators', 0);
    INSERT OR IGNORE INTO stats (key, value) VALUES ('total_feedback', 0);
    INSERT OR IGNORE INTO stats (key, value) VALUES ('total_validations', 0);
    INSERT OR IGNORE INTO stats (key, value) VALUES ('total_jobs', 0);

    -- Escrow Jobs table
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY,
      client TEXT NOT NULL,
      agent TEXT NOT NULL,
      title TEXT,
      description TEXT,
      deliverables TEXT,
      amount INTEGER DEFAULT 0,
      symbol TEXT DEFAULT 'XPR',
      funded_amount INTEGER DEFAULT 0,
      released_amount INTEGER DEFAULT 0,
      state INTEGER DEFAULT 0,
      deadline INTEGER,
      arbitrator TEXT,
      job_hash TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );

    -- Job Evidence table (separate from jobs to avoid serialization issues)
    CREATE TABLE IF NOT EXISTS job_evidence (
      job_id INTEGER PRIMARY KEY,
      evidence_uri TEXT
    );

    -- Milestones table
    CREATE TABLE IF NOT EXISTS milestones (
      id INTEGER PRIMARY KEY,
      job_id INTEGER NOT NULL,
      title TEXT,
      description TEXT,
      amount INTEGER DEFAULT 0,
      milestone_order INTEGER DEFAULT 0,
      state INTEGER DEFAULT 0,
      evidence_uri TEXT,
      submitted_at INTEGER,
      approved_at INTEGER,
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    );

    -- Escrow Disputes table
    CREATE TABLE IF NOT EXISTS escrow_disputes (
      id INTEGER PRIMARY KEY,
      job_id INTEGER NOT NULL,
      raised_by TEXT NOT NULL,
      reason TEXT,
      evidence_uri TEXT,
      client_amount INTEGER DEFAULT 0,
      agent_amount INTEGER DEFAULT 0,
      resolution INTEGER DEFAULT 0,
      resolver TEXT,
      resolution_notes TEXT,
      created_at INTEGER,
      resolved_at INTEGER,
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    );

    -- Arbitrators table
    CREATE TABLE IF NOT EXISTS arbitrators (
      account TEXT PRIMARY KEY,
      stake INTEGER DEFAULT 0,
      pending_unstake INTEGER DEFAULT 0,
      fee_percent INTEGER DEFAULT 0,
      total_cases INTEGER DEFAULT 0,
      successful_cases INTEGER DEFAULT 0,
      active INTEGER DEFAULT 0
    );

    -- Initialize additional stats
    INSERT OR IGNORE INTO stats (key, value) VALUES ('total_jobs_escrow', 0);
    INSERT OR IGNORE INTO stats (key, value) VALUES ('total_open_jobs', 0);
    INSERT OR IGNORE INTO stats (key, value) VALUES ('total_bids', 0);
    INSERT OR IGNORE INTO stats (key, value) VALUES ('total_arbitrators', 0);

    -- Bids table (open job board)
    CREATE TABLE IF NOT EXISTS bids (
      id INTEGER PRIMARY KEY,
      job_id INTEGER NOT NULL,
      agent TEXT NOT NULL,
      amount INTEGER DEFAULT 0,
      timeline INTEGER DEFAULT 0,
      proposal TEXT,
      created_at INTEGER,
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_bids_job ON bids(job_id);
    CREATE INDEX IF NOT EXISTS idx_bids_agent ON bids(agent);
    CREATE INDEX IF NOT EXISTS idx_feedback_agent ON feedback(agent);
    CREATE INDEX IF NOT EXISTS idx_feedback_reviewer ON feedback(reviewer);
    CREATE INDEX IF NOT EXISTS idx_validations_agent ON validations(agent);
    CREATE INDEX IF NOT EXISTS idx_validations_validator ON validations(validator);
    CREATE INDEX IF NOT EXISTS idx_events_contract ON events(contract);
    CREATE INDEX IF NOT EXISTS idx_events_action ON events(action_name);
    CREATE INDEX IF NOT EXISTS idx_jobs_client ON jobs(client);
    CREATE INDEX IF NOT EXISTS idx_jobs_agent ON jobs(agent);
    CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state);
    CREATE INDEX IF NOT EXISTS idx_milestones_job ON milestones(job_id);
    CREATE INDEX IF NOT EXISTS idx_escrow_disputes_job ON escrow_disputes(job_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_disputes_feedback ON feedback_disputes(feedback_id);
    CREATE INDEX IF NOT EXISTS idx_validation_challenges_validation ON validation_challenges(validation_id);

    -- Agent Plugins table (agent-to-plugin assignments)
    CREATE TABLE IF NOT EXISTS agent_plugins (
      id INTEGER PRIMARY KEY,
      agent TEXT NOT NULL,
      plugin_id INTEGER NOT NULL,
      config TEXT,
      enabled INTEGER DEFAULT 1,
      FOREIGN KEY (agent) REFERENCES agents(account),
      FOREIGN KEY (plugin_id) REFERENCES plugins(id)
    );

    CREATE INDEX IF NOT EXISTS idx_agent_plugins_agent ON agent_plugins(agent);
    CREATE INDEX IF NOT EXISTS idx_agent_plugins_plugin ON agent_plugins(plugin_id);

    -- Plugin Results table
    CREATE TABLE IF NOT EXISTS plugin_results (
      id INTEGER PRIMARY KEY,
      agent TEXT NOT NULL,
      plugin_id INTEGER NOT NULL,
      job_id INTEGER DEFAULT 0,
      status TEXT,
      result_data TEXT,
      timestamp INTEGER,
      FOREIGN KEY (agent) REFERENCES agents(account),
      FOREIGN KEY (plugin_id) REFERENCES plugins(id)
    );

    CREATE INDEX IF NOT EXISTS idx_plugin_results_agent ON plugin_results(agent);
    CREATE INDEX IF NOT EXISTS idx_plugin_results_plugin ON plugin_results(plugin_id);

    -- Stream cursor tracking for resume capability
    CREATE TABLE IF NOT EXISTS stream_cursor (
      id INTEGER PRIMARY KEY DEFAULT 1,
      last_block_num INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    INSERT OR IGNORE INTO stream_cursor (id, last_block_num) VALUES (1, 0);

    -- Per-contract cursor tracking for safe resume (avoids cross-contract block skips)
    CREATE TABLE IF NOT EXISTS contract_cursors (
      contract TEXT PRIMARY KEY,
      last_block_num INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    -- Action dedup: tracks processed actions by dedup key to prevent
    -- duplicate inserts on boundary-block replay after restart.
    -- Key is global_sequence (string) when available, or trx_id:action_ordinal composite.
    CREATE TABLE IF NOT EXISTS processed_actions (
      dedup_key TEXT PRIMARY KEY
    );

    -- Webhook subscriptions for push notifications
    CREATE TABLE IF NOT EXISTS webhook_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      token TEXT NOT NULL,
      event_filter TEXT NOT NULL,
      account_filter TEXT,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      failure_count INTEGER DEFAULT 0
    );

    -- Webhook delivery log
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status_code INTEGER,
      attempted_at INTEGER DEFAULT (strftime('%s','now'))
    );
  `);

  // Migrations: Add columns that may not exist in older databases.
  // ALTER TABLE ... ADD COLUMN is a no-op error if the column already exists,
  // so we catch and ignore each one individually.
  const migrations = [
    'ALTER TABLE arbitrators ADD COLUMN pending_unstake INTEGER DEFAULT 0',
    'ALTER TABLE agents ADD COLUMN owner TEXT',
    'ALTER TABLE agents ADD COLUMN pending_owner TEXT',
    'ALTER TABLE agents ADD COLUMN claim_deposit INTEGER DEFAULT 0',
    'ALTER TABLE agents ADD COLUMN deposit_payer TEXT',
    // Phase 2 audit fixes: add missing columns from contract tables
    'ALTER TABLE validators ADD COLUMN pending_challenges INTEGER DEFAULT 0',
    'ALTER TABLE arbitrators ADD COLUMN active_disputes INTEGER DEFAULT 0',
    'ALTER TABLE validation_challenges ADD COLUMN funded_at INTEGER DEFAULT 0',
    // Archived flag: rows cleaned from chain but preserved in DB for history
    'ALTER TABLE jobs ADD COLUMN archived INTEGER DEFAULT 0',
    'ALTER TABLE milestones ADD COLUMN archived INTEGER DEFAULT 0',
    'ALTER TABLE feedback ADD COLUMN archived INTEGER DEFAULT 0',
    'ALTER TABLE feedback_disputes ADD COLUMN archived INTEGER DEFAULT 0',
    'ALTER TABLE validations ADD COLUMN archived INTEGER DEFAULT 0',
    'ALTER TABLE validation_challenges ADD COLUMN archived INTEGER DEFAULT 0',
    'ALTER TABLE escrow_disputes ADD COLUMN archived INTEGER DEFAULT 0',
    'ALTER TABLE plugin_results ADD COLUMN archived INTEGER DEFAULT 0',
  ];

  // Migrate processed_actions from INTEGER to TEXT key if needed.
  // This is ephemeral cache data (max 10k entries), safe to recreate.
  try {
    db.prepare('SELECT dedup_key FROM processed_actions LIMIT 0').raw().get();
  } catch {
    db.exec('DROP TABLE IF EXISTS processed_actions');
    db.exec('CREATE TABLE processed_actions (dedup_key TEXT PRIMARY KEY)');
  }

  for (const migration of migrations) {
    try {
      db.exec(migration);
    } catch (_e) {
      // Column already exists - ignore
    }
  }

  return db;
}

export function updateStats(db: Database.Database): void {
  db.exec(`
    UPDATE stats SET value = (SELECT COUNT(*) FROM agents), updated_at = strftime('%s', 'now') WHERE key = 'total_agents';
    UPDATE stats SET value = (SELECT COUNT(*) FROM agents WHERE active = 1), updated_at = strftime('%s', 'now') WHERE key = 'active_agents';
    UPDATE stats SET value = (SELECT COUNT(*) FROM validators), updated_at = strftime('%s', 'now') WHERE key = 'total_validators';
    UPDATE stats SET value = (SELECT COUNT(*) FROM feedback), updated_at = strftime('%s', 'now') WHERE key = 'total_feedback';
    UPDATE stats SET value = (SELECT COUNT(*) FROM validations), updated_at = strftime('%s', 'now') WHERE key = 'total_validations';
    UPDATE stats SET value = (SELECT COALESCE(SUM(total_jobs), 0) FROM agents), updated_at = strftime('%s', 'now') WHERE key = 'total_jobs';
    UPDATE stats SET value = (SELECT COUNT(*) FROM jobs), updated_at = strftime('%s', 'now') WHERE key = 'total_jobs_escrow';
    UPDATE stats SET value = (SELECT COUNT(*) FROM jobs WHERE agent = '' OR agent IS NULL), updated_at = strftime('%s', 'now') WHERE key = 'total_open_jobs';
    UPDATE stats SET value = (SELECT COUNT(*) FROM bids), updated_at = strftime('%s', 'now') WHERE key = 'total_bids';
    UPDATE stats SET value = (SELECT COUNT(*) FROM arbitrators), updated_at = strftime('%s', 'now') WHERE key = 'total_arbitrators';
  `);
}

export function getLastCursor(db: Database.Database): number {
  const row = db.prepare('SELECT last_block_num FROM stream_cursor WHERE id = 1').get() as { last_block_num: number } | undefined;
  return row?.last_block_num || 0;
}

export function updateCursor(db: Database.Database, blockNum: number): void {
  db.prepare("UPDATE stream_cursor SET last_block_num = ?, updated_at = strftime('%s', 'now') WHERE id = 1").run(blockNum);
}

/**
 * Ensure all configured contracts have cursor rows.
 * Missing contracts are seeded from the global stream_cursor (not 0)
 * so that upgraded nodes don't replay from genesis.
 */
export function ensureContractCursors(db: Database.Database, contracts: string[]): void {
  const globalBlock = getLastCursor(db);
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO contract_cursors (contract, last_block_num) VALUES (?, ?)'
  );
  for (const contract of contracts) {
    stmt.run(contract, globalBlock);
  }
}

export function getContractCursors(db: Database.Database): Map<string, number> {
  const rows = db.prepare('SELECT contract, last_block_num FROM contract_cursors').all() as Array<{ contract: string; last_block_num: number }>;
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.contract, row.last_block_num);
  }
  return map;
}

export function updateContractCursor(db: Database.Database, contract: string, blockNum: number): void {
  db.prepare(`
    INSERT INTO contract_cursors (contract, last_block_num, updated_at)
    VALUES (?, ?, strftime('%s', 'now'))
    ON CONFLICT(contract) DO UPDATE SET last_block_num = excluded.last_block_num, updated_at = excluded.updated_at
  `).run(contract, blockNum);
}

/** Check-only: returns true if this action was already processed. */
export function hasBeenProcessed(db: Database.Database, dedupeKey: string): boolean {
  if (!dedupeKey) return false;
  return !!db.prepare('SELECT 1 FROM processed_actions WHERE dedup_key = ?').get(dedupeKey);
}

/** Insert-only: mark an action as processed. Call after handler success. */
export function markActionProcessed(db: Database.Database, dedupeKey: string): void {
  if (!dedupeKey) return;
  db.prepare('INSERT OR IGNORE INTO processed_actions (dedup_key) VALUES (?)').run(dedupeKey);
}

/**
 * Prune events older than maxAgeSec seconds.
 * Returns the number of deleted rows.
 */
export function pruneEvents(db: Database.Database, maxAgeSec: number): number {
  const cutoff = Math.floor(Date.now() / 1000) - maxAgeSec;
  const result = db.prepare('DELETE FROM events WHERE timestamp < ?').run(cutoff);
  return result.changes;
}

/**
 * Prune webhook deliveries older than maxAgeSec seconds.
 * Returns the number of deleted rows.
 */
export function pruneWebhookDeliveries(db: Database.Database, maxAgeSec: number): number {
  const cutoff = Math.floor(Date.now() / 1000) - maxAgeSec;
  const result = db.prepare('DELETE FROM webhook_deliveries WHERE attempted_at < ?').run(cutoff);
  return result.changes;
}

/**
 * Prune oldest processed_actions entries to bound table size.
 * Uses ROWID ordering (insertion order) for deletion priority.
 */
export function pruneProcessedActions(db: Database.Database, _belowBlock: number): void {
  const MAX_DEDUP_ENTRIES = 10000;
  const count = (db.prepare('SELECT COUNT(*) as cnt FROM processed_actions').get() as { cnt: number }).cnt;
  if (count > MAX_DEDUP_ENTRIES) {
    const toDelete = count - MAX_DEDUP_ENTRIES;
    db.prepare('DELETE FROM processed_actions WHERE rowid IN (SELECT rowid FROM processed_actions ORDER BY rowid ASC LIMIT ?)').run(toDelete);
  }
}
