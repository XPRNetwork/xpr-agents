import Database from 'better-sqlite3';
import { StreamAction } from '../stream';
import { updateStats } from '../db/schema';
import { WebhookDispatcher } from '../webhooks/dispatcher';

/**
 * Handle escrow contract actions
 */
export function handleEscrowAction(db: Database.Database, action: StreamAction, dispatcher?: WebhookDispatcher): void {
  const { name, data } = action.act;

  switch (name) {
    case 'createjob':
      handleCreateJob(db, data, action.timestamp);
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
      handleDispute(db, data, action.timestamp);
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
      handleAddMilestone(db, data);
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
      handleSubmitBid(db, data, action.timestamp);
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
    case 'selectbid':
      handleSelectBid(db, data);
      if (dispatcher) {
        const selectedBid = db.prepare('SELECT agent, job_id FROM bids WHERE id = ?').get(data.bid_id) as { agent: string; job_id: number } | undefined;
        dispatcher.dispatch(
          'bid.selected',
          selectedBid ? [data.client, selectedBid.agent] : [data.client],
          { ...data, agent: selectedBid?.agent, job_id: selectedBid?.job_id },
          `Bid #${data.bid_id} selected for job #${selectedBid?.job_id || '?'} — agent ${selectedBid?.agent || '?'} assigned`,
          action.block_num
        );
      }
      break;
    case 'withdrawbid':
      handleWithdrawBid(db, data);
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

  // Increment active_disputes on the arbitrator
  const job = db.prepare('SELECT arbitrator FROM jobs WHERE id = ?').get(data.job_id) as { arbitrator: string } | undefined;
  if (job && job.arbitrator) {
    db.prepare('UPDATE arbitrators SET active_disputes = active_disputes + 1 WHERE account = ?').run(job.arbitrator);
  }

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
  const countStmt = db.prepare('SELECT MAX(id) as max_id FROM bids');
  const result = countStmt.get() as { max_id: number | null };
  const id = (result.max_id || 0) + 1;

  const stmt = db.prepare(`
    INSERT INTO bids (id, job_id, agent, amount, timeline, proposal, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id,
    data.job_id,
    data.agent,
    data.amount || 0,
    data.timeline || 0,
    data.proposal || '',
    createdAt
  );
  console.log(`Bid ${id} submitted on job ${data.job_id} by ${data.agent}`);
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

    // Delete all bids for this job (contract cleans them up)
    db.prepare('DELETE FROM bids WHERE job_id = ?').run(bid.job_id);

    console.log(`Bid ${data.bid_id} selected: agent ${bid.agent} assigned to job ${bid.job_id}`);
  } else {
    console.log(`Bid ${data.bid_id} selected but bid not found in indexer`);
  }
}

function handleWithdrawBid(db: Database.Database, data: any): void {
  db.prepare('DELETE FROM bids WHERE id = ?').run(data.bid_id);
  console.log(`Bid ${data.bid_id} withdrawn by ${data.agent}`);
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
