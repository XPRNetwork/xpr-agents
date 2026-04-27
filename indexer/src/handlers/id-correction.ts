/**
 * Shared utilities for correcting synthetic IDs to real on-chain IDs.
 *
 * Background
 * ----------
 * The indexer handlers create records with MAX(id)+1 synthetic IDs because
 * contract actions (e.g. createjob) don't include the assigned table primary
 * key. After the synchronous SQLite transaction commits, async RPC lookups
 * fetch the real on-chain ID and correct the record.
 *
 * Collision handling
 * ------------------
 * The naive UPDATE jobs SET id = realId WHERE id = tempId can fail with
 * SqliteError: UNIQUE constraint failed when realId is already in use by
 * another (also-mis-IDed) row. To handle this, `safeCorrect` displaces the
 * occupier to a unique negative temp ID first, schedules a re-correction
 * for that row using its own metadata, then moves our row into the now-free
 * slot.
 *
 * Negative IDs are safe transit space because no real on-chain ID is < 0.
 */

import type { Database } from 'better-sqlite3';

let rpcEndpoint: string | null = null;

export function setRpcEndpoint(endpoint: string): void {
  rpcEndpoint = endpoint;
}

export function getRpcEndpoint(): string | null {
  return rpcEndpoint;
}

/** Pending async ID corrections, flushed after each transaction */
export const pendingCorrections: Array<() => Promise<void>> = [];

/**
 * Process all pending ID corrections. Called after the synchronous transaction
 * commits. Each correction is wrapped in try/catch so one failure can't kill
 * the entire batch (previously a single UNIQUE constraint error would silently
 * drop every queued correction after it).
 */
export async function flushPendingCorrections(): Promise<void> {
  while (pendingCorrections.length > 0) {
    const correction = pendingCorrections.shift()!;
    try {
      await correction();
    } catch (err) {
      console.error('[id-correction] correction failed (continuing batch):', err);
    }
  }
}

/**
 * Fetch the real on-chain ID for a record by querying a table in reverse.
 */
export async function fetchOnChainId(
  contract: string,
  table: string,
  matchFn: (row: any) => boolean,
): Promise<number | null> {
  if (!rpcEndpoint) return null;
  try {
    const res = await fetch(`${rpcEndpoint}/v1/chain/get_table_rows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: contract,
        table,
        scope: contract,
        json: true,
        reverse: true,
        limit: 10,
      }),
    });
    const data = await res.json() as { rows: any[] };
    if (!data.rows) return null;
    for (const row of data.rows) {
      if (matchFn(row)) return typeof row.id === 'number' ? row.id : parseInt(row.id);
    }
    return null;
  } catch (err) {
    console.warn(`[id-correction] Failed to fetch on-chain ID from ${contract}::${table}:`, err);
    return null;
  }
}

/**
 * Schema for retargeting an ID across a primary table and any tables that
 * reference it via foreign keys.
 */
export interface RetargetSpec {
  /** Primary table whose row's id is being moved (e.g. 'jobs') */
  primaryTable: string;
  /** Primary key column (almost always 'id') */
  primaryIdCol?: string;
  /** Foreign-key references to update (table + column) */
  fkRefs: Array<{ table: string; col: string }>;
}

/**
 * Move a row's id from `fromId` to `toId`, including all foreign-key references.
 * Caller must ensure the destination slot is free (use `safeCorrect` for collision-safe).
 * Wrapped in a single transaction so partial moves can't leak.
 */
export function moveId(
  db: Database,
  spec: RetargetSpec,
  fromId: number,
  toId: number,
): void {
  const idCol = spec.primaryIdCol || 'id';
  db.transaction(() => {
    for (const fk of spec.fkRefs) {
      db.prepare(`UPDATE ${fk.table} SET ${fk.col} = ? WHERE ${fk.col} = ?`).run(toId, fromId);
    }
    db.prepare(`UPDATE ${spec.primaryTable} SET ${idCol} = ? WHERE ${idCol} = ?`).run(toId, fromId);
  })();
}

/** Counter ensures distinct negative temp IDs even within the same millisecond */
let displacementCounter = 0;

/**
 * Compute a unique negative temp ID for displaced rows. Negative space avoids
 * collision with any real chain ID and any positive synthetic temp ID.
 */
function nextDisplacedId(realId: number): number {
  displacementCounter = (displacementCounter + 1) | 0;
  // Combine current realId, time, and a counter to virtually guarantee uniqueness
  return -(Math.abs(realId) * 1_000_000 + (Date.now() % 1_000_000) + displacementCounter);
}

/**
 * Collision-safe correction: move tempId → realId, displacing any existing
 * record at realId to a negative temp slot. The displaced record's metadata
 * is captured before displacement so the caller can schedule its own
 * re-correction via `onDisplaced`.
 *
 * Returns the displacedId (negative) if a displacement happened, else null.
 *
 * `onDisplaced` is called synchronously with the row's pre-displacement data
 * (already moved to displacedId) so the caller can push a new correction
 * onto pendingCorrections.
 */
export function safeCorrect(
  db: Database,
  spec: RetargetSpec,
  tempId: number,
  realId: number,
  onDisplaced?: (displacedId: number, displacedRow: Record<string, unknown>) => void,
): number | null {
  if (realId === tempId) return null;

  const idCol = spec.primaryIdCol || 'id';
  let displacedId: number | null = null;

  // Capture the current occupier's full row BEFORE we move it, so the caller
  // can use its metadata to schedule a re-correction.
  const occupier = db
    .prepare(`SELECT * FROM ${spec.primaryTable} WHERE ${idCol} = ?`)
    .get(realId) as Record<string, unknown> | undefined;

  if (occupier) {
    displacedId = nextDisplacedId(realId);
    moveId(db, spec, realId, displacedId);
    console.log(
      `[id-correction] Displaced existing ${spec.primaryTable} id=${realId} → ${displacedId} ` +
      `to make room for tempId=${tempId} → ${realId}`,
    );
    if (onDisplaced) onDisplaced(displacedId, { ...occupier, [idCol]: displacedId });
  }

  moveId(db, spec, tempId, realId);
  return displacedId;
}
