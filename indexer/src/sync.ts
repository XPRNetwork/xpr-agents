/**
 * Chain Sync — Seeds the indexer database from on-chain table state.
 *
 * Runs on first start (empty database) to ensure IDs match the chain.
 * Queries all contract tables via RPC and inserts records with their
 * real on-chain IDs, preventing the synthetic ID drift problem.
 */

import Database from 'better-sqlite3';

interface Contracts {
  agentcore: string;
  agentfeed: string;
  agentvalid: string;
  agentescrow: string;
}

async function fetchAllRows(rpc: string, code: string, table: string, scope?: string): Promise<any[]> {
  const rows: any[] = [];
  let lowerBound = '';
  const fetchScope = scope || code;

  while (true) {
    const res = await fetch(`${rpc}/v1/chain/get_table_rows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        table,
        scope: fetchScope,
        json: true,
        limit: 100,
        lower_bound: lowerBound || undefined,
      }),
    });

    const data = await res.json() as { rows: any[]; more: boolean; next_key: string };
    if (!data.rows || data.rows.length === 0) break;

    rows.push(...data.rows);

    if (!data.more) break;
    lowerBound = data.next_key;
  }

  return rows;
}

export async function syncFromChain(
  db: Database.Database,
  rpcEndpoint: string,
  contracts: Contracts,
): Promise<void> {
  const rpc = rpcEndpoint;

  // ── Agents ────────────────────────────────────────
  const agents = await fetchAllRows(rpc, contracts.agentcore, 'agents');
  if (agents.length > 0) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO agents (account, owner, pending_owner, name, description, endpoint, protocol, capabilities, total_jobs, registered_at, active, claim_deposit, deposit_payer)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const a of agents) {
      stmt.run(
        a.account, a.owner || '', a.pending_owner || '',
        a.name || '', a.description || '', a.endpoint || '',
        a.protocol || '', a.capabilities || '[]',
        a.total_jobs || 0, a.registered_at || 0,
        a.active ? 1 : 0, a.claim_deposit || 0, a.deposit_payer || ''
      );
    }
    console.log(`[sync] Agents: ${agents.length}`);
  }

  // ── Agent Scores ──────────────────────────────────
  const scores = await fetchAllRows(rpc, contracts.agentfeed, 'agentscores');
  if (scores.length > 0) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO agent_scores (agent, total_score, total_weight, feedback_count, avg_score, last_updated)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const s of scores) {
      stmt.run(s.agent, s.total_score || 0, s.total_weight || 0, s.feedback_count || 0, s.avg_score || 0, s.last_updated || 0);
    }
    console.log(`[sync] Agent scores: ${scores.length}`);
  }

  // ── Feedback ──────────────────────────────────────
  const feedback = await fetchAllRows(rpc, contracts.agentfeed, 'feedback');
  if (feedback.length > 0) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO feedback (id, agent, reviewer, reviewer_kyc_level, score, tags, job_hash, evidence_uri, amount_paid, timestamp, disputed, resolved)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
    `);
    for (const f of feedback) {
      stmt.run(
        f.id, f.agent, f.reviewer, f.reviewer_kyc_level || 0,
        f.score, f.tags || '', f.job_hash || '', f.evidence_uri || '',
        f.amount_paid || 0, f.timestamp || 0
      );
    }
    console.log(`[sync] Feedback: ${feedback.length}`);
  }

  // ── Validators ────────────────────────────────────
  const validators = await fetchAllRows(rpc, contracts.agentvalid, 'validators');
  if (validators.length > 0) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO validators (account, stake, method, specializations, total_validations, incorrect_validations, accuracy_score, pending_challenges, registered_at, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const v of validators) {
      stmt.run(
        v.account, v.stake || 0, v.method || '', v.specializations || '[]',
        v.total_validations || 0, v.incorrect_validations || 0,
        v.accuracy_score || 10000, v.pending_challenges || 0,
        v.registered_at || 0, v.active ? 1 : 0
      );
    }
    console.log(`[sync] Validators: ${validators.length}`);
  }

  // ── Validations ───────────────────────────────────
  const validations = await fetchAllRows(rpc, contracts.agentvalid, 'validations');
  if (validations.length > 0) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO validations (id, validator, agent, job_hash, result, confidence, evidence_uri, challenged, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const v of validations) {
      stmt.run(
        v.id, v.validator, v.agent, v.job_hash || '',
        v.result, v.confidence, v.evidence_uri || '',
        v.challenged ? 1 : 0, v.timestamp || 0
      );
    }
    console.log(`[sync] Validations: ${validations.length}`);
  }

  // ── Challenges ────────────────────────────────────
  const challenges = await fetchAllRows(rpc, contracts.agentvalid, 'challenges');
  if (challenges.length > 0) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO validation_challenges (id, validation_id, challenger, reason, evidence_uri, stake, funding_deadline, status, created_at, resolved_at, resolver, resolution_notes, funded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of challenges) {
      stmt.run(
        c.id, c.validation_id, c.challenger || '', c.reason || '',
        c.evidence_uri || '', c.stake || 0, c.funding_deadline || 0,
        c.status || 0, c.created_at || 0, c.resolved_at || 0,
        c.resolver || '', c.resolution_notes || '', c.funded_at || 0
      );
    }
    console.log(`[sync] Challenges: ${challenges.length}`);
  }

  // ── Jobs ──────────────────────────────────────────
  const jobs = await fetchAllRows(rpc, contracts.agentescrow, 'jobs');
  if (jobs.length > 0) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO jobs (id, client, agent, title, description, deliverables, amount, symbol, funded_amount, released_amount, state, deadline, arbitrator, job_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const j of jobs) {
      stmt.run(
        j.id, j.client, j.agent || '', j.title || '', j.description || '',
        j.deliverables || '[]', j.amount || 0, j.symbol || 'XPR',
        j.funded_amount || 0, j.released_amount || 0, j.state || 0,
        j.deadline || 0, j.arbitrator || '', j.job_hash || '',
        j.created_at || 0, j.updated_at || 0
      );
    }
    console.log(`[sync] Jobs: ${jobs.length}`);
  }

  // ── Bids ──────────────────────────────────────────
  const bids = await fetchAllRows(rpc, contracts.agentescrow, 'bids');
  if (bids.length > 0) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO bids (id, job_id, agent, amount, timeline, proposal, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const b of bids) {
      stmt.run(b.id, b.job_id, b.agent, b.amount || 0, b.timeline || 0, b.proposal || '', b.created_at || 0);
    }
    console.log(`[sync] Bids: ${bids.length}`);
  }

  // ── Milestones ────────────────────────────────────
  const milestones = await fetchAllRows(rpc, contracts.agentescrow, 'milestones');
  if (milestones.length > 0) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO milestones (id, job_id, title, description, amount, milestone_order, state, evidence_uri)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const m of milestones) {
      stmt.run(
        m.id, m.job_id, m.title || '', m.description || '',
        m.amount || 0, m.order || 0, m.state || 0, m.evidence_uri || ''
      );
    }
    console.log(`[sync] Milestones: ${milestones.length}`);
  }

  // ── Disputes ──────────────────────────────────────
  const disputes = await fetchAllRows(rpc, contracts.agentescrow, 'disputes');
  if (disputes.length > 0) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO escrow_disputes (id, job_id, raised_by, reason, evidence_uri, resolution, created_at, resolved_at, resolver, resolution_notes, client_amount, agent_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const d of disputes) {
      stmt.run(
        d.id, d.job_id, d.raised_by || '', d.reason || '',
        d.evidence_uri || '', d.resolution || 0, d.created_at || 0,
        d.resolved_at || 0, d.resolver || '', d.resolution_notes || '',
        d.client_amount || 0, d.agent_amount || 0
      );
    }
    console.log(`[sync] Disputes: ${disputes.length}`);
  }

  // ── Arbitrators ───────────────────────────────────
  const arbitrators = await fetchAllRows(rpc, contracts.agentescrow, 'arbitrators');
  if (arbitrators.length > 0) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO arbitrators (account, stake, fee_percent, total_cases, successful_cases, active, active_disputes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const a of arbitrators) {
      stmt.run(
        a.account, a.stake || 0, a.fee_percent || 0,
        a.total_cases || 0, a.successful_cases || 0,
        a.active ? 1 : 0, a.active_disputes || 0
      );
    }
    console.log(`[sync] Arbitrators: ${arbitrators.length}`);
  }

  // ── Plugins ───────────────────────────────────────
  const plugins = await fetchAllRows(rpc, contracts.agentcore, 'plugins');
  if (plugins.length > 0) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO plugins (id, name, version, contract, action, schema, category, author, verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const p of plugins) {
      stmt.run(
        p.id, p.name || '', p.version || '', p.contract || '',
        p.action || '', p.schema || '{}', p.category || '',
        p.author || '', p.verified ? 1 : 0
      );
    }
    console.log(`[sync] Plugins: ${plugins.length}`);
  }

  console.log('[sync] All tables seeded from chain state');
}
