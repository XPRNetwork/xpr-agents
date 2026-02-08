import Database from 'better-sqlite3';
import { StreamAction } from '../stream';
import { updateStats } from '../db/schema';
import { WebhookDispatcher } from '../webhooks/dispatcher';

export function handleValidationAction(db: Database.Database, action: StreamAction, dispatcher?: WebhookDispatcher): void {
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
      dispatcher?.dispatch(
        'validation.submitted',
        [data.agent, data.validator],
        data,
        `Validation for agent ${data.agent} by ${data.validator}: ${data.result === 1 ? 'pass' : data.result === 2 ? 'partial' : 'fail'} (${data.confidence}% confidence)`,
        action.block_num
      );
      break;
    case 'challenge':
      handleChallenge(db, data, action.timestamp);
      break;
    case 'resolve':
      handleResolve(db, data);
      dispatcher?.dispatch(
        'validation.challenge_resolved',
        [data.resolver],
        data,
        `Challenge #${data.challenge_id} resolved (${data.upheld ? 'upheld' : 'rejected'})`,
        action.block_num
      );
      break;
    case 'slash':
      handleSlash(db, data);
      break;
    case 'cancelchal':
      handleCancelChallenge(db, data);
      break;
    case 'expireunfund':
      handleExpireUnfunded(db, data);
      break;
    case 'expirefunded':
      handleExpireFunded(db, data);
      break;
    case 'unstake':
      handleUnstake(db, data);
      break;
    case 'withdraw':
      handleWithdraw(db, data);
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
  // Use ON CONFLICT to preserve existing stats on re-registration.
  // INSERT OR REPLACE would reset stake, total_validations, accuracy_score to 0.
  const registeredAt = Math.floor(new Date(timestamp).getTime() / 1000);

  const stmt = db.prepare(`
    INSERT INTO validators (account, stake, method, specializations, total_validations, incorrect_validations, accuracy_score, registered_at, active)
    VALUES (?, 0, ?, ?, 0, 0, 10000, ?, 1)
    ON CONFLICT(account) DO UPDATE SET
      method = excluded.method,
      specializations = excluded.specializations,
      active = 1
  `);

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
  // NOTE: Do NOT set challenged = 1 here. The on-chain contract only marks
  // validation.challenged = true after the challenge is FUNDED (via token transfer).
  // This prevents unfunded challenges from showing as "challenged" in the index.

  // Create challenge record for mapping
  const createdAt = Math.floor(new Date(timestamp).getTime() / 1000);
  // Contract uses CHALLENGE_FUNDING_PERIOD = 24 hours (86400 seconds)
  const fundingDeadline = createdAt + 86400;
  const countStmt = db.prepare('SELECT MAX(id) as max_id FROM validation_challenges');
  const result = countStmt.get() as { max_id: number | null };
  const id = (result.max_id || 0) + 1;

  const challengeStmt = db.prepare(`
    INSERT INTO validation_challenges (id, validation_id, challenger, reason, evidence_uri, stake, funding_deadline, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  `);
  challengeStmt.run(
    id,
    data.validation_id,
    data.challenger || '',
    data.reason || '',
    data.evidence_uri || '',
    data.stake || 0,
    fundingDeadline,
    createdAt
  );

  console.log(`Validation ${data.validation_id} challenged (challenge ${id})`);
}

