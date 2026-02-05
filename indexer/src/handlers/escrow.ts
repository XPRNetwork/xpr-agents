import Database from 'better-sqlite3';
import { StreamAction } from '../stream';
import { updateStats } from '../db/schema';

/**
 * Handle escrow contract actions
 */
export function handleEscrowAction(db: Database.Database, action: StreamAction): void {
  const { name, data } = action.act;

  switch (name) {
    case 'createjob':
      handleCreateJob(db, data, action.timestamp);
      break;
    case 'acceptjob':
      handleAcceptJob(db, data);
      break;
    case 'startjob':
      handleStartJob(db, data);
      break;
    case 'deliver':
      handleDeliver(db, data);
      break;
    case 'approve':
      handleApprove(db, data);
      break;
    case 'dispute':
      handleDispute(db, data, action.timestamp);
      break;
    case 'arbitrate':
      handleArbitrate(db, data);
      break;
    case 'cancel':
      handleCancel(db, data);
      break;
    case 'timeout':
    case 'accpttimeout':
      handleTimeout(db, data);
      break;
    case 'regarb':
      handleRegisterArbitrator(db, data);
      break;
    case 'activatearb':
      handleActivateArbitrator(db, data, true);
      break;
    case 'deactarb':
      handleActivateArbitrator(db, data, false);
      break;
    case 'addmilestone':
      handleAddMilestone(db, data);
      break;
    case 'submitmile':
      handleSubmitMilestone(db, data);
      break;
    case 'approvemile':
      handleApproveMilestone(db, data);
      break;
    default:
      console.log(`Unknown agentescrow action: ${name}`);
  }

  // Log event
  logEvent(db, action);

  // Update stats
  updateStats(db);
}

function handleCreateJob(db: Database.Database, data: any, timestamp: string): void {
  const stmt = db.prepare(`
    INSERT INTO jobs (id, client, agent, title, description, deliverables, amount, symbol, funded_amount, released_amount, state, deadline, arbitrator, job_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?)
  `);

  const createdAt = Math.floor(new Date(timestamp).getTime() / 1000);

  // Generate job ID based on existing count
  const countStmt = db.prepare('SELECT MAX(id) as max_id FROM jobs');
  const result = countStmt.get() as { max_id: number | null };
  const id = (result.max_id || 0) + 1;

  stmt.run(
    id,
    data.client,
    data.agent,
    data.title || '',
    data.description || '',
    data.deliverables || '[]',
    data.amount || 0,
    data.symbol || 'XPR',
    data.deadline || 0,
    data.arbitrator || '',
    data.job_hash || '',
    createdAt,
    createdAt
  );

  console.log(`Job created: ${id} - ${data.title}`);
}

function handleAcceptJob(db: Database.Database, data: any): void {
  const stmt = db.prepare(`
    UPDATE jobs SET state = 2, updated_at = strftime('%s', 'now') WHERE id = ?
  `);
  stmt.run(data.job_id);
  console.log(`Job ${data.job_id} accepted`);
}

function handleStartJob(db: Database.Database, data: any): void {
  const stmt = db.prepare(`
    UPDATE jobs SET state = 3, updated_at = strftime('%s', 'now') WHERE id = ?
  `);
  stmt.run(data.job_id);
  console.log(`Job ${data.job_id} started`);
}

function handleDeliver(db: Database.Database, data: any): void {
  const stmt = db.prepare(`
    UPDATE jobs SET state = 4, updated_at = strftime('%s', 'now') WHERE id = ?
  `);
  stmt.run(data.job_id);
  console.log(`Job ${data.job_id} delivered`);
}

function handleApprove(db: Database.Database, data: any): void {
  // COMPLETED: Agent receives full payment, so released_amount = funded_amount
  const stmt = db.prepare(`
    UPDATE jobs
    SET state = 6, released_amount = funded_amount, updated_at = strftime('%s', 'now')
    WHERE id = ?
  `);
  stmt.run(data.job_id);
  console.log(`Job ${data.job_id} approved`);
}

