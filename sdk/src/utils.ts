import {
  Agent,
  AgentScore,
  TrustScore,
  TrustScoreBreakdown,
  TrustRating,
  ValidationResult,
  DisputeStatus,
} from './types';

/**
 * Calculate trust score for an agent
 * Combines KYC level, stake, reputation, and longevity
 */
export function calculateTrustScore(
  agent: Agent,
  agentScore: AgentScore | null,
  kycLevel: number
): TrustScore {
  const breakdown: TrustScoreBreakdown = {
    kyc: 0,
    stake: 0,
    reputation: 0,
    longevity: 0,
  };

  // KYC score (0-30 points)
  // Level 0 = 0, Level 1 = 10, Level 2 = 20, Level 3 = 30
  breakdown.kyc = Math.min(kycLevel * 10, 30);

  // Stake score (0-20 points, caps at 10000 XPR)
  // Every 500 XPR = 1 point, max 20 points
  const stakeXpr = agent.stake / 10000; // Convert from smallest unit
  breakdown.stake = Math.min(Math.floor(stakeXpr / 500), 20);

  // Reputation score (0-40 points)
  if (agentScore && agentScore.total_weight > 0) {
    // avg_score is 0-10000 (representing 0-100.00%)
    // We need to convert to 0-40 points
    // If avg_score is 10000 (100%), that means perfect 5/5 rating
    breakdown.reputation = Math.floor((agentScore.avg_score / 10000) * 40);
  }

  // Longevity score (0-10 points, 1 point per month)
  const now = Math.floor(Date.now() / 1000);
  const monthsActive = Math.floor((now - agent.registered_at) / (30 * 24 * 60 * 60));
  breakdown.longevity = Math.min(monthsActive, 10);

  // Total score (0-100)
  const total = breakdown.kyc + breakdown.stake + breakdown.reputation + breakdown.longevity;

  return {
    agent: agent.account,
    total,
    breakdown,
    rating: getTrustRating(total),
  };
}

/**
 * Get trust rating label from numeric score
 */
export function getTrustRating(score: number): TrustRating {
  if (score >= 80) return 'verified';
  if (score >= 60) return 'high';
  if (score >= 40) return 'medium';
  if (score >= 20) return 'low';
  return 'untrusted';
}

/**
 * Convert validation result number to string
 */
export function validationResultFromNumber(result: number): ValidationResult {
  switch (result) {
    case 0:
      return 'fail';
    case 1:
      return 'pass';
    case 2:
      return 'partial';
    default:
      return 'fail';
  }
}

/**
 * Convert validation result string to number
 */
export function validationResultToNumber(result: ValidationResult): number {
  switch (result) {
    case 'fail':
      return 0;
    case 'pass':
      return 1;
    case 'partial':
      return 2;
    default:
      return 0;
  }
}

/**
 * Convert dispute status number to string
 */
export function disputeStatusFromNumber(status: number): DisputeStatus {
  switch (status) {
    case 0:
      return 'pending';
    case 1:
      return 'upheld';
    case 2:
      return 'rejected';
    default:
      return 'pending';
  }
}

/**
 * Parse JSON safely with fallback
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/**
 * Parse capabilities string to array
 */
export function parseCapabilities(capabilities: string): string[] {
  if (!capabilities) return [];
  return safeJsonParse<string[]>(capabilities, []);
}

/**
 * Parse specializations string to array
 */
export function parseSpecializations(specializations: string): string[] {
  if (!specializations) return [];
  return safeJsonParse<string[]>(specializations, []);
}

/**
 * Parse tags string to array (comma-separated)
 */
export function parseTags(tags: string): string[] {
  if (!tags) return [];
  return tags.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
}

/**
 * Format XPR amount from smallest unit
 */
export function formatXpr(amount: number): string {
  return (amount / 10000).toFixed(4) + ' XPR';
}

/**
 * Parse XPR amount to smallest unit
 */
export function parseXpr(amount: string): number {
  const match = amount.match(/^(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  return Math.floor(parseFloat(match[1]) * 10000);
}

/**
 * Format timestamp to ISO string
 */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

/**
 * Calculate weighted average score
 */
export function calculateWeightedAverage(
  scores: Array<{ score: number; weight: number }>
): number {
  if (scores.length === 0) return 0;

  let totalScore = 0;
  let totalWeight = 0;

  for (const { score, weight } of scores) {
    totalScore += score * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return 0;
  return totalScore / totalWeight;
}

/**
 * Validate XPR account name
 * Must be 1-12 characters, a-z, 1-5, and .
 */
export function isValidAccountName(name: string): boolean {
  if (!name || name.length > 12) return false;
  return /^[a-z1-5.]+$/.test(name);
}

/**
 * Validate URL format
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get KYC level weight for feedback scoring
 */
export function getKycWeight(kycLevel: number): number {
  return 1 + kycLevel;
}
