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
    try {
        new URL(url);
    }
    catch {
        throw new Error(`${field} must be a valid URL`);
    }
}
function validateAmount(amount, maxAmount) {
    if (typeof amount !== 'number' || amount <= 0) {
        throw new Error('amount must be a positive number');
    }
    if (amount > maxAmount) {
        throw new Error(`amount exceeds maximum allowed (${maxAmount / 10000} XPR)`);
    }
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