function handleResolve(db: Database.Database, data: any): void {
  // Look up challenge to get validation_id and stake
  const challenge = db.prepare('SELECT validation_id, stake FROM validation_challenges WHERE id = ?').get(data.challenge_id) as { validation_id: number; stake: number } | undefined;

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
    data.resolution_notes || '',
    data.challenge_id
  );

  // AUDIT FIX: Reset validation.challenged flag after resolution
  const resetChallengedStmt = db.prepare(`
    UPDATE validations SET challenged = 0 WHERE id = ?
  `);
  resetChallengedStmt.run(challenge.validation_id);

  const validation = db.prepare('SELECT validator FROM validations WHERE id = ?').get(challenge.validation_id) as { validator: string } | undefined;

  if (data.upheld) {
    // Challenge upheld - validator was wrong
    if (validation) {
      // AUDIT FIX: Also update validator stake to reflect slashing
      // Contract slashes slash_percent (10%) of validator stake and adds to challenger reward
      // We approximate: slash = floor(stake * 10 / 100) = floor(stake / 10)
      const updateStmt = db.prepare(`
        UPDATE validators
        SET incorrect_validations = incorrect_validations + 1,
            stake = MAX(0, stake - MAX(0, stake / 10)),
            accuracy_score = CASE
              WHEN total_validations < 5 THEN 10000
              WHEN incorrect_validations + 1 >= total_validations THEN 0
              WHEN total_validations > 0 THEN (total_validations - (incorrect_validations + 1)) * 10000 / total_validations
              ELSE 10000
            END
        WHERE account = ?
      `);
      updateStmt.run(validation.validator);
    }
  } else {
    // Challenge rejected - challenger stake forfeited to validator
    if (validation && challenge.stake > 0) {
      const addStakeStmt = db.prepare(`
        UPDATE validators SET stake = stake + ? WHERE account = ?
      `);
      addStakeStmt.run(challenge.stake, validation.validator);
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

function handleCancelChallenge(db: Database.Database, data: any): void {
  // Look up challenge to get validation_id
  const challenge = db.prepare('SELECT validation_id FROM validation_challenges WHERE id = ?').get(data.challenge_id) as { validation_id: number } | undefined;

  // Update challenge status to cancelled (3)
  const challengeStmt = db.prepare(`
    UPDATE validation_challenges
    SET status = 3, resolved_at = strftime('%s', 'now')
    WHERE id = ?
  `);
  challengeStmt.run(data.challenge_id);

  // Reset validation's challenged flag
  if (challenge) {
    const validationStmt = db.prepare(`
      UPDATE validations
      SET challenged = 0
      WHERE id = ?
    `);
    validationStmt.run(challenge.validation_id);
  }

  console.log(`Challenge ${data.challenge_id} cancelled${challenge ? ` (validation ${challenge.validation_id})` : ''}`);
}

function handleExpireUnfunded(db: Database.Database, data: any): void {
  // Look up challenge to get validation_id
  const challenge = db.prepare('SELECT validation_id FROM validation_challenges WHERE id = ?').get(data.challenge_id) as { validation_id: number } | undefined;

  // Update challenge status to cancelled (3) - same as cancel
  const challengeStmt = db.prepare(`
    UPDATE validation_challenges
    SET status = 3, resolved_at = strftime('%s', 'now')
    WHERE id = ?
  `);
  challengeStmt.run(data.challenge_id);

  // Reset validation's challenged flag
  if (challenge) {
    const validationStmt = db.prepare(`
      UPDATE validations
      SET challenged = 0
      WHERE id = ?
    `);
    validationStmt.run(challenge.validation_id);
  }

  console.log(`Challenge ${data.challenge_id} expired (unfunded)${challenge ? ` (validation ${challenge.validation_id})` : ''}`);
}

function handleExpireFunded(db: Database.Database, data: any): void {
  // Funded challenge expired without resolution - treated as cancelled
  const challenge = db.prepare('SELECT validation_id FROM validation_challenges WHERE id = ?').get(data.challenge_id) as { validation_id: number } | undefined;

  // Update challenge status to cancelled (3)
  const challengeStmt = db.prepare(`
    UPDATE validation_challenges
    SET status = 3, resolved_at = strftime('%s', 'now')
    WHERE id = ?
  `);
  challengeStmt.run(data.challenge_id);

  // Reset validation's challenged flag
  if (challenge) {
    const validationStmt = db.prepare(`
      UPDATE validations
      SET challenged = 0
      WHERE id = ?
    `);
    validationStmt.run(challenge.validation_id);
  }

  console.log(`Challenge ${data.challenge_id} expired (funded, not resolved)${challenge ? ` (validation ${challenge.validation_id})` : ''}`);
}

function handleUnstake(db: Database.Database, data: any): void {
  // Validator requested unstake - reduce active stake
  const stmt = db.prepare(`
    UPDATE validators
    SET stake = MAX(0, stake - ?)
    WHERE account = ?
  `);
  stmt.run(data.amount || 0, data.account);
  console.log(`Validator ${data.account} unstaking ${(data.amount || 0) / 10000} XPR`);
}

function handleWithdraw(db: Database.Database, data: any): void {
  // Withdrawal completed - stake was already reduced during unstake
  console.log(`Validator ${data.account} withdrew unstaked funds (unstake_id: ${data.unstake_id})`);
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

/**
 * Handle eosio.token::transfer notifications to/from agentvalid
 * Updates validator stake, challenge funding, and processes refunds
 */
export function handleValidationTransfer(db: Database.Database, action: StreamAction, validContract: string, dispatcher?: WebhookDispatcher): void {
  const { from, to, quantity, memo } = action.act.data;

  // Parse quantity (e.g., "100.0000 XPR")
  const [amountStr] = quantity.split(' ');
  const amount = Math.floor(parseFloat(amountStr) * 10000);

  // Determine if this is incoming or outgoing using the passed contract name
  const isOutgoing = from === validContract;

  if (isOutgoing) {
    // Handle outgoing transfers (refunds from agentvalid)
    if (memo.includes('excess refund')) {
      // Challenge stake excess refund - the contract caps stake to config.challenge_stake
      // and refunds any excess. Find the challenge by looking at recent funded challenges
      // for this recipient and reduce the overstated stake.
      // Since we added the full amount initially, subtract the refund
      const challenges = db.prepare(
        'SELECT id FROM validation_challenges WHERE challenger = ? AND stake > 0 ORDER BY id DESC LIMIT 1'
      ).get(to) as { id: number } | undefined;

      if (challenges) {
        const stmt = db.prepare(`
          UPDATE validation_challenges
          SET stake = MAX(0, stake - ?)
          WHERE id = ?
        `);
        stmt.run(amount, challenges.id);
        console.log(`Challenge ${challenges.id} excess refund: ${amountStr} returned to ${to}`);
      }
    }
    // Other outgoing transfers (validator unstake withdrawals, slash refunds)
    // are handled by their respective action handlers
    logEvent(db, action);
    return;
  }

  // Incoming transfers to agentvalid
  if (memo === 'stake') {
    // Validator staking
    const stmt = db.prepare(`
      UPDATE validators
      SET stake = stake + ?
      WHERE account = ?
    `);
    stmt.run(amount, from);
    console.log(`Validator ${from} staked ${amountStr}`);
  } else if (memo.startsWith('challenge:')) {
    // Challenge funding: memo = "challenge:CHALLENGE_ID"
    const challengeIdStr = memo.substring(10);
    const challengeId = parseInt(challengeIdStr);

    if (!isNaN(challengeId)) {
      // Update challenge stake with full amount (excess will be refunded and subtracted above)
      const stmt = db.prepare(`
        UPDATE validation_challenges
        SET stake = stake + ?
        WHERE id = ?
      `);
      stmt.run(amount, challengeId);

      // Now mark the validation as challenged (matches on-chain griefing fix:
      // validation.challenged is only set when the challenge is funded)
      const challenge = db.prepare('SELECT validation_id FROM validation_challenges WHERE id = ?').get(challengeId) as { validation_id: number } | undefined;
      if (challenge) {
        const valStmt = db.prepare(`
          UPDATE validations
          SET challenged = 1
          WHERE id = ?
        `);
        valStmt.run(challenge.validation_id);
      }

      console.log(`Challenge ${challengeId} funded with ${amountStr}`);

      dispatcher?.dispatch(
        'validation.challenged',
        challenge ? [from] : [from],
        { challenge_id: challengeId, amount: amountStr, challenger: from },
        `Validation challenge #${challengeId} funded with ${amountStr}`,
        action.block_num
      );
    }
  }

  // Log the transfer event
  logEvent(db, action);
}
