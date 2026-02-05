import Database from 'better-sqlite3';
import { StreamAction } from '../stream';
import { updateStats } from '../db/schema';

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
  const stmt = db.prepare(`
    UPDATE jobs SET state = 6, updated_at = strftime('%s', 'now') WHERE id = ?
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
  // Update job state
  const jobStmt = db.prepare(`
    UPDATE jobs SET state = 8, updated_at = strftime('%s', 'now') WHERE id = ?
  `);
  jobStmt.run(data.dispute_id);

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

  console.log(`Dispute ${data.dispute_id} arbitrated`);
}

function handleCancel(db: Database.Database, data: any): void {
  const stmt = db.prepare(`
    UPDATE jobs SET state = 7, updated_at = strftime('%s', 'now') WHERE id = ?
  `);
  stmt.run(data.job_id);
  console.log(`Job ${data.job_id} cancelled`);
}

function handleTimeout(db: Database.Database, data: any): void {
  // The actual state depends on whether it was delivered or not
  // We'll set to 7 (REFUNDED) by default; the contract handles the nuance
  const stmt = db.prepare(`
    UPDATE jobs SET updated_at = strftime('%s', 'now') WHERE id = ?
  `);
  stmt.run(data.job_id);
  console.log(`Job ${data.job_id} timeout claimed`);
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
  const stmt = db.prepare(`
    UPDATE milestones
    SET state = 2, approved_at = strftime('%s', 'now')
    WHERE id = ?
  `);
  stmt.run(data.milestone_id);
  console.log(`Milestone ${data.milestone_id} approved`);
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