function handleDispute(db: Database.Database, data: any, timestamp: string): void {
  // Update job state
  const jobStmt = db.prepare(`
    UPDATE jobs SET state = 5, updated_at = strftime('%s', 'now') WHERE id = ?
  `);
  jobStmt.run(data.job_id);

  // Create dispute record
  const createdAt = Math.floor(new Date(timestamp).getTime() / 1000);
  const countStmt = db.prepare('SELECT MAX(id) as max_id FROM escrow_disputes');
  const result = countStmt.get() as { max_id: number | null };
  const id = (result.max_id || 0) + 1;

  const disputeStmt = db.prepare(`
    INSERT INTO escrow_disputes (id, job_id, raised_by, reason, evidence_uri, resolution, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `);
  disputeStmt.run(
    id,
    data.job_id,
    data.raised_by,
    data.reason || '',
    data.evidence_uri || '',
    createdAt
  );

  console.log(`Dispute raised for job ${data.job_id}`);
}

function handleArbitrate(db: Database.Database, data: any): void {
  // Look up dispute to get job_id
  const dispute = db.prepare('SELECT job_id FROM escrow_disputes WHERE id = ?').get(data.dispute_id) as { job_id: number } | undefined;

  if (dispute) {
    // ARBITRATED: All funds leave escrow (to arbitrator + client + agent)
    // Contract sets released_amount = funded_amount
    const jobStmt = db.prepare(`
      UPDATE jobs
      SET state = 8,
          released_amount = funded_amount,
          updated_at = strftime('%s', 'now')
      WHERE id = ?
    `);
    jobStmt.run(dispute.job_id);
  }

  // Update dispute resolution
  const disputeStmt = db.prepare(`
    UPDATE escrow_disputes
    SET resolution = ?, resolver = ?, resolution_notes = ?, resolved_at = strftime('%s', 'now')
    WHERE id = ?
  `);

  const resolution = data.client_percent === 100 ? 1 : (data.client_percent === 0 ? 2 : 3);
  disputeStmt.run(
    resolution,
    data.arbitrator,
    data.resolution_notes || '',
    data.dispute_id
  );

  console.log(`Dispute ${data.dispute_id} arbitrated${dispute ? ` (job ${dispute.job_id})` : ''}`);
}

function handleCancel(db: Database.Database, data: any): void {
  // REFUNDED: All funds leave escrow (back to client)
  // Contract sets released_amount = funded_amount
  const stmt = db.prepare(`
    UPDATE jobs
    SET state = 7, released_amount = funded_amount, updated_at = strftime('%s', 'now')
    WHERE id = ?
  `);
  stmt.run(data.job_id);
  console.log(`Job ${data.job_id} cancelled`);
}

function handleTimeout(db: Database.Database, data: any): void {
  // Look up current job state to determine outcome
  const job = db.prepare('SELECT state FROM jobs WHERE id = ?').get(data.job_id) as { state: number } | undefined;

  // State 4 = DELIVERED -> becomes 6 (COMPLETED, agent gets paid)
  // Other states -> becomes 7 (REFUNDED, client gets refund)
  const newState = job && job.state === 4 ? 6 : 7;

  // All terminal states: all funds leave escrow -> released_amount = funded_amount
  const stmt = db.prepare(`
    UPDATE jobs
    SET state = ?,
        released_amount = funded_amount,
        updated_at = strftime('%s', 'now')
    WHERE id = ?
  `);
  stmt.run(newState, data.job_id);
  console.log(`Job ${data.job_id} timeout claimed -> state ${newState === 6 ? 'COMPLETED' : 'REFUNDED'}`);
}

