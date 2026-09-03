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
  /**
   * Columns that identify the same logical record independently of its id.
   * Used to spot a displaced row whose real record already sits at a positive
   * id — that displaced copy is a duplicate and gets deleted, not moved.
   */
  naturalKey?: string[];
  /**
   * SQL expression yielding the row's age anchor (unix seconds), used by the
   * stale-temp-row sweep. 0 (or a missing timestamp) counts as "old".
   */
  ageExpr?: string;
}

/* ------------------------------------------------------------------ */
/*  Correction topology for the escrow tables                           */
/* ------------------------------------------------------------------ */

export const JOBS_SPEC: RetargetSpec = {
  primaryTable: 'jobs',
  fkRefs: [
    { table: 'bids', col: 'job_id' },
    { table: 'milestones', col: 'job_id' },
    { table: 'escrow_disputes', col: 'job_id' },
    { table: 'job_evidence', col: 'job_id' },
    { table: 'job_messages', col: 'job_id' },
  ],
  naturalKey: ['client', 'title', 'created_at'],
  ageExpr: 'COALESCE(NULLIF(updated_at, 0), created_at, 0)',
};

export const BIDS_SPEC: RetargetSpec = {
  primaryTable: 'bids',
  fkRefs: [],
  naturalKey: ['job_id', 'agent'],
  ageExpr: 'COALESCE(created_at, 0)',
};

/** Services are referenced by jobs only through job_hash = 'svc:<id>' (a string), never by FK column. */
export const SERVICES_SPEC: RetargetSpec = {
  primaryTable: 'services',
  fkRefs: [{ table: 'service_inputs', col: 'service_id' }],
  naturalKey: ['agent', 'title'],
  ageExpr: 'COALESCE(NULLIF(updated_at, 0), created_at, 0)',
};

export const MILESTONES_SPEC: RetargetSpec = {
  primaryTable: 'milestones',
  fkRefs: [],
  naturalKey: ['job_id', 'title'],
  ageExpr:
    'COALESCE(NULLIF(submitted_at, 0), NULLIF(approved_at, 0), ' +
    '(SELECT COALESCE(NULLIF(j.updated_at, 0), j.created_at, 0) FROM jobs j WHERE j.id = milestones.job_id), 0)',
};

export const DISPUTES_SPEC: RetargetSpec = {
  primaryTable: 'escrow_disputes',
  fkRefs: [],
  naturalKey: ['job_id', 'raised_by', 'created_at'],
  ageExpr: 'COALESCE(created_at, 0)',
};

export const JOB_MESSAGES_SPEC: RetargetSpec = {
  primaryTable: 'job_messages',
  fkRefs: [],
  naturalKey: ['job_id', 'author', 'text'],
  ageExpr: 'COALESCE(created_at, 0)',
};

/** Every table whose rows can hold a negative displacement id. */
export const CORRECTED_SPECS: RetargetSpec[] = [
  JOBS_SPEC,
  BIDS_SPEC,
  MILESTONES_SPEC,
  DISPUTES_SPEC,
  SERVICES_SPEC,
  JOB_MESSAGES_SPEC,
];

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

/* ------------------------------------------------------------------ */
/*  Displaced-row cleanup                                              */
/* ------------------------------------------------------------------ */

/** Delete a row and everything referencing it, in one transaction. */
export function deleteRowCascade(db: Database, spec: RetargetSpec, id: number): void {
  const idCol = spec.primaryIdCol || 'id';
  db.transaction(() => {
    for (const fk of spec.fkRefs) {
      db.prepare(`DELETE FROM ${fk.table} WHERE ${fk.col} = ?`).run(id);
    }
    db.prepare(`DELETE FROM ${spec.primaryTable} WHERE ${idCol} = ?`).run(id);
  })();
}

/**
 * Is the displaced row a duplicate of a record that already sits at a real
 * (non-negative) id? Compared on the spec's natural key — for jobs that is
 * client + title + created_at, i.e. the same fields the handlers use to spot
 * an already-seeded record.
 */
