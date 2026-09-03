import Database from 'better-sqlite3';
import { StreamAction } from '../stream';
import { updateStats } from '../db/schema';
import { WebhookDispatcher } from '../webhooks/dispatcher';
import {
  pendingCorrections,
  fetchOnChainId,
  getRpcEndpoint,
  safeCorrect,
  resolveDisplacedRow,
  JOBS_SPEC,
  BIDS_SPEC,
  SERVICES_SPEC,
  MILESTONES_SPEC,
  DISPUTES_SPEC,
  JOB_MESSAGES_SPEC,
} from './id-correction';

/**
 * Fetch the real on-chain job ID by looking up the jobs table for a matching record.
 */
async function fetchOnChainJobId(
  escrowContract: string,
  client: string,
  title: string,
  jobHash: string,
): Promise<number | null> {
  return fetchOnChainId(escrowContract, 'jobs', (row) =>
    row.client === client && row.title === title && (row.job_hash || '') === (jobHash || '')
  );
}

/**
 * Fetch the real on-chain service ID for a freshly listed service.
 *
 * `fetchOnChainId` scans the `services` table in reverse from the primary
 * index, so the newest rows come first — the agent's just-listed row is
 * among them. Matching on agent + title picks it out.
 */
async function fetchOnChainServiceId(
  escrowContract: string,
  agent: string,
  title: string,
): Promise<number | null> {
  return fetchOnChainId(escrowContract, 'services', (row) =>
    row.agent === agent && (row.title || '') === (title || '')
  );
}

/**
 * Handle escrow contract actions
 */
