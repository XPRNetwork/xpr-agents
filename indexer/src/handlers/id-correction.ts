/**
 * Shared utilities for correcting synthetic IDs to real on-chain IDs.
 *
 * The indexer handlers create records with MAX(id)+1 synthetic IDs because
 * contract actions don't include the assigned table primary key. After the
 * synchronous SQLite transaction commits, async RPC lookups fetch the real
 * on-chain ID and correct the record.
 */

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
 * Process all pending ID corrections. Called after the synchronous transaction commits.
 */
export async function flushPendingCorrections(): Promise<void> {
  while (pendingCorrections.length > 0) {
    const correction = pendingCorrections.shift()!;
    await correction();
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
