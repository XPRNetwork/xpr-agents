import {
  getTrustRating,
  calculateTrustScore,
  validationResultFromNumber,
  validationResultToNumber,
  disputeStatusFromNumber,
  safeJsonParse,
  parseCapabilities,
  parseSpecializations,
  parseTags,
  formatXpr,
  parseXpr,
  safeParseInt,
  formatTimestamp,
  calculateWeightedAverage,
  isValidAccountName,
  isValidUrl,
  getKycWeight,
} from '../src/utils';
import type { Agent, AgentScore } from '../src/types';

// ============== getTrustRating ==============

describe('getTrustRating', () => {
  it('returns "untrusted" for score 0', () => {
    expect(getTrustRating(0)).toBe('untrusted');
  });

  it('returns "untrusted" for score 19', () => {
    expect(getTrustRating(19)).toBe('untrusted');
  });

  it('returns "low" for score 20', () => {
    expect(getTrustRating(20)).toBe('low');
  });

  it('returns "low" for score 39', () => {
    expect(getTrustRating(39)).toBe('low');
  });

  it('returns "medium" for score 40', () => {
    expect(getTrustRating(40)).toBe('medium');
  });

  it('returns "medium" for score 59', () => {
    expect(getTrustRating(59)).toBe('medium');
  });

  it('returns "high" for score 60', () => {
    expect(getTrustRating(60)).toBe('high');
  });

  it('returns "high" for score 79', () => {
    expect(getTrustRating(79)).toBe('high');
  });

  it('returns "verified" for score 80', () => {
    expect(getTrustRating(80)).toBe('verified');
  });

  it('returns "verified" for score 100', () => {
    expect(getTrustRating(100)).toBe('verified');
  });
});

// ============== calculateTrustScore ==============

describe('calculateTrustScore', () => {
  const now = Math.floor(Date.now() / 1000);

  function makeAgent(overrides: Partial<Agent> = {}): Agent {
    return {
      account: 'testagent',
      owner: 'testowner',
      pending_owner: null,
      name: 'Test Agent',
      description: 'A test agent',
      endpoint: 'https://example.com',
      protocol: 'https',
      capabilities: ['compute'],
      total_jobs: 0,
      registered_at: now,
      active: true,
      claim_deposit: 0,
      deposit_payer: null,
      ...overrides,
    };
  }

  it('gives 0 KYC points for level 0', () => {
    const result = calculateTrustScore(makeAgent(), null, 0, 0);
    expect(result.breakdown.kyc).toBe(0);
  });

  it('gives 10 KYC points for level 1', () => {
    const result = calculateTrustScore(makeAgent(), null, 1, 0);
    expect(result.breakdown.kyc).toBe(10);
  });

  it('gives 30 KYC points for level 3', () => {
    const result = calculateTrustScore(makeAgent(), null, 3, 0);
    expect(result.breakdown.kyc).toBe(30);
  });

  it('caps KYC at 30 points for level 4+', () => {
    const result = calculateTrustScore(makeAgent(), null, 5, 0);
    expect(result.breakdown.kyc).toBe(30);
  });

  it('gives 0 stake points for 0 staked', () => {
    const result = calculateTrustScore(makeAgent(), null, 0, 0);
    expect(result.breakdown.stake).toBe(0);
  });

  it('gives 1 stake point per 500 XPR (5000000 smallest units)', () => {
    const result = calculateTrustScore(makeAgent(), null, 0, 5000000);
    expect(result.breakdown.stake).toBe(1);
  });

  it('caps stake at 20 points', () => {
    const result = calculateTrustScore(makeAgent(), null, 0, 200000000);
    expect(result.breakdown.stake).toBe(20);
  });

  it('gives 0 reputation with no agent score', () => {
    const result = calculateTrustScore(makeAgent(), null, 0, 0);
    expect(result.breakdown.reputation).toBe(0);
  });

  it('gives 40 reputation for perfect avg_score', () => {
    const score: AgentScore = {
      agent: 'testagent',
      total_score: 50000,
      total_weight: 5,
      feedback_count: 5,
      avg_score: 10000,
      last_updated: now,
    };
    const result = calculateTrustScore(makeAgent(), score, 0, 0);
    expect(result.breakdown.reputation).toBe(40);
  });

  it('gives proportional reputation for partial avg_score', () => {
    const score: AgentScore = {
      agent: 'testagent',
      total_score: 25000,
      total_weight: 5,
      feedback_count: 5,
      avg_score: 5000, // 50%
      last_updated: now,
    };
    const result = calculateTrustScore(makeAgent(), score, 0, 0);
    expect(result.breakdown.reputation).toBe(20); // 50% of 40
  });

  it('gives 0 longevity for brand new agent', () => {
    const result = calculateTrustScore(makeAgent({ registered_at: now }), null, 0, 0);
    expect(result.breakdown.longevity).toBe(0);
  });

  it('gives 1 longevity point per month', () => {
    const threeMonthsAgo = now - 3 * 30 * 24 * 60 * 60;
    const result = calculateTrustScore(makeAgent({ registered_at: threeMonthsAgo }), null, 0, 0);
    expect(result.breakdown.longevity).toBe(3);
  });

  it('caps longevity at 10 points', () => {
    const twoYearsAgo = now - 24 * 30 * 24 * 60 * 60;
    const result = calculateTrustScore(makeAgent({ registered_at: twoYearsAgo }), null, 0, 0);
    expect(result.breakdown.longevity).toBe(10);
  });

  it('sums all components correctly', () => {
    const tenMonthsAgo = now - 10 * 30 * 24 * 60 * 60;
    const score: AgentScore = {
      agent: 'testagent',
      total_score: 50000,
      total_weight: 5,
      feedback_count: 5,
      avg_score: 10000,
      last_updated: now,
    };
    const result = calculateTrustScore(
      makeAgent({ registered_at: tenMonthsAgo }),
      score,
      3,     // 30 KYC
      200000000, // 20 stake (capped)
    );
    // 30 + 20 + 40 + 10 = 100
    expect(result.total).toBe(100);
    expect(result.rating).toBe('verified');
    expect(result.agent).toBe('testagent');
  });
});