function handleRegisterArbitrator(db: Database.Database, data: any): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO arbitrators (account, stake, fee_percent, total_cases, successful_cases, active)
    VALUES (?, 0, ?, 0, 0, 0)
  `);
  stmt.run(data.account, data.fee_percent || 0);
  console.log(`Arbitrator registered: ${data.account}`);
}

function handleActivateArbitrator(db: Database.Database, data: any, active: boolean): void {
  const stmt = db.prepare(`
    UPDATE arbitrators SET active = ? WHERE account = ?
  `);
  stmt.run(active ? 1 : 0, data.account);
  console.log(`Arbitrator ${data.account} ${active ? 'activated' : 'deactivated'}`);
}

function handleAddMilestone(db: Database.Database, data: any): void {
  const countStmt = db.prepare('SELECT MAX(id) as max_id FROM milestones');
  const result = countStmt.get() as { max_id: number | null };
  const id = (result.max_id || 0) + 1;

  const stmt = db.prepare(`
    INSERT INTO milestones (id, job_id, title, description, amount, milestone_order, state, evidence_uri)
    VALUES (?, ?, ?, ?, ?, ?, 0, '')
  `);
  stmt.run(
    id,
    data.job_id,
    data.title || '',
    data.description || '',
    data.amount || 0,
    data.order || 0
  );
  console.log(`Milestone added to job ${data.job_id}: ${data.title}`);
}

function handleSubmitMilestone(db: Database.Database, data: any): void {
  const stmt = db.prepare(`
    UPDATE milestones
    SET state = 1, evidence_uri = ?, submitted_at = strftime('%s', 'now')
    WHERE id = ?
  `);
  stmt.run(data.evidence_uri || '', data.milestone_id);
  console.log(`Milestone ${data.milestone_id} submitted`);
}

function handleApproveMilestone(db: Database.Database, data: any): void {
  // Look up milestone to get job_id and amount
  const milestone = db.prepare('SELECT job_id, amount FROM milestones WHERE id = ?').get(data.milestone_id) as { job_id: number; amount: number } | undefined;

  // Update milestone state
  const stmt = db.prepare(`
    UPDATE milestones
    SET state = 2, approved_at = strftime('%s', 'now')
    WHERE id = ?
  `);
  stmt.run(data.milestone_id);

  // Update job's released_amount with this milestone's payment
  if (milestone) {
    const jobStmt = db.prepare(`
      UPDATE jobs
      SET released_amount = released_amount + ?, updated_at = strftime('%s', 'now')
      WHERE id = ?
    `);
    jobStmt.run(milestone.amount, milestone.job_id);
    console.log(`Milestone ${data.milestone_id} approved (job ${milestone.job_id} released +${milestone.amount})`);
  } else {
    console.log(`Milestone ${data.milestone_id} approved`);
  }
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
 * Handle eosio.token::transfer notifications to/from agentescrow
 *
 * Funding tracking:
 * - Incoming transfers with memo "fund:JOB_ID" increment funded_amount
 * - Overfunding refunds (outgoing with "refund" + job ID) decrement funded_amount
 *
 * Release tracking:
 * - released_amount is set by terminal state actions (approve, arbitrate, cancel, timeout)
 * - NOT tracked via transfers to avoid double-counting with action handlers
 */
export function handleEscrowTransfer(db: Database.Database, action: StreamAction, escrowContract: string): void {
  const { from, to, quantity, memo } = action.act.data;

  // Parse quantity (e.g., "100.0000 XPR")
  const [amountStr] = quantity.split(' ');
  const amount = Math.floor(parseFloat(amountStr) * 10000);

  if (to === escrowContract) {
    // Incoming transfer to escrow
    if (memo.startsWith('fund:')) {
      // Job funding: memo = "fund:JOB_ID"
      const jobIdStr = memo.substring(5);
      const jobId = parseInt(jobIdStr);

      if (!isNaN(jobId)) {
        const stmt = db.prepare(`
          UPDATE jobs
          SET funded_amount = funded_amount + ?, state = CASE WHEN state = 0 THEN 1 ELSE state END, updated_at = strftime('%s', 'now')
          WHERE id = ?
        `);
        stmt.run(amount, jobId);
        console.log(`Job ${jobId} funded with ${amountStr}`);
      }
    } else if (memo === 'arbstake' || memo.startsWith('arbstake:')) {
      // Arbitrator staking
      const stmt = db.prepare(`
        UPDATE arbitrators
        SET stake = stake + ?
        WHERE account = ?
      `);
      stmt.run(amount, from);
      console.log(`Arbitrator ${from} staked ${amountStr}`);
    }
  } else if (from === escrowContract) {
    // Outgoing transfer from escrow
    // Only handle overfunding refunds - subtract from funded_amount
    // Terminal payments are tracked via action handlers (approve, arbitrate, etc.)
    const isOverfundingRefund = /overfund.*refund/i.test(memo);
    if (isOverfundingRefund) {
      const jobMatch = memo.match(/job\s*(\d+)/i);
      if (jobMatch) {
        const jobId = parseInt(jobMatch[1]);
        if (!isNaN(jobId)) {
          const stmt = db.prepare(`
            UPDATE jobs
            SET funded_amount = funded_amount - ?, updated_at = strftime('%s', 'now')
            WHERE id = ?
          `);
          stmt.run(amount, jobId);
          console.log(`Job ${jobId} overfunding refund: ${amountStr}`);
        }
      }
    }
    // Note: Other outgoing transfers (payments, refunds on terminal states)
    // are handled by action handlers which set released_amount = funded_amount
  }

  // Log the transfer event
  logEvent(db, action);
}