export function handleEscrowAction(db: Database.Database, action: StreamAction, dispatcher?: WebhookDispatcher): void {
  const { name, data } = action.act;

  switch (name) {
    case 'createjob':
      handleCreateJob(db, { ...data, _escrowContract: action.act.account }, action.timestamp);
      dispatcher?.dispatch(
        'job.created',
        [data.client, data.agent],
        data,
        `New job from ${data.client} for agent ${data.agent}: "${data.title}" (${(data.amount || 0) / 10000} XPR)`,
        action.block_num
      );
      break;
    case 'acceptjob':
      handleAcceptJob(db, data);
      if (dispatcher) {
        const acceptJob = db.prepare('SELECT client, agent FROM jobs WHERE id = ?').get(data.job_id) as { client: string; agent: string } | undefined;
        dispatcher.dispatch(
          'job.accepted',
          acceptJob ? [acceptJob.client, acceptJob.agent] : [],
          data,
          `Job #${data.job_id} accepted by ${acceptJob?.agent || 'agent'}`,
          action.block_num
        );
      }
      break;
    case 'startjob':
      handleStartJob(db, data);
      break;
    case 'deliver':
      handleDeliver(db, data);
      if (dispatcher) {
        const deliverJob = db.prepare('SELECT client, agent FROM jobs WHERE id = ?').get(data.job_id) as { client: string; agent: string } | undefined;
        dispatcher.dispatch(
          'job.delivered',
          deliverJob ? [deliverJob.client, deliverJob.agent] : [],
          data,
          `Job #${data.job_id} delivered`,
          action.block_num
        );
      }
      break;
    case 'revise':
      handleRevise(db, data);
      if (dispatcher) {
        const reviseJob = db.prepare('SELECT client, agent FROM jobs WHERE id = ?').get(data.job_id) as { client: string; agent: string } | undefined;
        dispatcher.dispatch(
          'job.revised',
          reviseJob ? [reviseJob.client, reviseJob.agent] : [],
          data,
          `Job #${data.job_id} sent back for revision`,
          action.block_num
        );
      }
      break;
    case 'approve':
      handleApprove(db, data);
      if (dispatcher) {
        const approveJob = db.prepare('SELECT client, agent FROM jobs WHERE id = ?').get(data.job_id) as { client: string; agent: string } | undefined;
        dispatcher.dispatch(
          'job.completed',
          approveJob ? [approveJob.client, approveJob.agent] : [],
          data,
          `Job #${data.job_id} approved and completed`,
          action.block_num
        );
      }
      break;
    case 'dispute':
      handleDispute(db, { ...data, _escrowContract: action.act.account }, action.timestamp);
      if (dispatcher) {
        const disputeJob = db.prepare('SELECT client, agent, arbitrator FROM jobs WHERE id = ?').get(data.job_id) as { client: string; agent: string; arbitrator: string } | undefined;
        const disputeAccounts = disputeJob ? [disputeJob.client, disputeJob.agent, disputeJob.arbitrator].filter(Boolean) : [data.raised_by];
        dispatcher.dispatch(
          'job.disputed',
          disputeAccounts,
          data,
          `Dispute raised on job #${data.job_id} by ${data.raised_by}`,
          action.block_num
        );
      }
      break;
    case 'arbitrate':
      handleArbitrate(db, data);
      if (dispatcher) {
        const arbDispute = db.prepare('SELECT job_id FROM escrow_disputes WHERE id = ?').get(data.dispute_id) as { job_id: number } | undefined;
        const arbJob = arbDispute ? db.prepare('SELECT client, agent FROM jobs WHERE id = ?').get(arbDispute.job_id) as { client: string; agent: string } | undefined : undefined;
        dispatcher.dispatch(
          'dispute.resolved',
          arbJob ? [arbJob.client, arbJob.agent, data.arbitrator] : [data.arbitrator],
          data,
          `Dispute #${data.dispute_id} arbitrated by ${data.arbitrator}`,
          action.block_num
        );
      }
      break;
    case 'resolvetmout':
      handleResolveTimeout(db, data, action.act.authorization?.[0]?.actor);
      if (dispatcher) {
        const tmoutDispute = db.prepare('SELECT job_id FROM escrow_disputes WHERE id = ?').get(data.dispute_id) as { job_id: number } | undefined;
        const tmoutJob = tmoutDispute ? db.prepare('SELECT client, agent FROM jobs WHERE id = ?').get(tmoutDispute.job_id) as { client: string; agent: string } | undefined : undefined;
        dispatcher.dispatch(
          'dispute.resolved',
          tmoutJob ? [tmoutJob.client, tmoutJob.agent] : [],
          data,
          `Dispute #${data.dispute_id} resolved by timeout (owner fallback)`,
          action.block_num
        );
      }
      break;
    case 'cancel':
      handleCancel(db, data);
      if (dispatcher) {
        const cancelJob = db.prepare('SELECT client, agent FROM jobs WHERE id = ?').get(data.job_id) as { client: string; agent: string } | undefined;
        dispatcher.dispatch(
          'job.cancelled',
          cancelJob ? [cancelJob.client, cancelJob.agent].filter(Boolean) : [],
          data,
          `Job #${data.job_id} cancelled`,
          action.block_num
        );
      }
      break;
    case 'timeout':
    case 'accpttimeout':
      handleTimeout(db, data);
      if (dispatcher) {
        const tmJob = db.prepare('SELECT client, agent, state FROM jobs WHERE id = ?').get(data.job_id) as { client: string; agent: string; state: number } | undefined;
        dispatcher.dispatch(
          'job.timeout',
          tmJob ? [tmJob.client, tmJob.agent].filter(Boolean) : [],
          data,
          `Job #${data.job_id} timeout resolved → ${tmJob?.state === 6 ? 'completed' : 'refunded'}`,
          action.block_num
        );
      }
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
      handleAddMilestone(db, { ...data, _escrowContract: action.act.account });
      break;
    case 'submitmile':
      handleSubmitMilestone(db, data);
      break;
    case 'approvemile':
      handleApproveMilestone(db, data);
      break;
    case 'unstakearb':
      handleUnstakeArbitrator(db, data);
      break;
    case 'withdrawarb':
      handleWithdrawArbitrator(db, data);
      break;
    case 'cancelunstk':
      handleCancelUnstake(db, data);
      break;
    case 'submitbid':
      handleSubmitBid(db, { ...data, _escrowContract: action.act.account }, action.timestamp);
      if (dispatcher) {
        const bidJob = db.prepare('SELECT client, title, amount FROM jobs WHERE id = ?').get(data.job_id) as { client: string; title: string; amount: number } | undefined;
        dispatcher.dispatch(
          'bid.submitted',
          bidJob ? [bidJob.client, data.agent] : [data.agent],
          data,
          `New bid on job #${data.job_id}${bidJob ? ` ("${bidJob.title}")` : ''} by ${data.agent} for ${(data.amount || 0) / 10000} XPR`,
          action.block_num
        );
      }
      break;
    case 'selectbid': {
      // Capture bid data BEFORE handleSelectBid deletes all bids for the job
      const selectedBid = db.prepare('SELECT agent, job_id, amount FROM bids WHERE id = ?').get(data.bid_id) as { agent: string; job_id: number; amount: number } | undefined;
      handleSelectBid(db, data);
      if (dispatcher) {
        dispatcher.dispatch(
          'bid.selected',
          selectedBid ? [data.client, selectedBid.agent] : [data.client],
          { ...data, agent: selectedBid?.agent, job_id: selectedBid?.job_id },
          `Bid #${data.bid_id} selected for job #${selectedBid?.job_id || '?'} — agent ${selectedBid?.agent || '?'} assigned`,
          action.block_num
        );
      }
      break;
    }
    case 'withdrawbid':
      handleWithdrawBid(db, data);
      break;
    case 'askclient':
      handleJobMessage(db, action, data.agent, dispatcher);
      break;
    case 'answer':
      handleJobMessage(db, action, data.client, dispatcher);
      break;
    case 'svcinput':
      handleServiceInput(db, action, dispatcher);
      break;
    case 'removejob':
      handleRemoveJob(db, data);
      break;
    case 'listsvc':
      handleListService(db, { ...data, _escrowContract: action.act.account }, action.timestamp);
      break;
    case 'updatesvc':
      handleUpdateService(db, data);
      break;
    case 'delistsvc':
      handleSetServiceActive(db, data, false);
      break;
    case 'relistsvc':
      handleSetServiceActive(db, data, true);
      break;
    case 'setsvcinput':
      handleSetServiceInput(db, data, action.timestamp);
      break;
    case 'rmservice':
      handleRemoveService(db, data);
      break;
    case 'cleanjobs':
      handleCleanJobs(db, data);
      break;
    case 'cleandisps':
      handleCleanEscrowDisputes(db, data);
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

  // Check if this job was already seeded by syncFromChain (match by client + title + job_hash)
  const existing = db.prepare(
    'SELECT id FROM jobs WHERE client = ? AND title = ? AND job_hash = ?'
  ).get(data.client, data.title || '', data.job_hash || '') as { id: number } | undefined;

  if (existing) {
    console.log(`Job already exists (ID ${existing.id}) — skipping duplicate createjob for "${data.title}"`);
    return;
  }

  // Temporary synthetic ID — will be corrected async via RPC lookup
  const countStmt = db.prepare('SELECT MAX(id) as max_id FROM jobs');
  const result = countStmt.get() as { max_id: number | null };
  const tempId = (result.max_id || 0) + 1;

  stmt.run(
    tempId,
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

  console.log(`Job created: ${tempId} (temp) - ${data.title}`);

  // Schedule async correction to replace synthetic ID with real on-chain ID
  const escrowContract = data._escrowContract || 'agentescrow';
  const client = data.client;
  const title = data.title || '';
  const jobHash = data.job_hash || '';

  pendingCorrections.push(async () => {
    const realId = await fetchOnChainJobId(escrowContract, client, title, jobHash);
    if (realId == null) {
      console.warn(`Job ID correction failed for temp ID ${tempId} — RPC lookup returned null`);
      return;
    }
    if (realId === tempId) return; // already correct

    // Collision-safe move: if realId is already in use, displace the occupier
    // to a negative temp slot and re-schedule its own correction.
    safeCorrect(db, JOBS_SPEC, tempId, realId, (displacedId, displacedRow) => {
      const dClient = String(displacedRow.client || '');
      const dTitle = String(displacedRow.title || '');
      const dJobHash = String(displacedRow.job_hash || '');
      pendingCorrections.push(async () => {
        const displacedRealId = await fetchOnChainJobId(escrowContract, dClient, dTitle, dJobHash);
        resolveDisplacedRow(db, JOBS_SPEC, displacedId, displacedRealId);
      });
    });
    console.log(`Job ID corrected: ${tempId} → ${realId} (${title})`);
  });
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

  // Store evidence in separate table
  if (data.evidence_uri) {
    db.prepare(`
      INSERT OR REPLACE INTO job_evidence (job_id, evidence_uri) VALUES (?, ?)
    `).run(data.job_id, data.evidence_uri);
  }

  console.log(`Job ${data.job_id} delivered`);
}

/** agentescrow config.dispute_window on mainnet and testnet (3 days); revise extends the deadline by at least this. */
const REVISE_DEADLINE_EXTENSION_SEC = 259200;

function handleRevise(db: Database.Database, data: any): void {
  // Client sent a delivery back for changes: DELIVERED -> INPROGRESS.
  // Evidence is kept until the agent delivers again.
  // The contract also extends the deadline so the agent keeps at least one
  // dispute window (3 days) to re-deliver: deadline = max(deadline, now + window).
  db.prepare(`
    UPDATE jobs
    SET state = 3,
        updated_at = strftime('%s', 'now'),
        deadline = MAX(COALESCE(deadline, 0), CAST(strftime('%s', 'now') AS INTEGER) + ${REVISE_DEADLINE_EXTENSION_SEC})
    WHERE id = ? AND state = 4
  `).run(data.job_id);

  console.log(`Job ${data.job_id} sent back for revision`);
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

  // Check if already seeded by syncFromChain
  const existingDispute = db.prepare(
    'SELECT id FROM escrow_disputes WHERE job_id = ? AND raised_by = ?'
  ).get(data.job_id, data.raised_by) as { id: number } | undefined;
  if (existingDispute) {
    console.log(`Dispute already exists (ID ${existingDispute.id}) — skipping duplicate`);
    // Still update job state
    const job = db.prepare('SELECT arbitrator FROM jobs WHERE id = ?').get(data.job_id) as { arbitrator: string } | undefined;
    if (job && job.arbitrator) {
      db.prepare('UPDATE arbitrators SET active_disputes = active_disputes + 1 WHERE account = ?').run(job.arbitrator);
    }
    return;
  }

  const countStmt = db.prepare('SELECT MAX(id) as max_id FROM escrow_disputes');
  const result = countStmt.get() as { max_id: number | null };
  const tempId = (result.max_id || 0) + 1;

  const disputeStmt = db.prepare(`
    INSERT INTO escrow_disputes (id, job_id, raised_by, reason, evidence_uri, resolution, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `);
  disputeStmt.run(
    tempId,
    data.job_id,
    data.raised_by,
    data.reason || '',
    data.evidence_uri || '',
    createdAt
  );

  // Increment active_disputes on the arbitrator
  const job = db.prepare('SELECT arbitrator FROM jobs WHERE id = ?').get(data.job_id) as { arbitrator: string } | undefined;
  if (job && job.arbitrator) {
    db.prepare('UPDATE arbitrators SET active_disputes = active_disputes + 1 WHERE account = ?').run(job.arbitrator);
  }

  console.log(`Dispute raised for job ${data.job_id} (temp dispute ID ${tempId})`);

  // Schedule async correction for dispute ID
  const raisedBy = data.raised_by;
  const jobId = data.job_id;
  const disputeContract = data._escrowContract || 'agentescrow';
  pendingCorrections.push(async () => {
    const realId = await fetchOnChainId(disputeContract, 'disputes', (row) =>
      row.job_id == jobId && row.raised_by === raisedBy
    );
    if (realId == null || realId === tempId) return;
    safeCorrect(db, DISPUTES_SPEC, tempId, realId, (displacedId, displacedRow) => {
      const dJobId = Number(displacedRow.job_id);
      const dRaisedBy = String(displacedRow.raised_by || '');
      pendingCorrections.push(async () => {
        const displacedRealId = await fetchOnChainId(disputeContract, 'disputes', (row) =>
          row.job_id == dJobId && row.raised_by === dRaisedBy
        );
        resolveDisplacedRow(db, DISPUTES_SPEC, displacedId, displacedRealId);
      });
    });
    console.log(`Dispute ID corrected: ${tempId} → ${realId}`);
  });
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

  // Decrement active_disputes on the arbitrator
  if (data.arbitrator) {
    db.prepare('UPDATE arbitrators SET active_disputes = MAX(0, active_disputes - 1) WHERE account = ?').run(data.arbitrator);
  }

  // Increment successful_cases for the arbitrator
  const updateArb = db.prepare('UPDATE arbitrators SET total_cases = total_cases + 1, successful_cases = successful_cases + 1 WHERE account = ?');
  updateArb.run(data.arbitrator);

  console.log(`Dispute ${data.dispute_id} arbitrated${dispute ? ` (job ${dispute.job_id})` : ''}`);
}

function handleResolveTimeout(db: Database.Database, data: any, resolver?: string): void {
  // Look up dispute to get job_id
  const dispute = db.prepare('SELECT job_id FROM escrow_disputes WHERE id = ?').get(data.dispute_id) as { job_id: number } | undefined;

  if (dispute) {
    // ARBITRATED: All funds leave escrow (owner resolved with 0% fee)
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
    resolver || 'owner',
    data.resolution_notes || '',
    data.dispute_id
  );

  // Decrement active_disputes on the designated arbitrator (if any)
  if (dispute) {
    const job = db.prepare('SELECT arbitrator FROM jobs WHERE id = ?').get(dispute.job_id) as { arbitrator: string } | undefined;
    if (job && job.arbitrator) {
      db.prepare('UPDATE arbitrators SET active_disputes = MAX(0, active_disputes - 1) WHERE account = ?').run(job.arbitrator);
    }
  }

  console.log(`Dispute ${data.dispute_id} resolved by timeout${dispute ? ` (job ${dispute.job_id})` : ''}`);
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

  // Clean up any bids for this job (contract deletes them on cancel)
  const deleted = db.prepare('DELETE FROM bids WHERE job_id = ?').run(data.job_id);
  if (deleted.changes > 0) {
    console.log(`Job ${data.job_id} cancelled, cleaned up ${deleted.changes} bid(s)`);
  } else {
    console.log(`Job ${data.job_id} cancelled`);
  }
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
  // AUDIT FIX: Use ON CONFLICT to preserve existing stats on re-registration.
  // INSERT OR REPLACE would reset stake, total_cases, successful_cases to 0.
  const stmt = db.prepare(`
    INSERT INTO arbitrators (account, stake, fee_percent, total_cases, successful_cases, active, pending_unstake)
    VALUES (?, 0, ?, 0, 0, 0, 0)
    ON CONFLICT(account) DO UPDATE SET fee_percent = excluded.fee_percent
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
  // Check if already seeded by syncFromChain
  const existingMilestone = db.prepare(
    'SELECT id FROM milestones WHERE job_id = ? AND title = ?'
  ).get(data.job_id, data.title || '') as { id: number } | undefined;
  if (existingMilestone) {
    console.log(`Milestone already exists (ID ${existingMilestone.id}) — skipping duplicate`);
    return;
  }

  const countStmt = db.prepare('SELECT MAX(id) as max_id FROM milestones');
  const result = countStmt.get() as { max_id: number | null };
  const tempId = (result.max_id || 0) + 1;

  const stmt = db.prepare(`
    INSERT INTO milestones (id, job_id, title, description, amount, milestone_order, state, evidence_uri)
    VALUES (?, ?, ?, ?, ?, ?, 0, '')
  `);
  stmt.run(
    tempId,
    data.job_id,
    data.title || '',
    data.description || '',
    data.amount || 0,
    data.order || 0
  );
  console.log(`Milestone added to job ${data.job_id}: ${data.title} (temp ID ${tempId})`);

  // Schedule async correction for milestone ID
  const milestoneJobId = data.job_id;
  const milestoneTitle = data.title || '';
  const milestoneContract = data._escrowContract || 'agentescrow';
  pendingCorrections.push(async () => {
    const realId = await fetchOnChainId(milestoneContract, 'milestones', (row) =>
      row.job_id == milestoneJobId && row.title === milestoneTitle
    );
    if (realId == null || realId === tempId) return;
    safeCorrect(db, MILESTONES_SPEC, tempId, realId, (displacedId, displacedRow) => {
      const dJobId = Number(displacedRow.job_id);
      const dTitle = String(displacedRow.title || '');
      pendingCorrections.push(async () => {
        const displacedRealId = await fetchOnChainId(milestoneContract, 'milestones', (row) =>
          row.job_id == dJobId && row.title === dTitle
        );
        resolveDisplacedRow(db, MILESTONES_SPEC, displacedId, displacedRealId);
      });
    });
    console.log(`Milestone ID corrected: ${tempId} → ${realId}`);
  });
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

function handleUnstakeArbitrator(db: Database.Database, data: any): void {
  // Reduce arbitrator stake and track pending unstake amount
  // On-chain: stake is reduced immediately, amount is locked in ArbUnstake record
  // data.amount is available because unstakearb(account, amount) includes it
  const stmt = db.prepare(`
    UPDATE arbitrators
    SET stake = MAX(0, stake - ?), pending_unstake = pending_unstake + ?
    WHERE account = ?
  `);
  const amount = data.amount || 0;
  stmt.run(amount, amount, data.account);
  console.log(`Arbitrator ${data.account} unstaking ${amount / 10000} XPR`);
}

function handleWithdrawArbitrator(db: Database.Database, data: any): void {
  // Withdrawal completed - clear pending_unstake (tokens sent to arbitrator)
  // On-chain: withdrawarb(account) only takes account, no amount in action data
  const stmt = db.prepare(`
    UPDATE arbitrators
    SET pending_unstake = 0
    WHERE account = ?
  `);
  stmt.run(data.account);
  console.log(`Arbitrator ${data.account} withdrew unstaked funds`);
}

function handleCancelUnstake(db: Database.Database, data: any): void {
  // Cancelled unstake - return pending_unstake back to active stake
  // On-chain: cancelunstk(account) only takes account, no amount in action data
  // We use the tracked pending_unstake amount instead
  const stmt = db.prepare(`
    UPDATE arbitrators
    SET stake = stake + pending_unstake, pending_unstake = 0
    WHERE account = ?
  `);
  stmt.run(data.account);
  console.log(`Arbitrator ${data.account} cancelled unstake, stake restored`);
}

function handleSubmitBid(db: Database.Database, data: any, timestamp: string): void {
  const createdAt = Math.floor(new Date(timestamp).getTime() / 1000);

  // Check if already seeded by syncFromChain
  const existingBid = db.prepare(
    'SELECT id FROM bids WHERE job_id = ? AND agent = ?'
  ).get(data.job_id, data.agent) as { id: number } | undefined;
  if (existingBid) {
    console.log(`Bid already exists (ID ${existingBid.id}) — skipping duplicate`);
    return;
  }

  const countStmt = db.prepare('SELECT MAX(id) as max_id FROM bids');
  const result = countStmt.get() as { max_id: number | null };
  const tempId = (result.max_id || 0) + 1;

  const stmt = db.prepare(`
    INSERT INTO bids (id, job_id, agent, amount, timeline, proposal, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    tempId,
    data.job_id,
    data.agent,
    data.amount || 0,
    data.timeline || 0,
    data.proposal || '',
    createdAt
  );
  console.log(`Bid ${tempId} (temp) submitted on job ${data.job_id} by ${data.agent}`);

  // Schedule async correction for bid ID
  const bidJobId = data.job_id;
  const bidAgent = data.agent;
  const bidContract = data._escrowContract || 'agentescrow';
  pendingCorrections.push(async () => {
    const realId = await fetchOnChainId(bidContract, 'bids', (row) =>
      row.job_id == bidJobId && row.agent === bidAgent
    );
    if (realId == null || realId === tempId) return;
    safeCorrect(db, BIDS_SPEC, tempId, realId, (displacedId, displacedRow) => {
      const dJobId = Number(displacedRow.job_id);
      const dAgent = String(displacedRow.agent || '');
      pendingCorrections.push(async () => {
        const displacedRealId = await fetchOnChainId(bidContract, 'bids', (row) =>
          row.job_id == dJobId && row.agent === dAgent
        );
        resolveDisplacedRow(db, BIDS_SPEC, displacedId, displacedRealId);
      });
    });
    console.log(`Bid ID corrected: ${tempId} → ${realId}`);
  });
}

/**
 * Admin removejob — chain admin force-removes a spam/abusive job.
 * The contract action wipes the row (and any associated bids/milestones/disputes
 * fee-bearing structures) on chain; indexer mirrors with cascading DELETE so
 * those records don't linger and confuse later inserts (synthetic-ID drift,
 * UNIQUE conflicts, frontend showing zombie rows).
 */
function handleRemoveJob(db: Database.Database, data: any): void {
  const jobId = Number(data.job_id);
  if (!Number.isFinite(jobId)) return;
  const before = db.prepare('SELECT title, client FROM jobs WHERE id = ?').get(jobId) as
    | { title: string; client: string }
    | undefined;
  db.transaction(() => {
    db.prepare('DELETE FROM bids WHERE job_id = ?').run(jobId);
    db.prepare('DELETE FROM milestones WHERE job_id = ?').run(jobId);
    db.prepare('DELETE FROM escrow_disputes WHERE job_id = ?').run(jobId);
    db.prepare('DELETE FROM job_evidence WHERE job_id = ?').run(jobId);
    db.prepare('DELETE FROM job_messages WHERE job_id = ?').run(jobId);
    db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
  })();
  console.log(
    `Job ${jobId} removed (admin)${before ? ` — was "${before.title}" by ${before.client}` : ''}`,
  );
}

/* ------------------------------------------------------------------ */
/*  Job messages (question / answer thread)                             */
/* ------------------------------------------------------------------ */

/**
 * Fetch the real on-chain ID of a freshly stored `jobmsgs` row.
 *
 * `fetchOnChainId` scans the table in reverse from the primary index, so the
 * message just written is among the newest rows; job_id + author + text picks
 * it out (the same message twice in a row resolves to the newest, which is the
 * correct answer for the row we just inserted).
 */
async function fetchOnChainJobMessageId(
  escrowContract: string,
  jobId: number,
  author: string,
  text: string,
): Promise<number | null> {
  return fetchOnChainId(escrowContract, 'jobmsgs', (row) =>
    Number(row.job_id) === jobId && row.author === author && (row.text || '') === (text || '')
  );
}

/**
 * askclient / answer — one message in a job's question/answer thread.
 *
 * The action data carries no primary key, so the row goes in with a synthetic
 * MAX(id)+1 and an async RPC lookup corrects it to the real `jobmsgs` ID
 * (same machinery as jobs/bids/services). Without an RPC endpoint the
 * synthetic ID stands.
 *
 * The derived event and the webhook are emitted from the async step so they
 * always carry the final message ID. The webhook goes to the *other* party:
 * a question notifies the client, an answer notifies the agent.
 */
function handleJobMessage(
  db: Database.Database,
  action: StreamAction,
  author: string,
  dispatcher?: WebhookDispatcher,
): void {
  const data = action.act.data;
  const jobId = Number(data.job_id);

  if (!Number.isFinite(jobId)) {
    console.warn(`[job-messages] Ignoring malformed ${action.act.name}: job_id=${data.job_id} author=${author}`);
    return;
  }

  insertJobMessage(db, action, {
    author,
    jobId,
    isQuestion: action.act.name === 'askclient',
  }, dispatcher);
}

/**
 * svcinput — the buyer's answers to a service's input form, sent in the same
 * transaction as the purchase transfer. Indexed exactly like `answer` (a
 * `jobmsgs` row authored by the client, a `job.answer` event and a webhook to
 * the agent); only the job ID needs finding, because the action data doesn't
 * carry one.
 *
 * Resolution order:
 *  1. the client's newest `svc:` job in the mirror — the purchase transfer in
 *     the same transaction was handled a moment ago, so this is normally it;
 *  2. the chain `lastbuys` table for that client, read in the async step and
 *     applied when it disagrees. Best-effort: the contract deletes the row as
 *     part of `svcinput`, so this usually reads back empty and step 1 stands.
 *
 * A later correction of the job's own ID drags the message along through
 * JOBS_SPEC's foreign-key list, so the thread stays attached either way.
 */
function handleServiceInput(
  db: Database.Database,
  action: StreamAction,
  dispatcher?: WebhookDispatcher,
): void {
  const data = action.act.data;
  const client: string = data.client || '';

  if (!client) {
    console.warn(`[job-messages] Ignoring malformed svcinput: client=${data.client}`);
    return;
  }

  const escrowContract = action.act.account;

  // Newest service-purchase job for this buyer (the one just funded).
  const mirrored = db.prepare(`
    SELECT id FROM jobs
    WHERE client = ? AND job_hash LIKE 'svc:%'
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(client) as { id: number } | undefined;

  if (!mirrored) {
    console.warn(`[job-messages] svcinput from ${client} — no service purchase job in the mirror yet`);
  }

  insertJobMessage(db, action, {
    author: client,
    jobId: mirrored?.id ?? 0,
    isQuestion: false,
    resolveJobId: () => fetchLastBuyJobId(escrowContract, client),
  }, dispatcher);
}

/**
 * Read `lastbuys[client].job_id` from the chain. Returns null when no RPC
 * endpoint is configured, the row is gone (the usual case — `svcinput`
 * consumes it) or the read fails.
 */
async function fetchLastBuyJobId(escrowContract: string, client: string): Promise<number | null> {
  const rpcEndpoint = getRpcEndpoint();
  if (!rpcEndpoint) return null;
  try {
    const res = await fetch(`${rpcEndpoint}/v1/chain/get_table_rows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: escrowContract,
        table: 'lastbuys',
        scope: escrowContract,
        json: true,
        lower_bound: client,
        upper_bound: client,
        limit: 1,
      }),
    });
    const data = (await res.json()) as { rows?: any[] };
    const row = data.rows && data.rows[0];
    if (!row || row.client !== client) return null;
    const jobId = Number(row.job_id);
    return Number.isFinite(jobId) ? jobId : null;
  } catch (err) {
    console.warn(`[job-messages] Failed to read lastbuys for ${client}:`, err);
    return null;
  }
}

