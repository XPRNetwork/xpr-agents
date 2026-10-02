/**
 * Central XPR transfer cap, enforced at the signing layer.
 *
 * Every signed transaction — core plugin tools (createCliSession) and every bundled
 * or external skill (createCliApi) — passes through assertTransferCap before it is
 * handed to the proton CLI. Individual tools can no longer forget the cap: the
 * total XPR the agent spends in one transaction (eosio.token::transfer and eosio::buyram)
 * is summed and refused if it exceeds the limit. Account and action names are compared in
 * canonical form, so trailing-dot aliases such as "eosio.token." are counted.
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

/**
 * Parse an XPR quantity into smallest units; null for other symbols. The space before the
 * symbol is optional because the serializer accepts "20.0000XPR". XPR must carry exactly
 * 4 decimals; anything else is refused rather than guessed at.
 */
function xprUnits(quantity: unknown): number | null {
  if (typeof quantity !== 'string') return null;
  const m = quantity.trim().match(/^(\d+)(?:\.(\d+))?\s*([A-Z]{1,7})$/);
  if (!m || m[3] !== 'XPR') return null;
  if ((m[2] ?? '').length !== XPR_DECIMALS) {
    throw new Error(`Refusing XPR quantity "${quantity}": XPR amounts need exactly ${XPR_DECIMALS} decimals`);
  }
  return Number(m[1]) * 10 ** XPR_DECIMALS + Number(m[2]);
}

/**
 * Canonical form of an EOSIO name. Trailing dots encode as zero bits, so "eosio.token." and
 * "eosio.token" are the same account on chain; compare names only in this form.
 */
export function canonicalName(name: unknown): string {
  return typeof name === 'string' ? name.trim().replace(/\.+$/, '') : '';
}

/** Parse an XPR quantity, refusing an XPR-looking value we cannot read. */
function cappedUnits(quantity: unknown, what: string): number {
  const units = xprUnits(quantity);
  if (units !== null) return units;
  // XPR as the symbol itself (not a longer symbol such as LXPR), with or without a space
  if (typeof quantity === 'string' && /(^|[^A-Z])XPR([^A-Z]|$)/.test(quantity.trim())) {
    // An XPR-looking quantity we cannot parse must not slip past the cap.
    throw new Error(`Refusing ${what}: could not parse XPR quantity "${quantity}"`);
  }
  return 0;
}

/**
 * Total XPR (smallest units) the account spends in these actions: eosio.token::transfer sent
 * from it, plus RAM it buys with XPR (eosio::buyram paid by it).
 */
export function totalXprSent(actions: CappableAction[], account: string): number {
  const self = canonicalName(account);
  let total = 0;
  for (const a of actions) {
    const contract = canonicalName(a.account);
    const action = canonicalName(a.name);
    if (contract === 'eosio.token' && action === 'transfer') {
      const d = (a.data ?? {}) as { from?: unknown; quantity?: unknown };
      if (canonicalName(d.from) !== self) continue;
      total += cappedUnits(d.quantity, 'transfer');
    } else if (contract === 'eosio' && action === 'buyram') {
      const d = (a.data ?? {}) as { payer?: unknown; quant?: unknown };
      if (canonicalName(d.payer) !== self) continue;
      total += cappedUnits(d.quant, 'RAM purchase');
    } else if (contract === 'eosio' && action === 'buyrambytes') {
      // The XPR cost is not in the action, so it cannot be checked against the cap
      const d = (a.data ?? {}) as { payer?: unknown };
      if (canonicalName(d.payer) === self) {
        throw new Error('Refusing eosio::buyrambytes: its XPR cost cannot be checked against the transfer cap; use buyram with an XPR amount');
      }
    }
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
