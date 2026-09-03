/**
 * Queries behind GET /api/jobs/:id/messages.
 *
 * Kept out of routes.ts so the thread ordering can be unit-tested against a
 * real database without an HTTP harness (same split as services-query.ts).
 */

import Database from 'better-sqlite3';

export interface JobMessageRow {
  id: number;
  job_id: number;
  author: string;
  text: string;
  created_at: number;
}

/** True when the job exists in the mirror (used for the 404 on the route). */
export function jobExists(db: Database.Database, jobId: number): boolean {
  return !!db.prepare('SELECT 1 FROM jobs WHERE id = ? AND id >= 0').get(jobId);
}

/**
 * One job's question/answer thread, oldest first. IDs are chain IDs (or the
 * synthetic stand-ins before correction), so `id ASC` is the order the
 * messages were written in.
 */
export function queryJobMessages(db: Database.Database, jobId: number): JobMessageRow[] {
  return db
    .prepare('SELECT id, job_id, author, text, created_at FROM job_messages WHERE id >= 0 AND job_id = ? ORDER BY id ASC')
    .all(jobId) as JobMessageRow[];
}

/** Number of messages on a job — cheap enough to embed in the job payload. */
export function jobMessageCount(db: Database.Database, jobId: number): number {
  const { c } = db
    .prepare('SELECT COUNT(*) AS c FROM job_messages WHERE id >= 0 AND job_id = ?')
    .get(jobId) as { c: number };
  return c;
}