// ============== validationResultFromNumber / validationResultToNumber ==============

describe('validationResultFromNumber', () => {
  it('maps 0 to "fail"', () => {
    expect(validationResultFromNumber(0)).toBe('fail');
  });

  it('maps 1 to "pass"', () => {
    expect(validationResultFromNumber(1)).toBe('pass');
  });

  it('maps 2 to "partial"', () => {
    expect(validationResultFromNumber(2)).toBe('partial');
  });

  it('defaults unknown values to "fail"', () => {
    expect(validationResultFromNumber(99)).toBe('fail');
  });
});

describe('validationResultToNumber', () => {
  it('maps "fail" to 0', () => {
    expect(validationResultToNumber('fail')).toBe(0);
  });

  it('maps "pass" to 1', () => {
    expect(validationResultToNumber('pass')).toBe(1);
  });

  it('maps "partial" to 2', () => {
    expect(validationResultToNumber('partial')).toBe(2);
  });

  it('round-trips all values', () => {
    for (const result of ['fail', 'pass', 'partial'] as const) {
      expect(validationResultFromNumber(validationResultToNumber(result))).toBe(result);
    }
  });
});

// ============== disputeStatusFromNumber ==============

describe('disputeStatusFromNumber', () => {
  it('maps 0 to "pending"', () => {
    expect(disputeStatusFromNumber(0)).toBe('pending');
  });

  it('maps 1 to "upheld"', () => {
    expect(disputeStatusFromNumber(1)).toBe('upheld');
  });

  it('maps 2 to "rejected"', () => {
    expect(disputeStatusFromNumber(2)).toBe('rejected');
  });

  it('maps 3 to "cancelled"', () => {
    expect(disputeStatusFromNumber(3)).toBe('cancelled');
  });

  it('defaults unknown values to "pending"', () => {
    expect(disputeStatusFromNumber(99)).toBe('pending');
  });
});

// ============== safeJsonParse ==============