interface JobMessageInsert {
  /** Message author (the agent for a question, the client for an answer). */
  author: string;
  /** Job the message belongs to; 0 when it could not be resolved yet. */
  jobId: number;
  /** true = job.question (agent asked), false = job.answer (client replied). */
  isQuestion: boolean;
  /** Optional chain lookup that may correct `jobId` in the async step. */
  resolveJobId?: () => Promise<number | null>;
}

/**
 * Shared write path for every kind of job message (askclient / answer /
 * svcinput): synthetic-ID insert now, chain corrections + derived event +
 * webhook in the async step, so both always carry the final IDs.
 */
function insertJobMessage(
  db: Database.Database,
  action: StreamAction,
  opts: JobMessageInsert,
  dispatcher?: WebhookDispatcher,
): void {
  const { author, isQuestion, resolveJobId } = opts;
  const escrowContract = action.act.account;
  const text: string = action.act.data.text || '';

  if (!author) {
    console.warn(`[job-messages] Ignoring ${action.act.name} with no author`);
    return;
  }

  const jobId = opts.jobId;
  const createdAt = Math.floor(new Date(action.timestamp).getTime() / 1000);

  // Replay guard: the same message from the same author in the same second is
  // a re-processed action, not a second message.
  const existing = db.prepare(
    'SELECT id FROM job_messages WHERE job_id = ? AND author = ? AND text = ? AND created_at = ?'
  ).get(jobId, author, text, createdAt) as { id: number } | undefined;
  if (existing) {
    console.log(`Job message already exists (ID ${existing.id}) — skipping duplicate ${action.act.name} on job ${jobId}`);
    return;
  }

  const result = db.prepare('SELECT MAX(id) as max_id FROM job_messages').get() as { max_id: number | null };
  const tempId = (result.max_id || 0) + 1;

  db.prepare(`
    INSERT INTO job_messages (id, job_id, author, text, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(tempId, jobId, author, text, createdAt);

  console.log(
    `Job ${jobId} ${isQuestion ? 'question' : 'answer'} from ${author} — message ${tempId} (temp)`,
  );

  const blockNum = action.block_num;

  pendingCorrections.push(async () => {
    // 1. The chain may know a better job ID than the one guessed locally.
    if (resolveJobId) {
      const chainJobId = await resolveJobId();
      if (chainJobId != null && chainJobId !== jobId) {
        db.prepare('UPDATE job_messages SET job_id = ? WHERE id = ?').run(chainJobId, tempId);
        console.log(`Job message ${tempId} re-attached to job ${chainJobId} (was ${jobId})`);
      }
    }

    // Re-read: an earlier correction in this batch may have moved the job.
    const current = db.prepare('SELECT job_id FROM job_messages WHERE id = ?').get(tempId) as
      | { job_id: number }
      | undefined;
    const finalJobId = current ? Number(current.job_id) : jobId;

    // 2. Replace the synthetic message ID with the real jobmsgs ID.
    const realId = await fetchOnChainJobMessageId(escrowContract, finalJobId, author, text);
    let messageId = tempId;

    if (realId == null) {
      console.warn(
        `[job-messages] ID lookup failed for job ${finalJobId} ${isQuestion ? 'question' : 'answer'} — ` +
        `keeping synthetic ID ${tempId} (RPC unavailable or row not found)`,
      );
    } else if (realId !== tempId) {
      safeCorrect(db, JOB_MESSAGES_SPEC, tempId, realId, (displacedId, displacedRow) => {
        const dJobId = Number(displacedRow.job_id);
        const dAuthor = String(displacedRow.author || '');
        const dText = String(displacedRow.text || '');
        pendingCorrections.push(async () => {
          const displacedRealId = await fetchOnChainJobMessageId(escrowContract, dJobId, dAuthor, dText);
          resolveDisplacedRow(db, JOB_MESSAGES_SPEC, displacedId, displacedRealId);
        });
      });
      messageId = realId;
      console.log(`Job message ID corrected: ${tempId} -> ${realId} (job ${finalJobId})`);
    } else {
      messageId = realId;
    }

    const eventName = isQuestion ? 'job.question' : 'job.answer';
    const payload = {
      job_id: finalJobId,
      message_id: messageId,
      author,
      text,
    };

    logDerivedEvent(db, action, eventName, escrowContract, payload);

    // A question is for the client to answer; an answer is for the agent.
    const job = db.prepare('SELECT client, agent FROM jobs WHERE id = ?').get(finalJobId) as
      | { client: string; agent: string }
      | undefined;
    const recipient = isQuestion ? job?.client : job?.agent;

    dispatcher?.dispatch(
      eventName,
      recipient ? [recipient] : [],
      payload,
      isQuestion
        ? `Job #${finalJobId}: ${author} asked a question — "${text}"`
        : `Job #${finalJobId}: ${author} answered — "${text}"`,
      blockNum,
    );
  });
}

