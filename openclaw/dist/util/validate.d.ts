/**
 * Input validation helpers for OpenClaw tool parameters.
 * Reuses patterns from the SDK's utils.ts.
 */
export declare function validateAccountName(name: string, field?: string): void;
export declare function validateScore(score: number): void;
export declare function validateConfidence(confidence: number): void;
export declare function validateUrl(url: string, field?: string): void;
export declare function validateAmount(amount: number, maxAmount: number): void;
export declare function validatePositiveInt(value: number, field: string): void;
export declare function validateRequired(value: unknown, field: string): void;
export declare function validateValidationResult(result: string): void;
export declare function validateClientPercent(percent: number): void;
/**
 * Convert a human-readable XPR amount to smallest units using integer math.
 * Avoids floating-point precision issues (e.g., 0.7 * 10000 = 6999).
 */
export declare function xprToSmallestUnits(amount: number): number;
//# sourceMappingURL=validate.d.ts.map