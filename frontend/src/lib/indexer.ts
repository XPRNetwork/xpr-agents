import { getSelectedNetwork } from './networks';

/**
 * Indexer API client with automatic fallback to RPC.
 * Tries the indexer first (fast, cached, paginated), falls back to
 * direct RPC table reads if the indexer is down or slow.
 */

const INDEXER_URLS: Record<string, string> = {
  mainnet: 'https://indexer.xpragents.com',
  testnet: 'https://testnet-indexer.xpragents.com',
};

const INDEXER_TIMEOUT_MS = 4000;

let indexerHealthy = true;
let lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL = 60000; // re-check every 60s after failure

function getIndexerUrl(): string {
  const network = getSelectedNetwork();
  return INDEXER_URLS[network] || INDEXER_URLS.mainnet;
}

/**
 * Fetch from the indexer API. Returns null if indexer is down/slow,
 * allowing the caller to fall back to RPC.
 */
export async function indexerFetch<T>(path: string): Promise<T | null> {
  // Skip indexer if it was recently unhealthy
  if (!indexerHealthy) {
    const now = Date.now();
    if (now - lastHealthCheck < HEALTH_CHECK_INTERVAL) return null;
    lastHealthCheck = now;
  }

  const url = `${getIndexerUrl()}/api${path}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), INDEXER_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      // 404 = resource not found (normal) — don't trip circuit breaker
      // 5xx / other = server issue — trip circuit breaker
      if (res.status >= 500) {
        indexerHealthy = false;
        lastHealthCheck = Date.now();
      }
      return null;
    }

    const data = await res.json();
    indexerHealthy = true;
    return data as T;
  } catch {
    // Connection error or timeout — trip circuit breaker
    indexerHealthy = false;
    lastHealthCheck = Date.now();
    return null;
  }
}

/**
 * Try indexer first, fall back to RPC fetcher if indexer is unavailable.
 */
export async function indexerOrRpc<T>(
  indexerPath: string,
  indexerTransform: (data: any) => T,
  rpcFallback: () => Promise<T>,
): Promise<T> {
  const data = await indexerFetch(indexerPath);
  if (data !== null) {
    try {
      return indexerTransform(data);
    } catch {
      // Transform failed — fall back to RPC
    }
  }
  return rpcFallback();
}
