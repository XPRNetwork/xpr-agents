/**
 * Confirmation gate for high-risk write tools.
 *
 * When confirmHighRisk is enabled and `confirmed` is not true, high-risk
 * tools return a confirmation prompt instead of executing. The agent relays
 * the prompt to the user. On the next call the agent passes confirmed=true
 * and the tool executes normally.
 */
export interface ConfirmationResult {
    needs_confirmation: true;
    action: string;
    details: Record<string, unknown>;
    message: string;
}
/**
 * Returns a confirmation prompt if the action has not been confirmed yet.
 * Returns null (proceed) when either:
 *   - confirmHighRisk is disabled in config, or
 *   - the caller already set confirmed=true
 */
export declare function needsConfirmation(confirmHighRisk: boolean, confirmed: boolean | undefined, action: string, details: Record<string, unknown>, message: string): ConfirmationResult | null;
export declare function formatConfirmation(action: string, details: Record<string, unknown>): string;
//# sourceMappingURL=confirm.d.ts.map