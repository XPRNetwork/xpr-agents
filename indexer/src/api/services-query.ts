/**
 * Catalogue queries behind GET /api/services and GET /api/services/:id.
 *
 * Kept out of routes.ts so the ranking rules (featured placement, organic
 * sort) can be unit-tested against a real database without an HTTP harness.
 */

import Database from 'better-sqlite3';

/** Max featured listings that occupy the top of the catalogue. */
export const FEATURED_SLOTS = 3;

/** Max rows one page may return. */
export const MAX_LIMIT = 200;
export const DEFAULT_LIMIT = 24;

export type ServiceSort = 'sales' | 'newest' | 'price';

export interface ServiceQueryOptions {
  category?: string;
  agent?: string;
  /** 'true' (default) = live catalogue only; anything else includes delisted rows. */
  active?: string;
  sort?: string;
  limit?: number;
  offset?: number;
  /** Unix seconds used to decide whether a boost is still running (defaults to now). */
  now?: number;
}

export interface ServiceListResult {
  services: Record<string, unknown>[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * A listing plus the seller's trust signals, so a catalogue card needs one
 * request. Mirrors the /agents joins (agent_scores for rating, a jobs
 * subquery for completed work). `featured` is 1 while the boost is running.
 */
const SERVICE_SELECT = `
  SELECT s.*,
         COALESCE(a.trust_score, 0) AS trust_score,
         COALESCE(sc.avg_score, 0) AS avg_score,
         COALESCE(sc.feedback_count, 0) AS feedback_count,
         COALESCE(cj.completed_jobs, 0) AS completed_jobs,
         CASE WHEN COALESCE(s.featured_until, 0) > @now THEN 1 ELSE 0 END AS featured
  FROM services s
  LEFT JOIN agents a ON a.account = s.agent
  LEFT JOIN agent_scores sc ON sc.agent = s.agent
  LEFT JOIN (
    SELECT agent, COUNT(*) AS completed_jobs
    FROM jobs WHERE state IN (6, 8) GROUP BY agent
  ) cj ON cj.agent = s.agent
`;

const SORT_MAP: Record<string, string> = {
  sales: 's_sales DESC, s_created_at DESC',
  newest: 's_created_at DESC',
  price: 's_price ASC',
};

/**
 * List the catalogue.
 *
 * Ranking: at most FEATURED_SLOTS listings whose boost is still running come
 * first, ordered by boost_paid DESC; everything else — including any further
 * boosted listings — follows in the organic order chosen by `sort`. The
 * ranking is part of the SQL so it survives limit/offset paging.
 */
export function queryServices(db: Database.Database, opts: ServiceQueryOptions = {}): ServiceListResult {
  const limit = Math.min(Math.max(opts.limit || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(opts.offset || 0, 0);
  const now = opts.now ?? Math.floor(Date.now() / 1000);

  const params: Record<string, unknown> = { now, limit, offset };
  let where = ' WHERE 1=1';

  // Default is the live catalogue. Anything else ("false", "all") drops the
  // filter so a seller dashboard can list its delisted rows too.
  if ((opts.active ?? 'true') === 'true') {
    where += ' AND s.active = 1';
  }
  if (opts.category) {
    where += ' AND s.category = @category';
    params.category = opts.category;
  }
  if (opts.agent) {
    where += ' AND s.agent = @agent';
    params.agent = opts.agent;
  }

  const organic = SORT_MAP[String(opts.sort)] || SORT_MAP.sales;

  const { c: total } = db
    .prepare(`SELECT COUNT(*) AS c FROM services s${where}`)
    .get(params) as { c: number };

  // Aliased copies of the sort columns survive the CTE unambiguously.
  const rows = db
    .prepare(`
      WITH base AS (
        ${SERVICE_SELECT}${where}
      ),
      ranked AS (
        SELECT b.*,
               b.sales AS s_sales,
               b.created_at AS s_created_at,
               b.price AS s_price,
               CASE WHEN b.featured = 1
                    THEN ROW_NUMBER() OVER (PARTITION BY b.featured ORDER BY b.boost_paid DESC, b.id ASC)
                    ELSE 0 END AS featured_rank
        FROM base b
      )
      SELECT * FROM ranked
      ORDER BY CASE WHEN featured = 1 AND featured_rank <= ${FEATURED_SLOTS} THEN 0 ELSE 1 END ASC,
               CASE WHEN featured = 1 AND featured_rank <= ${FEATURED_SLOTS} THEN featured_rank ELSE 0 END ASC,
               ${organic},
               id ASC
      LIMIT @limit OFFSET @offset
    `)
    .all(params) as Record<string, unknown>[];

  // Ranking scaffolding stays out of the response, except the slot a listing
  // occupies (1..FEATURED_SLOTS) so the UI only badges listings that actually
  // sit in a featured position; a 4th running boost is featured=1, slot 0.
  const services = rows.map((row) => {
    const { featured_rank, s_sales, s_created_at, s_price, ...rest } = row as any;
    const slot = row.featured === 1 && featured_rank >= 1 && featured_rank <= FEATURED_SLOTS ? featured_rank : 0;
    return { ...rest, featured_slot: slot } as Record<string, unknown>;
  });

  return { services, total, limit, offset };
}

/** One listing, same row shape as the list endpoint (delisted rows included). */
export function queryService(
  db: Database.Database,
  id: number,
  now: number = Math.floor(Date.now() / 1000),
): Record<string, unknown> | undefined {
  const row = db.prepare(`${SERVICE_SELECT} WHERE s.id = @id`).get({ id, now }) as
    | Record<string, unknown>
    | undefined;
  if (!row) return undefined;
  // Same slot rule as the list: position among all active running boosts,
  // 0 when the boost is running but outside the FEATURED_SLOTS top spots.
  let slot = 0;
  if (row.featured === 1) {
    const top = db
      .prepare(
        `SELECT id FROM services WHERE active = 1 AND COALESCE(featured_until, 0) > @now
         ORDER BY boost_paid DESC, id ASC LIMIT ${FEATURED_SLOTS}`,
      )
      .all({ now }) as Array<{ id: number }>;
    const idx = top.findIndex((t) => t.id === id);
    slot = idx >= 0 ? idx + 1 : 0;
  }
  return { ...row, featured_slot: slot };
}
