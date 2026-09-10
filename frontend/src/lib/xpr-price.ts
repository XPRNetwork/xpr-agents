/**
 * XPR/USD from the on-chain oracle, for showing what a price is actually worth.
 *
 * Listings are denominated in XPR, so "1,789 XPR" tells a buyer who does not hold
 * XPR nothing at all — it happens to be about five dollars. The `oracles` contract
 * publishes an aggregated XPR/USD feed at index 3; this reads it, caches it, and
 * hands every component the same value.
 *
 * The conversion is decoration: escrow moves XPR and only XPR. Everything here
 * fails soft, so a stale or unreachable oracle shows the XPR price alone rather
 * than a zero, a dash, or a shifted layout.
 */
import { useEffect, useState } from 'react';
import { rpc } from './registry';

/** Feed index of XPR/USD in the oracles `data` table. */
const XPR_USD_FEED_INDEX = 3;
const TTL_MS = 10 * 60 * 1000;

let cached: number | null = null;
let fetchedAt = 0;
let inFlight: Promise<number | null> | null = null;
/** Components mounted before the first fetch resolves. */
const subscribers = new Set<(price: number | null) => void>();

async function readOracle(): Promise<number | null> {
  try {
    const result = await rpc.get_table_rows({
      json: true,
      code: 'oracles',
      scope: 'oracles',
      table: 'data',
      lower_bound: XPR_USD_FEED_INDEX,
      upper_bound: XPR_USD_FEED_INDEX + 1,
      limit: 1,
    });
    const raw = result?.rows?.[0]?.aggregate?.d_double;
    const price = typeof raw === 'string' ? parseFloat(raw) : Number(raw);
    // A zero or negative feed is a broken oracle, not a free service.
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

/** The cached XPR/USD price, refreshing at most every TTL. Null when unavailable. */
export function getXprUsdPrice(): Promise<number | null> {
  if (cached !== null && Date.now() - fetchedAt < TTL_MS) return Promise.resolve(cached);
  if (inFlight) return inFlight;
  inFlight = readOracle().then((price) => {
    inFlight = null;
    if (price !== null) {
      cached = price;
      fetchedAt = Date.now();
    }
    for (const notify of subscribers) notify(cached);
    return cached;
  });
  return inFlight;
}

/**
 * XPR/USD for rendering. Returns null until the oracle answers, and stays null if
 * it never does, so callers render the XPR figure on its own.
 */
export function useXprUsdPrice(): number | null {
  const [price, setPrice] = useState<number | null>(cached);

  useEffect(() => {
    let active = true;
    const notify = (p: number | null) => { if (active) setPrice(p); };
    subscribers.add(notify);
    getXprUsdPrice().then(notify);
    return () => { active = false; subscribers.delete(notify); };
  }, []);

  return price;
}

/**
 * Raw XPR units (4 decimals) as an approximate USD string, or null when there is
 * no price or the amount rounds to nothing worth showing.
 *
 * Sub-cent amounts read as "< $0.01" rather than "$0.00", which would look like free.
 */
export function formatUsd(rawAmount: number, price: number | null): string | null {
  if (!price || !Number.isFinite(rawAmount) || rawAmount <= 0) return null;
  const usd = (rawAmount / 10000) * price;
  if (usd < 0.01) return '< $0.01';
  const decimals = usd >= 1000 ? 0 : 2;
  return `$${usd.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}
