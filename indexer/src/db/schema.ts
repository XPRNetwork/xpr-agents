import Database from 'better-sqlite3';

export function initDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
    -- Agents table
    CREATE TABLE IF NOT EXISTS agents (
      account TEXT PRIMARY KEY,
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
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

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

    -- Validators table
    CREATE TABLE IF NOT EXISTS validators (
      account TEXT PRIMARY KEY,
      stake INTEGER DEFAULT 0,
      method TEXT,
      specializations TEXT,
      total_validations INTEGER DEFAULT 0,
      correct_validations INTEGER DEFAULT 0,
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

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_feedback_agent ON feedback(agent);
    CREATE INDEX IF NOT EXISTS idx_feedback_reviewer ON feedback(reviewer);
    CREATE INDEX IF NOT EXISTS idx_validations_agent ON validations(agent);
    CREATE INDEX IF NOT EXISTS idx_validations_validator ON validations(validator);
    CREATE INDEX IF NOT EXISTS idx_events_contract ON events(contract);
    CREATE INDEX IF NOT EXISTS idx_events_action ON events(action_name);
  `);

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
  `);
}