/* ------------------------------------------------------------------ */
/*  Services (fixed-price listings)                                     */
/* ------------------------------------------------------------------ */

/**
 * listsvc — an agent publishes a fixed-price service.
 *
 * The action data carries no primary key, so the row is inserted with a
 * synthetic MAX(id)+1 ID (existing practice, see handleCreateJob) and an
 * async RPC correction is scheduled to replace it with the real on-chain ID
 * read from the newest `services` rows for that agent. With no RPC endpoint
 * configured the synthetic ID stands, exactly like jobs/bids/milestones.
 */
function handleListService(db: Database.Database, data: any, timestamp: string): void {
  const createdAt = Math.floor(new Date(timestamp).getTime() / 1000);
  const agent = data.agent;
  const title = data.title || '';

  // Skip if this listing was already seeded by syncFromChain (same agent,
  // same title, still active) — mirrors the createjob dedup check.
  const existing = db.prepare(
    'SELECT id FROM services WHERE agent = ? AND title = ? AND active = 1'
  ).get(agent, title) as { id: number } | undefined;
  if (existing) {
    console.log(`Service already exists (ID ${existing.id}) — skipping duplicate listsvc for "${title}"`);
    return;
  }

  const result = db.prepare('SELECT MAX(id) as max_id FROM services').get() as { max_id: number | null };
  const tempId = (result.max_id || 0) + 1;

  db.prepare(`
    INSERT INTO services (id, agent, title, description, deliverables, price, turnaround, category, sample_uri, active, sales, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
  `).run(
    tempId,
    agent,
    title,
    data.description || '',
    data.deliverables || '[]',
    data.price || 0,
    data.turnaround || 0,
    data.category || '',
    data.sample_uri || '',
    createdAt,
    createdAt,
  );

  console.log(`Service listed: ${tempId} (temp) by ${agent} — "${title}"`);

  const escrowContract = data._escrowContract || 'agentescrow';
  pendingCorrections.push(async () => {
    const realId = await fetchOnChainServiceId(escrowContract, agent, title);
    if (realId == null) {
      console.warn(`Service ID correction failed for temp ID ${tempId} — RPC lookup returned null`);
      return;
    }
    if (realId === tempId) return;

    safeCorrect(db, SERVICES_SPEC, tempId, realId, (displacedId, displacedRow) => {
      const dAgent = String(displacedRow.agent || '');
      const dTitle = String(displacedRow.title || '');
      pendingCorrections.push(async () => {
        const displacedRealId = await fetchOnChainServiceId(escrowContract, dAgent, dTitle);
        resolveDisplacedRow(db, SERVICES_SPEC, displacedId, displacedRealId);
      });
    });
    console.log(`Service ID corrected: ${tempId} → ${realId} (${title})`);
  });
}