function hasRealTwin(db: Database, spec: RetargetSpec, displacedId: number): boolean {
  const idCol = spec.primaryIdCol || 'id';
  const key = spec.naturalKey;
  if (!key || key.length === 0) return false;

  const row = db
    .prepare(`SELECT * FROM ${spec.primaryTable} WHERE ${idCol} = ?`)
    .get(displacedId) as Record<string, unknown> | undefined;
  if (!row) return false;

  const where = key.map((col) => `${col} IS ?`).join(' AND ');
  const twin = db
    .prepare(`SELECT ${idCol} FROM ${spec.primaryTable} WHERE ${idCol} >= 0 AND ${where} LIMIT 1`)
    .get(...key.map((col) => row[col] ?? null)) as Record<string, unknown> | undefined;

  return !!twin;
}

/**
 * Finish a displaced row's re-correction.
 *
 * `safeCorrect` parks the previous occupier of a slot at a negative id and
 * leaves the caller to schedule its own lookup. When that lookup comes back
 * empty — the row never existed on chain, or the chain row it mirrored is
 * already indexed at its real id — the displaced copy is a stale duplicate
 * (this is how job id -62504464 survived on mainnet). Delete it instead of
 * leaving it to surface in list endpoints.
 *
 * Returns what happened: 'moved', 'deleted' or 'noop' (row already gone).
 */
export function resolveDisplacedRow(
  db: Database,
  spec: RetargetSpec,
  displacedId: number,
  realId: number | null,
): 'moved' | 'deleted' | 'noop' {
  const idCol = spec.primaryIdCol || 'id';
  const exists = db
    .prepare(`SELECT 1 FROM ${spec.primaryTable} WHERE ${idCol} = ?`)
    .get(displacedId);
  if (!exists) return 'noop';

  if (realId === displacedId) return 'noop';

  if (realId == null) {
    deleteRowCascade(db, spec, displacedId);
    console.log(
      `[id-correction] Deleted displaced ${spec.primaryTable} id=${displacedId} — no on-chain row to move it to`,
    );
    return 'deleted';
  }

  if (hasRealTwin(db, spec, displacedId)) {
    deleteRowCascade(db, spec, displacedId);
    console.log(
      `[id-correction] Deleted displaced ${spec.primaryTable} id=${displacedId} — ` +
      `the same record already exists at a real id`,
    );
    return 'deleted';
  }

  safeCorrect(db, spec, displacedId, realId);
  return 'moved';
}

/** Per-table delete counts from a stale-temp-row sweep. */
export interface TempRowSweep {
  deleted: Record<string, number>;
  total: number;
}

/**
 * Remove displacement leftovers: rows still parked at a negative id whose
 * anchor timestamp is older than `maxAgeSec` (default 10 minutes). Corrections
 * complete within one flush, so anything older than that is abandoned.
 *
 * Runs at startup and on demand via POST /api/admin/prune-temp-rows.
 */
export function pruneStaleTempRows(db: Database, maxAgeSec = 600): TempRowSweep {
  const cutoff = Math.floor(Date.now() / 1000) - maxAgeSec;
  const deleted: Record<string, number> = {};
  let total = 0;

  for (const spec of CORRECTED_SPECS) {
    const idCol = spec.primaryIdCol || 'id';
    const ageExpr = spec.ageExpr || '0';

    let stale: Array<Record<string, unknown>>;
    try {
      stale = db
        .prepare(`SELECT * FROM ${spec.primaryTable} WHERE ${idCol} < 0 AND ${ageExpr} < ?`)
        .all(cutoff) as Array<Record<string, unknown>>;
    } catch (err) {
      // A table this build doesn't have (older database) is simply skipped.
      console.warn(`[id-correction] Sweep skipped ${spec.primaryTable}:`, err);
      continue;
    }

    for (const row of stale) {
      const id = Number(row[idCol]);
      deleteRowCascade(db, spec, id);
      const label = spec.naturalKey
        ? spec.naturalKey.map((col) => `${col}=${String(row[col] ?? '')}`).join(' ')
        : '';
      console.log(`[id-correction] Swept stale temp row ${spec.primaryTable} id=${id} ${label}`.trimEnd());
    }

    if (stale.length > 0) {
      deleted[spec.primaryTable] = stale.length;
      total += stale.length;
    }
  }

  if (total > 0) {
    console.log(`[id-correction] Stale temp-row sweep removed ${total} row(s)`);
  }

  return { deleted, total };
}