describe('safeJsonParse', () => {
  it('parses valid JSON', () => {
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 });
  });

  it('returns fallback for invalid JSON', () => {
    expect(safeJsonParse('not json', 'default')).toBe('default');
  });

  it('returns fallback for empty string', () => {
    expect(safeJsonParse('', [])).toEqual([]);
  });
});

// ============== parseCapabilities / parseSpecializations ==============

describe('parseCapabilities', () => {
  it('parses valid JSON array', () => {
    expect(parseCapabilities('["compute","storage"]')).toEqual(['compute', 'storage']);
  });

  it('returns empty array for empty string', () => {
    expect(parseCapabilities('')).toEqual([]);
  });

  it('returns empty array for invalid JSON', () => {
    expect(parseCapabilities('not-json')).toEqual([]);
  });
});

describe('parseSpecializations', () => {
  it('parses valid JSON array', () => {
    expect(parseSpecializations('["nlp","vision"]')).toEqual(['nlp', 'vision']);
  });

  it('returns empty array for empty string', () => {
    expect(parseSpecializations('')).toEqual([]);
  });

  it('returns empty array for invalid JSON', () => {
    expect(parseSpecializations('{')).toEqual([]);
  });
});

// ============== parseTags ==============

describe('parseTags', () => {
  it('splits comma-separated tags', () => {
    expect(parseTags('fast,reliable,cheap')).toEqual(['fast', 'reliable', 'cheap']);
  });

  it('trims whitespace', () => {
    expect(parseTags(' fast , reliable , cheap ')).toEqual(['fast', 'reliable', 'cheap']);
  });

  it('filters empty tags', () => {
    expect(parseTags('fast,,reliable,,,')).toEqual(['fast', 'reliable']);
  });

  it('returns empty array for empty string', () => {
    expect(parseTags('')).toEqual([]);
  });
});

// ============== formatXpr / parseXpr ==============

describe('formatXpr', () => {
  it('formats smallest units to readable', () => {
    expect(formatXpr(10000)).toBe('1.0000 XPR');
  });

  it('formats 0', () => {
    expect(formatXpr(0)).toBe('0.0000 XPR');
  });

  it('formats fractional amounts', () => {
    expect(formatXpr(15000)).toBe('1.5000 XPR');
  });
});

describe('parseXpr', () => {
  it('parses "1.0000 XPR" to 10000', () => {
    expect(parseXpr('1.0000 XPR')).toBe(10000);
  });

  it('parses plain number string', () => {
    expect(parseXpr('100')).toBe(1000000);
  });

  it('returns 0 for invalid input', () => {
    expect(parseXpr('abc')).toBe(0);
  });

  it('round-trips with formatXpr', () => {
    expect(parseXpr(formatXpr(12345))).toBe(12345);
  });

  it('handles fractional XPR correctly (integer math precision)', () => {
    // This was the floating-point bug: 0.7 * 10000 = 6999.999...
    expect(parseXpr('0.7000 XPR')).toBe(7000);
    expect(parseXpr('0.0001 XPR')).toBe(1);
    expect(parseXpr('0.9999 XPR')).toBe(9999);
  });

  it('handles large amounts', () => {
    expect(parseXpr('1000000.0000 XPR')).toBe(10000000000);
    expect(parseXpr('999999.9999 XPR')).toBe(9999999999);
  });

  it('handles fewer than 4 decimal places', () => {
    expect(parseXpr('1.5 XPR')).toBe(15000);
    expect(parseXpr('2.50 XPR')).toBe(25000);
    expect(parseXpr('3.125 XPR')).toBe(31250);
  });

  it('handles no decimal point', () => {
    expect(parseXpr('50 XPR')).toBe(500000);
  });

  it('returns 0 for empty string', () => {
    expect(parseXpr('')).toBe(0);
  });
});

// ============== safeParseInt ==============