/** updatesvc — the seller edits a listing. `active` and `sales` are untouched. */
function handleUpdateService(db: Database.Database, data: any): void {
  const serviceId = Number(data.service_id);
  if (!Number.isFinite(serviceId)) return;

  const result = db.prepare(`
    UPDATE services
    SET title = ?, description = ?, deliverables = ?, price = ?, turnaround = ?,
        category = ?, sample_uri = ?, updated_at = strftime('%s', 'now')
    WHERE id = ? AND agent = ?
  `).run(
    data.title || '',
    data.description || '',
    data.deliverables || '[]',
    data.price || 0,
    data.turnaround || 0,
    data.category || '',
    data.sample_uri || '',
    serviceId,
    data.agent,
  );

  if (result.changes > 0) {
    console.log(`Service ${serviceId} updated by ${data.agent}`);
  } else {
    console.log(`Service ${serviceId} updated but not found in indexer (agent ${data.agent})`);
  }
}

/** delistsvc / relistsvc — toggle catalogue visibility; the row is kept for history. */
function handleSetServiceActive(db: Database.Database, data: any, active: boolean): void {
  const serviceId = Number(data.service_id);
  if (!Number.isFinite(serviceId)) return;

  const result = db.prepare(`
    UPDATE services SET active = ?, updated_at = strftime('%s', 'now')
    WHERE id = ? AND agent = ?
  `).run(active ? 1 : 0, serviceId, data.agent);

  if (result.changes > 0) {
    console.log(`Service ${serviceId} ${active ? 'relisted' : 'delisted'} by ${data.agent}`);
  } else {
    console.log(`Service ${serviceId} ${active ? 'relist' : 'delist'} but not found in indexer`);
  }
}

