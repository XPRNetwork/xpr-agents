/**
 * Input validation helpers for OpenClaw tool parameters.
 * Reuses patterns from the SDK's utils.ts.
 */

export function validateAccountName(name: string, field: string = 'account'): void {
  if (!name || typeof name !== 'string') {
    throw new Error(`${field} is required`);
  }
  if (name.length > 12) {
    throw new Error(`${field} must be 12 characters or fewer`);
  }
  if (!/^[a-z1-5.]+$/.test(name)) {
    throw new Error(`${field} must contain only a-z, 1-5, and '.'`);
  }
}

export function validateScore(score: number): void {
  if (typeof score !== 'number' || !Number.isInteger(score)) {
    throw new Error('score must be an integer');
  }
  if (score < 1 || score > 5) {
    throw new Error('score must be between 1 and 5');
  }
}

export function validateConfidence(confidence: number): void {
  if (typeof confidence !== 'number' || !Number.isInteger(confidence)) {
    throw new Error('confidence must be an integer');
  }
  if (confidence < 0 || confidence > 100) {
    throw new Error('confidence must be between 0 and 100');
  }
}

export function validateUrl(url: string, field: string = 'url'): void {
  if (!url || typeof url !== 'string') {
    throw new Error(`${field} is required`);
  }
  try {
    new URL(url);
  } catch {
    throw new Error(`${field} must be a valid URL`);
  }
}

export function validateAmount(amount: number, maxAmount: number): void {
  if (typeof amount !== 'number' || amount <= 0) {
    throw new Error('amount must be a positive number');
  }
  if (amount > maxAmount) {
    throw new Error(`amount exceeds maximum allowed (${maxAmount / 10000} XPR)`);
  }
}

export function validatePositiveInt(value: number, field: string): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
}

export function validateRequired(value: unknown, field: string): void {
  if (value === undefined || value === null || value === '') {
    throw new Error(`${field} is required`);
  }
}

export function validateValidationResult(result: string): void {
  if (!['fail', 'pass', 'partial'].includes(result)) {
    throw new Error("result must be 'fail', 'pass', or 'partial'");
  }
}

export function validateClientPercent(percent: number): void {
  if (typeof percent !== 'number' || !Number.isInteger(percent)) {
    throw new Error('client_percent must be an integer');
  }
  if (percent < 0 || percent > 100) {
    throw new Error('client_percent must be between 0 and 100');
  }
}

/**
 * Convert a human-readable XPR amount to smallest units using integer math.
 * Avoids floating-point precision issues (e.g., 0.7 * 10000 = 6999).
 */
export function xprToSmallestUnits(amount: number): number {
  const str = amount.toFixed(4);
  const [whole, frac = ''] = str.split('.');
  const paddedFrac = frac.padEnd(4, '0').slice(0, 4);
  return parseInt(whole, 10) * 10000 + parseInt(paddedFrac, 10);
}
