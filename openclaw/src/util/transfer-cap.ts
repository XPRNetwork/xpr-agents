/**
 * Central XPR transfer cap, enforced at the signing layer.
 *
 * Every signed transaction — core plugin tools (createCliSession) and every bundled
 * or external skill (createCliApi) — passes through assertTransferCap before it is
 * handed to the proton CLI. Individual tools can no longer forget the cap: the
 * total XPR the agent sends via eosio.token::transfer in one transaction is summed
 * and refused if it exceeds the limit.
 *
 * Limit, in order of precedence:
 *   1. an explicit `maxTransferAmount` (smallest units, 4 decimals) passed by the caller
 *   2. MAX_TRANSFER_AMOUNT env (smallest units; the documented setting)
 *   3. MAX_TRANSFER_XPR env (whole XPR; legacy name used by skills before 0.8.4)
 *   4. default 10,000,000 = 1,000 XPR
 *
 * Only XPR is capped (the documented cap is denominated in XPR). Other tokens are
 * not limited here.
 */

export const DEFAULT_MAX_TRANSFER_AMOUNT = 10_000_000; // 1,000.0000 XPR in smallest units

const XPR_DECIMALS = 4;

interface CappableAction {
  account: string;
  name: string;
  data?: unknown;
}

/** Resolve the cap in smallest units (4 decimals). */
export function resolveTransferCap(explicit?: number): number {
  if (explicit !== undefined && Number.isFinite(explicit) && explicit >= 0) return Math.floor(explicit);
  const units = process.env.MAX_TRANSFER_AMOUNT;
  if (units !== undefined && units.trim() !== '') {
    const n = Number(units);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  const legacyXpr = process.env.MAX_TRANSFER_XPR;
  if (legacyXpr !== undefined && legacyXpr.trim() !== '') {
    const n = Number(legacyXpr);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n * 10 ** XPR_DECIMALS);
  }
  return DEFAULT_MAX_TRANSFER_AMOUNT;
}

/** Parse "12.3456 XPR" into smallest units; returns null for other symbols or bad input. */
function xprUnits(quantity: unknown): number | null {
  if (typeof quantity !== 'string') return null;
  const m = quantity.trim().match(/^(\d+)(?:\.(\d+))?\s+([A-Z]{1,7})$/);
  if (!m || m[3] !== 'XPR') return null;
  const whole = Number(m[1]);
  const frac = (m[2] ?? '').padEnd(XPR_DECIMALS, '0').slice(0, XPR_DECIMALS);
  return whole * 10 ** XPR_DECIMALS + Number(frac);
}

/** Total XPR (smallest units) sent by `account` via eosio.token::transfer in these actions. */
export function totalXprSent(actions: CappableAction[], account: string): number {
  let total = 0;
  for (const a of actions) {
    if (a.account !== 'eosio.token' || a.name !== 'transfer') continue;
    const d = (a.data ?? {}) as { from?: unknown; quantity?: unknown };
    if (d.from !== account) continue;
    const units = xprUnits(d.quantity);
    if (units === null) {
      // An XPR-looking quantity we cannot parse must not slip past the cap.
      if (typeof d.quantity === 'string' && /\bXPR\b/.test(d.quantity)) {
        throw new Error(`Refusing transfer: could not parse XPR quantity "${d.quantity}"`);
      }
      continue;
    }
    total += units;
  }
  return total;
}

/** Throw if the transaction would send more XPR than the cap allows. */
export function assertTransferCap(actions: CappableAction[], account: string, maxTransferAmount?: number): void {
  const cap = resolveTransferCap(maxTransferAmount);
  const sent = totalXprSent(actions, account);
  if (sent > cap) {
    const fmt = (u: number) => (u / 10 ** XPR_DECIMALS).toFixed(XPR_DECIMALS);
    throw new Error(
      `Refusing transaction: it sends ${fmt(sent)} XPR, above the transfer cap of ${fmt(cap)} XPR ` +
      `(MAX_TRANSFER_AMOUNT, in smallest units).`,
    );
  }
}