/** rmservice — admin (config.owner) removes a spam/abusive listing; the chain deletes the row. */
/**
 * setsvcinput — the seller declares (or clears) the input form for a listing.
 * An empty schema removes the row, exactly as the contract does. The schema is
 * stored verbatim: the site owns its shape, the mirror only carries it.
 */
function handleSetServiceInput(db: Database.Database, data: any, timestamp: string): void {
  const serviceId = Number(data.service_id);
  if (!Number.isFinite(serviceId)) {
    console.warn(`[services] Ignoring setsvcinput with bad service_id: ${data.service_id}`);
    return;
  }

  const schema: string = data.schema || '';
  const updatedAt = Math.floor(new Date(timestamp).getTime() / 1000);

  if (schema === '') {
    db.prepare('DELETE FROM service_inputs WHERE service_id = ?').run(serviceId);
    console.log(`Service ${serviceId} input form cleared`);
    return;
  }

  db.prepare(`
    INSERT INTO service_inputs (service_id, schema, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(service_id) DO UPDATE SET schema = excluded.schema, updated_at = excluded.updated_at
  `).run(serviceId, schema, updatedAt);

  console.log(`Service ${serviceId} input form set (${schema.length} chars)`);
}

function handleRemoveService(db: Database.Database, data: any): void {
  const serviceId = Number(data.service_id);
  if (!Number.isFinite(serviceId)) return;

  const before = db.prepare('SELECT agent, title FROM services WHERE id = ?').get(serviceId) as
    | { agent: string; title: string }
    | undefined;
  db.transaction(() => {
    db.prepare('DELETE FROM service_inputs WHERE service_id = ?').run(serviceId);
    db.prepare('DELETE FROM services WHERE id = ?').run(serviceId);
  })();
  console.log(
    `Service ${serviceId} removed (admin)${before ? ` — was "${before.title}" by ${before.agent}` : ''}`,
  );
}

