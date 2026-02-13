"use strict";
/**
 * Confirmation gate for high-risk write tools.
 *
 * When confirmHighRisk is enabled and `confirmed` is not true, high-risk
 * tools return a confirmation prompt instead of executing. The agent relays
 * the prompt to the user. On the next call the agent passes confirmed=true
 * and the tool executes normally.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.needsConfirmation = needsConfirmation;
exports.formatConfirmation = formatConfirmation;
/**
 * Returns a confirmation prompt if the action has not been confirmed yet.
 * Returns null (proceed) when either:
 *   - confirmHighRisk is disabled in config, or
 *   - the caller already set confirmed=true
 */
function needsConfirmation(confirmHighRisk, confirmed, action, details, message) {
    if (!confirmHighRisk || confirmed === true) {
        return null;
    }
    return {
        needs_confirmation: true,
        action,
        details,
        message,
    };
}
function formatConfirmation(action, details) {
    const lines = [`Action: ${action}`];
    for (const [key, value] of Object.entries(details)) {
        if (value !== undefined && value !== null && value !== '') {
            lines.push(`  ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
        }
    }
    return lines.join('\n');
}
//# sourceMappingURL=confirm.js.map