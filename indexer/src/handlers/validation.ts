import Database from 'better-sqlite3';
import { StreamAction } from '../stream';
import { updateStats } from '../db/schema';

export function handleValidationAction(db: Database.Database, action: StreamAction): void {
  const { name, data } = action.act;

  switch (name) {
    case 'regval':
      handleRegVal(db, data, action.timestamp);
      break;
    case 'updateval':
      handleUpdateVal(db, data);
      break;
    case 'setvalstat':
      handleSetValStatus(db, data);
      break;
    case 'validate':
      handleValidate(db, data, action.timestamp);
      break;
    case 'challenge':
      handleChallenge(db, data, action.timestamp);
      break;
    case 'resolve':
      handleResolve(db, data);
      break;
    case 'slash':
      handleSlash(db, data);
      break;
    default:
      console.log(`Unknown agentvalid action: ${name}`);
  }

  // Log event
  logEvent(db, action);

  // Update stats
  updateStats(db);
}

function handleRegVal(db: Database.Database, data: any, timestamp: string): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO validators (account, stake, method, specializations, total_validations, correct_validations, accuracy_score, registered_at, active)
    VALUES (?, 0, ?, ?, 0, 0, 10000, ?, 1)
  `);

  const registeredAt = Math.floor(new Date(timestamp).getTime() / 1000);

  stmt.run(
    data.account,
    data.method || '',
    data.specializations || '[]',
    registeredAt
  );

  console.log(`Validator registered: ${data.account}`);
}

function handleUpdateVal(db: Database.Database, data: any): void {
  const stmt = db.prepare(`
    UPDATE validators
    SET method = ?, specializations = ?
    WHERE account = ?
  `);

  stmt.run(data.method || '', data.specializations || '[]', data.account);

  console.log(`Validator updated: ${data.account}`);
}

function handleSetValStatus(db: Database.Database, data: any): void {
  const stmt = db.prepare(`
    UPDATE validators
    SET active = ?
    WHERE account = ?
  `);

  stmt.run(data.active ? 1 : 0, data.account);

  console.log(`Validator status changed: ${data.account} -> ${data.active ? 'active' : 'inactive'}`);
}

function handleValidate(db: Database.Database, data: any, timestamp: string): void {
  const stmt = db.prepare(`
    INSERT INTO validations (id, validator, agent, job_hash, result, confidence, evidence_uri, challenged, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  `);

  // Generate ID
  const countStmt = db.prepare('SELECT MAX(id) as max_id FROM validations');
  const result = countStmt.get() as { max_id: number | null };
  const id = (result.max_id || 0) + 1;

  const ts = Math.floor(new Date(timestamp).getTime() / 1000);

  stmt.run(
    id,
    data.validator,
    data.agent,
    data.job_hash || '',
    data.result,
    data.confidence,
    data.evidence_uri || '',
    ts
  );

  // Update validator stats
  const updateStmt = db.prepare(`
    UPDATE validators
    SET total_validations = total_validations + 1
    WHERE account = ?
  `);
  updateStmt.run(data.validator);

  console.log(`Validation submitted: ${data.validator} -> ${data.agent} (result: ${data.result})`);
}

function handleChallenge(db: Database.Database, data: any, timestamp: string): void {
  // Update validation challenged flag
  const stmt = db.prepare(`
    UPDATE validations
    SET challenged = 1
    WHERE id = ?
  `);
  stmt.run(data.validation_id);

  // Create challenge record for mapping
  const createdAt = Math.floor(new Date(timestamp).getTime() / 1000);
  const countStmt = db.prepare('SELECT MAX(id) as max_id FROM validation_challenges');
  const result = countStmt.get() as { max_id: number | null };
  const id = (result.max_id || 0) + 1;

  const challengeStmt = db.prepare(`
    INSERT INTO validation_challenges (id, validation_id, challenger, reason, evidence_uri, stake, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `);
  challengeStmt.run(
    id,
    data.validation_id,
    data.challenger || '',
    data.reason || '',
    data.evidence_uri || '',
    data.stake || 0,
    createdAt
  );

  console.log(`Validation ${data.validation_id} challenged (challenge ${id})`);
}

function handleResolve(db: Database.Database, data: any): void {
  // Look up challenge to get validation_id
  const challenge = db.prepare('SELECT validation_id FROM validation_challenges WHERE id = ?').get(data.challenge_id) as { validation_id: number } | undefined;

  if (!challenge) {
    console.log(`Challenge ${data.challenge_id} not found in index`);
    return;
  }

  // Update challenge status
  const challengeStmt = db.prepare(`
    UPDATE validation_challenges
    SET status = ?, resolver = ?, resolution_notes = ?, resolved_at = strftime('%s', 'now')
    WHERE id = ?
  `);
  challengeStmt.run(
    data.upheld ? 1 : 2,
    data.resolver || '',
    data.notes || '',
    data.challenge_id
  );

  // If challenge was rejected, validator was correct - update accuracy
  if (!data.upheld) {
    const validation = db.prepare('SELECT validator FROM validations WHERE id = ?').get(challenge.validation_id) as { validator: string } | undefined;
    if (validation) {
      const updateStmt = db.prepare(`
        UPDATE validators
        SET correct_validations = correct_validations + 1,
            accuracy_score = CASE
              WHEN total_validations > 0 THEN (correct_validations + 1) * 10000 / total_validations
              ELSE 10000
            END
        WHERE account = ?
      `);
      updateStmt.run(validation.validator);
    }
  }

  console.log(`Challenge ${data.challenge_id} resolved (validation ${challenge.validation_id}, upheld: ${data.upheld})`);
}

function handleSlash(db: Database.Database, data: any): void {
  const stmt = db.prepare(`
    UPDATE validators
    SET stake = MAX(0, stake - ?)
    WHERE account = ?
  `);

  stmt.run(data.amount, data.validator);

  console.log(`Validator slashed: ${data.validator} (amount: ${data.amount})`);
}

function logEvent(db: Database.Database, action: StreamAction): void {
  const stmt = db.prepare(`
    INSERT INTO events (block_num, transaction_id, action_name, contract, data, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const timestamp = Math.floor(new Date(action.timestamp).getTime() / 1000);

  stmt.run(
    action.block_num,
    action.trx_id,
    action.act.name,
    action.act.account,
    JSON.stringify(action.act.data),
    timestamp
  );
}