function handleSelectBid(db: Database.Database, data: any): void {
  // Look up the bid to get agent + job_id
  const bid = db.prepare('SELECT agent, job_id, amount, timeline FROM bids WHERE id = ?').get(data.bid_id) as { agent: string; job_id: number; amount: number; timeline: number } | undefined;

  if (bid) {
    // Assign agent to job, update amount and deadline
    const now = Math.floor(Date.now() / 1000);
    const stmt = db.prepare(`
      UPDATE jobs
      SET agent = ?, amount = ?, deadline = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(bid.agent, bid.amount, now + bid.timeline, now, bid.job_id);

    // Soft-delete: mark bids by state instead of hard-delete. The contract
    // garbage-collects competing bids on selectbid, but the indexer keeps them
    // so the winning proposal text remains queryable forever.
    db.prepare('UPDATE bids SET state = 2 WHERE job_id = ? AND id != ?').run(bid.job_id, data.bid_id);
    db.prepare('UPDATE bids SET state = 1 WHERE id = ?').run(data.bid_id);

    console.log(`Bid ${data.bid_id} selected: agent ${bid.agent} assigned to job ${bid.job_id}`);
  } else {
    console.log(`Bid ${data.bid_id} selected but bid not found in indexer`);
  }
}

function handleWithdrawBid(db: Database.Database, data: any): void {
  // Soft-delete: mark withdrawn instead of removing — preserves history.
  const result = db.prepare('UPDATE bids SET state = 3 WHERE id = ?').run(data.bid_id);
  if (result.changes > 0) {
    console.log(`Bid ${data.bid_id} withdrawn by ${data.agent}`);
  } else {
    console.log(`Bid ${data.bid_id} withdrawn but bid not found in indexer`);
  }
}

function handleCleanJobs(db: Database.Database, data: any): void {
  // Mark cleaned-from-chain jobs as archived (preserve history in DB)
  const maxAge = data.max_age || 0;
  const maxDelete = data.max_delete || 100;
  const cutoff = Math.floor(Date.now() / 1000) - maxAge;

  const jobs = db.prepare(`
    SELECT id FROM jobs
    WHERE state IN (6, 7, 8) AND updated_at < ? AND archived = 0
    LIMIT ?
  `).all(cutoff, maxDelete) as Array<{ id: number }>;

  for (const job of jobs) {
    db.prepare('UPDATE milestones SET archived = 1 WHERE job_id = ?').run(job.id);
    // The chain deletes the thread with the job, so the mirror does too — the
    // job row itself is only archived (history), but its messages are gone.
    db.prepare('DELETE FROM job_messages WHERE job_id = ?').run(job.id);
    db.prepare('UPDATE jobs SET archived = 1 WHERE id = ?').run(job.id);
  }

  console.log(`Archived ${jobs.length} completed jobs`);
}

function handleCleanEscrowDisputes(db: Database.Database, data: any): void {
  // Mark cleaned-from-chain disputes as archived
  const maxAge = data.max_age || 0;
  const maxDelete = data.max_delete || 100;
  const cutoff = Math.floor(Date.now() / 1000) - maxAge;

  const result = db.prepare(`
    UPDATE escrow_disputes SET archived = 1
    WHERE id IN (
      SELECT id FROM escrow_disputes
      WHERE resolution != 0 AND resolved_at > 0 AND resolved_at < ? AND archived = 0
      LIMIT ?
    )
  `).run(cutoff, maxDelete);

  console.log(`Archived ${result.changes} old escrow disputes`);
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
 * Log a derived event (not a chain action) into the events table, e.g.
 * `service.bought`, which is produced by a transfer notification rather than
 * by an action of its own.
 */
function logDerivedEvent(
  db: Database.Database,
  action: StreamAction,
  eventName: string,
  contract: string,
  data: Record<string, unknown>,
): void {
  const timestamp = Math.floor(new Date(action.timestamp).getTime() / 1000);
  db.prepare(`
    INSERT INTO events (block_num, transaction_id, action_name, contract, data, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(action.block_num, action.trx_id, eventName, contract, JSON.stringify(data), timestamp);
}

/**
 * Fetch the real on-chain job ID for a service purchase: the buyer's newest
 * job carrying job_hash = "svc:<service_id>". `fetchOnChainId` scans the jobs
 * table in reverse (newest primary keys first), so the job the purchase just
 * created is the first match.
 */
async function fetchOnChainPurchaseJobId(
  escrowContract: string,
  client: string,
  jobHash: string,
): Promise<number | null> {
  return fetchOnChainId(escrowContract, 'jobs', (row) =>
    row.client === client && (row.job_hash || '') === jobHash
  );
}

/**
 * Service purchase (transfer memo "buy:<service_id>").
 *
 * On chain the transfer creates a direct-hire job that is already funded, so
 * the indexer mirrors it as an ordinary `jobs` row — every later action
 * (acceptjob / startjob / deliver / revise / approve / dispute …) then works
 * on it unchanged, because those handlers only need the row to exist.
 *
 * Job ID resolution: the transfer carries no job ID, so the row is inserted
 * with a synthetic MAX(id)+1 and an async RPC lookup replaces it with the
 * real on-chain ID (the buyer's newest job with job_hash = "svc:<id>"). If no
 * RPC endpoint is configured the synthetic ID stands and a warning is logged.
 * The `service.bought` event and webhook are emitted from that same async step
 * so they always carry the final job ID.
 */
function handleServicePurchase(
  db: Database.Database,
  action: StreamAction,
  escrowContract: string,
  from: string,
  amountStr: string,
  dispatcher?: WebhookDispatcher,
): void {
  const memo: string = action.act.data.memo;

  // "buy:<service_id>" or "buy:<service_id>:<buyer notes>". The notes may
  // themselves contain colons, so only the digits before the *first* colon
  // after the ID are the ID.
  const rest = memo.substring(4);
  const sep = rest.indexOf(':');
  const idPart = sep === -1 ? rest : rest.substring(0, sep);
  const notes = sep === -1 ? '' : rest.substring(sep + 1);

  if (!/^\d+$/.test(idPart)) {
    console.warn(`[services] Ignoring malformed buy memo: "${memo}"`);
    return;
  }
  const serviceId = parseInt(idPart, 10);

  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId) as
    | {
        id: number;
        agent: string;
        title: string;
        description: string;
        deliverables: string;
        price: number;
        turnaround: number;
      }
    | undefined;

  if (!service) {
    console.warn(`[services] Purchase of unknown service ${serviceId} by ${from} — job not indexed`);
    return;
  }

  const now = Math.floor(new Date(action.timestamp).getTime() / 1000);
  const jobHash = `svc:${serviceId}`;

  // The contract appends the buyer's notes to the job description (the listing's
  // own description is untouched), so the mirror does exactly the same.
  const description = notes
    ? `${service.description || ''}\n\nBuyer notes: ${notes}`
    : service.description || '';

  // Replay guard: a re-processed transfer must neither double-count the sale
  // nor insert the job twice, so both writes sit behind this check.
  const existing = db.prepare(
    'SELECT id FROM jobs WHERE client = ? AND job_hash = ? AND created_at = ?'
  ).get(from, jobHash, now) as { id: number } | undefined;
  if (existing) {
    console.log(`Service purchase job already exists (ID ${existing.id}) — skipping duplicate buy:${serviceId}`);
    return;
  }

  const result = db.prepare('SELECT MAX(id) as max_id FROM jobs').get() as { max_id: number | null };
  const tempId = (result.max_id || 0) + 1;

  // state = 1 (FUNDED), funded by the purchase transfer itself.
  db.prepare(`
    INSERT INTO jobs (id, client, agent, title, description, deliverables, amount, symbol, funded_amount, released_amount, state, deadline, arbitrator, job_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'XPR', ?, 0, 1, ?, '', ?, ?, ?)
  `).run(
    tempId,
    from,
    service.agent,
    service.title || '',
    description,
    service.deliverables || '[]',
    service.price || 0,
    service.price || 0,
    now + (service.turnaround || 0),
    jobHash,
    now,
    now,
  );

  // Chain increments sales only — updated_at stays at the last edit, so mirror that.
  db.prepare('UPDATE services SET sales = sales + 1 WHERE id = ?').run(serviceId);

  console.log(
    `Service ${serviceId} bought by ${from} for ${amountStr} — job ${tempId} (temp) for ${service.agent}`,
  );

  const agent = service.agent;
  const title = service.title || '';
  const price = service.price || 0;
  const blockNum = action.block_num;

  pendingCorrections.push(async () => {
    const realId = await fetchOnChainPurchaseJobId(escrowContract, from, jobHash);
    let jobId = tempId;

    if (realId == null) {
      console.warn(
        `[services] Job ID lookup failed for service ${serviceId} purchase — ` +
        `keeping synthetic ID ${tempId} (RPC unavailable or job not found)`,
      );
    } else if (realId !== tempId) {
      safeCorrect(db, JOBS_SPEC, tempId, realId, (displacedId, displacedRow) => {
        const dClient = String(displacedRow.client || '');
        const dTitle = String(displacedRow.title || '');
        const dJobHash = String(displacedRow.job_hash || '');
        pendingCorrections.push(async () => {
          const displacedRealId = await fetchOnChainJobId(escrowContract, dClient, dTitle, dJobHash);
          resolveDisplacedRow(db, JOBS_SPEC, displacedId, displacedRealId);
        });
      });
      jobId = realId;
      console.log(`Job ID corrected: ${tempId} → ${realId} (service ${serviceId} purchase)`);
    } else {
      jobId = realId;
    }

    const payload = {
      service_id: serviceId,
      job_id: jobId,
      agent,
      client: from,
      title,
      price,
      quantity: amountStr,
    };

    logDerivedEvent(db, action, 'service.bought', escrowContract, payload);

    dispatcher?.dispatch(
      'service.bought',
      [agent, from],
      payload,
      `Service #${serviceId} "${title}" bought by ${from} — job #${jobId} funded with ${price / 10000} XPR`,
      blockNum,
    );
  });
}

/** Boost rate: 1 XPR (10000 raw units) buys one featured day. */
const BOOST_RATE_PER_DAY = 10000;
const SECONDS_PER_DAY = 86400;

/**
 * Read one `services` row straight from the chain (primary key lookup).
 * Returns null when no RPC endpoint is configured or the read fails, so
 * callers fall back to their locally computed value.
 */
async function fetchOnChainServiceRow(
  escrowContract: string,
  serviceId: number,
): Promise<Record<string, any> | null> {
  const rpcEndpoint = getRpcEndpoint();
  if (!rpcEndpoint) return null;
  try {
    const res = await fetch(`${rpcEndpoint}/v1/chain/get_table_rows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: escrowContract,
        table: 'services',
        scope: escrowContract,
        json: true,
        lower_bound: String(serviceId),
        upper_bound: String(serviceId),
        limit: 1,
      }),
    });
    const data = (await res.json()) as { rows?: any[] };
    const row = data.rows && data.rows[0];
    if (!row) return null;
    return Number(row.id) === serviceId ? row : null;
  } catch (err) {
    console.warn(`[services] Failed to read service ${serviceId} from chain:`, err);
    return null;
  }
}

/**
 * Featured placement (transfer memo "boost:<service_id>").
 *
 * `boost_paid` accumulates the lifetime spend and each 1 XPR adds a day of
 * featured placement, counted from `max(now, featured_until)` so consecutive
 * boosts extend rather than reset. The contract owns the real arithmetic, so
 * an async RPC read of the chain row overwrites both fields with the
 * authoritative values whenever an endpoint is configured; without RPC the
 * locally computed values stand.
 */
function handleServiceBoost(
  db: Database.Database,
  action: StreamAction,
  escrowContract: string,
  from: string,
  amount: number,
  amountStr: string,
  dispatcher?: WebhookDispatcher,
): void {
  const memo: string = action.act.data.memo;
  const serviceId = parseInt(memo.substring(6), 10);
  if (isNaN(serviceId)) {
    console.warn(`[services] Ignoring malformed boost memo: "${memo}"`);
    return;
  }

  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId) as
    | { id: number; agent: string; title: string; boost_paid: number; featured_until: number }
    | undefined;

  if (!service) {
    console.warn(`[services] Boost of unknown service ${serviceId} by ${from} — ignored`);
    return;
  }

  const now = Math.floor(new Date(action.timestamp).getTime() / 1000);
  const days = Math.floor(amount / BOOST_RATE_PER_DAY);
  const base = Math.max(now, service.featured_until || 0);
  const featuredUntil = base + days * SECONDS_PER_DAY;

  db.prepare(`
    UPDATE services
    SET boost_paid = boost_paid + ?, featured_until = ?, updated_at = ?
    WHERE id = ?
  `).run(amount, featuredUntil, now, serviceId);

  console.log(
    `Service ${serviceId} boosted by ${from} with ${amountStr} (+${days}d, featured until ${featuredUntil})`,
  );

  const payload = {
    service_id: serviceId,
    agent: service.agent,
    booster: from,
    title: service.title,
    amount,
    quantity: amountStr,
    days,
    featured_until: featuredUntil,
  };

  logDerivedEvent(db, action, 'service.boosted', escrowContract, payload);

  dispatcher?.dispatch(
    'service.boosted',
    [service.agent, from],
    payload,
    `Service #${serviceId} "${service.title}" boosted by ${from} with ${amountStr} (+${days} day${days === 1 ? '' : 's'})`,
    action.block_num,
  );

  // Reconcile against the chain row: the contract is the source of truth for
  // boost_paid and featured_until (config.boost_rate can differ from the
  // default assumed above).
  pendingCorrections.push(async () => {
    const row = await fetchOnChainServiceRow(escrowContract, serviceId);
    if (!row) return;
    const chainBoostPaid = Number(row.boost_paid ?? 0);
    const chainFeaturedUntil = Number(row.featured_until ?? 0);
    if (!Number.isFinite(chainBoostPaid) || !Number.isFinite(chainFeaturedUntil)) return;
    db.prepare('UPDATE services SET boost_paid = ?, featured_until = ? WHERE id = ?').run(
      chainBoostPaid,
      chainFeaturedUntil,
      serviceId,
    );
    if (chainFeaturedUntil !== featuredUntil || chainBoostPaid !== service.boost_paid + amount) {
      console.log(
        `Service ${serviceId} boost reconciled from chain: boost_paid=${chainBoostPaid}, featured_until=${chainFeaturedUntil}`,
      );
    }
  });
}

/**
 * Listing-fee deposit (transfer memo "svcfee:<agent>").
 *
 * Deposits are held in the contract's `svcdeposits` table until the next
 * `listsvc` consumes them (or `refundsvcfee` returns them); the indexer keeps
 * no mirror of that balance, so this only records the event.
 */
function handleServiceFeeDeposit(
  db: Database.Database,
  action: StreamAction,
  escrowContract: string,
  from: string,
  amount: number,
  amountStr: string,
): void {
  const memo: string = action.act.data.memo;
  const agent = memo.substring(7) || from;

  logDerivedEvent(db, action, 'service.fee_paid', escrowContract, {
    agent,
    payer: from,
    amount,
    quantity: amountStr,
  });

  console.log(`Listing fee deposit of ${amountStr} from ${from} for ${agent} (no mirror state)`);
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
export function handleEscrowTransfer(db: Database.Database, action: StreamAction, escrowContract: string, dispatcher?: WebhookDispatcher): void {
  const { from, to, quantity, memo } = action.act.data;

  // Parse quantity (e.g., "100.0000 XPR")
  const [amountStr] = quantity.split(' ');
  const [whole = '0', frac = ''] = amountStr.split('.');
  const amount = parseInt(whole, 10) * 10000 + parseInt(frac.padEnd(4, '0').slice(0, 4), 10);

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

        dispatcher?.dispatch(
          'job.funded',
          [from],
          { job_id: jobId, amount: amountStr, funder: from },
          `Job #${jobId} funded with ${amountStr} by ${from}`,
          action.block_num
        );
      }
    } else if (memo.startsWith('buy:')) {
      // Service purchase: memo = "buy:SERVICE_ID" — creates a funded job
      handleServicePurchase(db, action, escrowContract, from, amountStr, dispatcher);
    } else if (memo.startsWith('boost:')) {
      // Featured placement: memo = "boost:SERVICE_ID"
      handleServiceBoost(db, action, escrowContract, from, amount, amountStr, dispatcher);
    } else if (memo.startsWith('svcfee:')) {
      // Listing-fee deposit: memo = "svcfee:AGENT". The deposit lives in the
      // contract's svcdeposits table and is consumed by the next listsvc, so
      // there is no mirror state to change — record the event and move on.
      handleServiceFeeDeposit(db, action, escrowContract, from, amount, amountStr);
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
