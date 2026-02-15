"use strict";
/**
 * Input validation helpers for OpenClaw tool parameters.
 * Reuses patterns from the SDK's utils.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateAccountName = validateAccountName;
exports.validateScore = validateScore;
exports.validateConfidence = validateConfidence;
exports.validateUrl = validateUrl;
exports.resetTransferTracking = resetTransferTracking;
exports.validateAmount = validateAmount;
exports.validatePositiveInt = validatePositiveInt;
exports.validateRequired = validateRequired;
exports.validateValidationResult = validateValidationResult;
exports.validateClientPercent = validateClientPercent;
exports.xprToSmallestUnits = xprToSmallestUnits;
function validateAccountName(name, field = 'account') {
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
function validateScore(score) {
    if (typeof score !== 'number' || !Number.isInteger(score)) {
        throw new Error('score must be an integer');
    }
    if (score < 1 || score > 5) {
        throw new Error('score must be between 1 and 5');
    }
}
function validateConfidence(confidence) {
    if (typeof confidence !== 'number' || !Number.isInteger(confidence)) {
        throw new Error('confidence must be an integer');
    }
    if (confidence < 0 || confidence > 100) {
        throw new Error('confidence must be between 0 and 100');
    }
}
function validateUrl(url, field = 'url') {
    if (!url || typeof url !== 'string') {
        throw new Error(`${field} is required`);
    }
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        throw new Error(`${field} must be a valid URL`);
    }
    // H5 AUDIT FIX: Block non-HTTP schemes and private/metadata endpoints
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`${field} must use http or https protocol`);
    }
    const hostname = parsed.hostname.toLowerCase();
    // Block localhost variants
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0') {
        throw new Error(`${field} must not point to localhost`);
    }
    // Block private IP ranges and cloud metadata
    const blocked = [
        /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^169\.254\./,
    ];
    if (blocked.some(p => p.test(hostname))) {
        throw new Error(`${field} must not point to private IP ranges`);
    }
}
// H3 AUDIT FIX: Session-level aggregate transfer tracking
const SESSION_TRANSFER_WINDOW_MS = 60 * 60 * 1000; // 1 hour
let sessionTransfers = [];
/** Reset aggregate transfer tracking (for testing) */
function resetTransferTracking() {
    sessionTransfers = [];
}
function validateAmount(amount, maxAmount) {
    if (typeof amount !== 'number' || amount <= 0) {
        throw new Error('amount must be a positive number');
    }
    if (amount > maxAmount) {
        throw new Error(`amount exceeds maximum allowed (${maxAmount / 10000} XPR)`);
    }
    // H3 AUDIT FIX: Enforce aggregate session limit (10x per-operation max per hour)
    const now = Date.now();
    const windowStart = now - SESSION_TRANSFER_WINDOW_MS;
    // Prune old entries
    while (sessionTransfers.length > 0 && sessionTransfers[0].timestamp < windowStart) {
        sessionTransfers.shift();
    }
    const aggregateLimit = maxAmount * 10;
    const currentAggregate = sessionTransfers.reduce((sum, t) => sum + t.amount, 0);
    if (currentAggregate + amount > aggregateLimit) {
        throw new Error(`Aggregate transfer limit exceeded (${aggregateLimit / 10000} XPR/hour). Try again later.`);
    }
    sessionTransfers.push({ amount, timestamp: now });
}
function validatePositiveInt(value, field) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new Error(`${field} must be a non-negative integer`);
    }
}
function validateRequired(value, field) {
    if (value === undefined || value === null || value === '') {
        throw new Error(`${field} is required`);
    }
}
function validateValidationResult(result) {
    if (!['fail', 'pass', 'partial'].includes(result)) {
        throw new Error("result must be 'fail', 'pass', or 'partial'");
    }
}
function validateClientPercent(percent) {
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
function xprToSmallestUnits(amount) {
    const str = amount.toFixed(4);
    const [whole, frac = ''] = str.split('.');
    const paddedFrac = frac.padEnd(4, '0').slice(0, 4);
    return parseInt(whole, 10) * 10000 + parseInt(paddedFrac, 10);
}
//# sourceMappingURL=validate.js.map