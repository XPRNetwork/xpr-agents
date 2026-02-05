import Database from 'better-sqlite3';
import { StreamAction } from '../stream';
import { updateStats } from '../db/schema';

export function handleFeedbackAction(db: Database.Database, action: StreamAction): void {
  const { name, data } = action.act;

  switch (name) {
    case 'submit':
      handleSubmit(db, data, action.timestamp);
      break;
    case 'dispute':
      handleDispute(db, data);
      break;
    case 'resolve':
      handleResolve(db, data);
      break;
    case 'recalc':
      handleRecalc(db, data);
      break;
    default:
      console.log(`Unknown agentfeed action: ${name}`);
  }

  // Log event
  logEvent(db, action);

  // Update stats
  updateStats(db);
}

function handleSubmit(db: Database.Database, data: any, timestamp: string): void {
  const feedbackStmt = db.prepare(`
    INSERT INTO feedback (id, agent, reviewer, reviewer_kyc_level, score, tags, job_hash, evidence_uri, amount_paid, timestamp, disputed, resolved)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
  `);

  // Generate ID based on existing count
  const countStmt = db.prepare('SELECT MAX(id) as max_id FROM feedback');
  const result = countStmt.get() as { max_id: number | null };
  const id = (result.max_id || 0) + 1;

  const ts = Math.floor(new Date(timestamp).getTime() / 1000);

  feedbackStmt.run(
    id,
    data.agent,
    data.reviewer,
    data.reviewer_kyc_level || 0,
    data.score,
    data.tags || '',
    data.job_hash || '',
    data.evidence_uri || '',
    data.amount_paid || 0,
    ts
  );

  // Update agent score
  updateAgentScore(db, data.agent);

  console.log(`Feedback submitted: ${data.reviewer} -> ${data.agent} (${data.score}/5)`);
}

function handleDispute(db: Database.Database, data: any): void {
  const stmt = db.prepare(`
    UPDATE feedback
    SET disputed = 1
    WHERE id = ?
  `);

  stmt.run(data.feedback_id);

  console.log(`Feedback disputed: ${data.feedback_id}`);
}

function handleResolve(db: Database.Database, data: any): void {
  const stmt = db.prepare(`
    UPDATE feedback
    SET resolved = 1
    WHERE id = ?
  `);

  stmt.run(data.dispute_id);

  // If dispute was upheld, recalculate agent score
  const feedback = db.prepare('SELECT agent FROM feedback WHERE id = ?').get(data.dispute_id) as { agent: string } | undefined;
  if (feedback) {
    updateAgentScore(db, feedback.agent);
  }

  console.log(`Dispute resolved: ${data.dispute_id}`);
}

function handleRecalc(db: Database.Database, data: any): void {
  updateAgentScore(db, data.agent);
  console.log(`Score recalculated for: ${data.agent}`);
}

function updateAgentScore(db: Database.Database, agent: string): void {
  // Get all valid feedback for agent
  const feedbackStmt = db.prepare(`
    SELECT score, reviewer_kyc_level
    FROM feedback
    WHERE agent = ?
    AND (disputed = 0 OR resolved = 1)
  `);

  const feedbacks = feedbackStmt.all(agent) as Array<{ score: number; reviewer_kyc_level: number }>;

  let totalScore = 0;
  let totalWeight = 0;

  for (const fb of feedbacks) {
    const weight = 1 + fb.reviewer_kyc_level;
    totalScore += fb.score * weight;
    totalWeight += weight * 5; // Normalize to 5-star scale
  }

  const avgScore = totalWeight > 0 ? Math.floor((totalScore * 10000) / totalWeight) : 0;

  const upsertStmt = db.prepare(`
    INSERT INTO agent_scores (agent, total_score, total_weight, feedback_count, avg_score, last_updated)
    VALUES (?, ?, ?, ?, ?, strftime('%s', 'now'))
    ON CONFLICT(agent) DO UPDATE SET
      total_score = excluded.total_score,
      total_weight = excluded.total_weight,
      feedback_count = excluded.feedback_count,
      avg_score = excluded.avg_score,
      last_updated = excluded.last_updated
  `);

  upsertStmt.run(agent, totalScore, totalWeight, feedbacks.length, avgScore);
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