describe('safeParseInt', () => {
  it('parses valid integer strings', () => {
    expect(safeParseInt('42')).toBe(42);
    expect(safeParseInt('0')).toBe(0);
    expect(safeParseInt('-5')).toBe(-5);
  });

  it('returns fallback for undefined/null/empty', () => {
    expect(safeParseInt(undefined)).toBe(0);
    expect(safeParseInt(null)).toBe(0);
    expect(safeParseInt('')).toBe(0);
  });

  it('returns custom fallback', () => {
    expect(safeParseInt(undefined, 99)).toBe(99);
    expect(safeParseInt(null, -1)).toBe(-1);
    expect(safeParseInt('', 42)).toBe(42);
  });

  it('returns fallback for NaN-producing strings', () => {
    expect(safeParseInt('abc')).toBe(0);
    expect(safeParseInt('abc', 10)).toBe(10);
    expect(safeParseInt('not-a-number')).toBe(0);
  });

  it('parses leading digits from mixed strings', () => {
    // parseInt behavior: parses leading digits
    expect(safeParseInt('123abc')).toBe(123);
    expect(safeParseInt('100.5000 XPR')).toBe(100);
  });

  it('handles string "0" correctly (not falsy)', () => {
    expect(safeParseInt('0')).toBe(0);
    expect(safeParseInt('0', 99)).toBe(0);
  });
});

// ============== formatTimestamp ==============

describe('formatTimestamp', () => {
  it('converts unix seconds to ISO string', () => {
    // 2024-01-01T00:00:00.000Z
    expect(formatTimestamp(1704067200)).toBe('2024-01-01T00:00:00.000Z');
  });

  it('converts 0 to epoch', () => {
    expect(formatTimestamp(0)).toBe('1970-01-01T00:00:00.000Z');
  });
});

// ============== calculateWeightedAverage ==============

describe('calculateWeightedAverage', () => {
  it('returns 0 for empty array', () => {
    expect(calculateWeightedAverage([])).toBe(0);
  });

  it('returns 0 when all weights are 0', () => {
    expect(calculateWeightedAverage([
      { score: 5, weight: 0 },
      { score: 3, weight: 0 },
    ])).toBe(0);
  });

  it('calculates weighted average correctly', () => {
    const result = calculateWeightedAverage([
      { score: 5, weight: 2 },
      { score: 3, weight: 1 },
    ]);
    // (5*2 + 3*1) / (2+1) = 13/3 ≈ 4.333
    expect(result).toBeCloseTo(13 / 3);
  });

  it('handles single item', () => {
    expect(calculateWeightedAverage([{ score: 4, weight: 1 }])).toBe(4);
  });
});

// ============== isValidAccountName ==============

describe('isValidAccountName', () => {
  it('accepts valid names (a-z, 1-5, .)', () => {
    expect(isValidAccountName('alice')).toBe(true);
    expect(isValidAccountName('bob.agent')).toBe(true);
    expect(isValidAccountName('user12345')).toBe(true);
  });

  it('rejects names longer than 12 characters', () => {
    expect(isValidAccountName('abcdefghijklm')).toBe(false);
  });

  it('rejects names with invalid characters', () => {
    expect(isValidAccountName('Alice')).toBe(false); // uppercase
    expect(isValidAccountName('bob@agent')).toBe(false);
    expect(isValidAccountName('bob6agent')).toBe(false); // 6-9 not allowed
  });

  it('rejects empty string', () => {
    expect(isValidAccountName('')).toBe(false);
  });

  it('accepts max length (12 chars)', () => {
    expect(isValidAccountName('abcde12345ab')).toBe(true);
  });
});

// ============== isValidUrl ==============

describe('isValidUrl', () => {
  it('accepts valid HTTP URLs', () => {
    expect(isValidUrl('https://example.com')).toBe(true);
    expect(isValidUrl('http://localhost:3000')).toBe(true);
  });

  it('rejects invalid strings', () => {
    expect(isValidUrl('not a url')).toBe(false);
    expect(isValidUrl('')).toBe(false);
  });
});

// ============== getKycWeight ==============

describe('getKycWeight', () => {
  it('returns 1 + kycLevel', () => {
    expect(getKycWeight(0)).toBe(1);
    expect(getKycWeight(1)).toBe(2);
    expect(getKycWeight(2)).toBe(3);
    expect(getKycWeight(3)).toBe(4);
  });
});
