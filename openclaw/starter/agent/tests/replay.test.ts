import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkReplay, clearAuthCaches } from '../src/a2a-auth';

/**
 * A2A replay protection: the signed payload is (account, timestamp, bodyDigest),
 * so the same signed request could be replayed within the ±timestampWindow. Each
 * accepted signature is remembered until it falls outside the window.
 */
describe('checkReplay', () => {
  beforeEach(() => clearAuthCaches());
  afterEach(() => vi.useRealTimers());

  it('accepts a signature the first time', () => {
    expect(() => checkReplay('SIG_A', 300)).not.toThrow();
  });

  it('rejects the same signature reused within the window', () => {
    checkReplay('SIG_B', 300);
    expect(() => checkReplay('SIG_B', 300)).toThrow(/replay/i);
  });

  it('accepts distinct signatures', () => {
    checkReplay('SIG_C', 300);
    expect(() => checkReplay('SIG_D', 300)).not.toThrow();
  });

  it('accepts reuse once the acceptance window has elapsed', () => {
    vi.useFakeTimers();
    checkReplay('SIG_E', 10); // TTL = 2 * 10s = 20s
    vi.advanceTimersByTime(21_000);
    expect(() => checkReplay('SIG_E', 10)).not.toThrow();
  });
});
