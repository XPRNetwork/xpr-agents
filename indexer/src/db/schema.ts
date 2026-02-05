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

    -- Validation Challenges table (maps challenge_id -> validation_id)
    CREATE TABLE IF NOT EXISTS validation_challenges (
      id INTEGER PRIMARY KEY,
      validation_id INTEGER NOT NULL,
      challenger TEXT NOT NULL,
      reason TEXT,
      evidence_uri TEXT,
      stake INTEGER DEFAULT 0,
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
      fee_percent INTEGER DEFAULT 0,
      total_cases INTEGER DEFAULT 0,
      successful_cases INTEGER DEFAULT 0,
      active INTEGER DEFAULT 0
    );

    -- Initialize additional stats
    INSERT OR IGNORE INTO stats (key, value) VALUES ('total_jobs_escrow', 0);
    INSERT OR IGNORE INTO stats (key, value) VALUES ('total_arbitrators', 0);

    -- Indexes
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
    UPDATE stats SET value = (SELECT COUNT(*) FROM jobs), updated_at = strftime('%s', 'now') WHERE key = 'total_jobs_escrow';
    UPDATE stats SET value = (SELECT COUNT(*) FROM arbitrators), updated_at = strftime('%s', 'now') WHERE key = 'total_arbitrators';
  `);
}
