// Converts a typed XPR amount to raw units (4 decimals) without floating point,
// so 1.0009 is 10009 and not 10008.
export function parseXprAmount(input: string): number {
  const trimmed = input.trim();
  const value = trimmed.startsWith('.') ? `0${trimmed}` : trimmed; // number inputs allow ".5"
  if (!/^\d+(?:\.\d{1,4})?$/.test(value)) {
    throw new Error('Enter an XPR amount with at most 4 decimal places');
  }
  const [whole, fraction = ''] = value.split('.');
  const raw = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'));
  if (raw > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('XPR amount is too large');
  }
  return Number(raw);
}

export function formatXprAsset(raw: number): string {
  if (!Number.isSafeInteger(raw) || raw < 0) {
    throw new Error('Invalid raw XPR amount');
  }
  const units = BigInt(raw);
  return `${units / 10000n}.${String(units % 10000n).padStart(4, '0')} XPR`;
}
