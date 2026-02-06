/**
 * Confirmation gate for high-risk write tools.
 *
 * When confirmHighRisk is enabled, high-risk tools return a confirmation
 * prompt instead of executing immediately. The agent relays the prompt
 * to the user. On the next turn, when the user confirms, the tool executes.
 */

export interface ConfirmationResult {
  needs_confirmation: true;
  action: string;
  details: Record<string, unknown>;
  message: string;
}

export function needsConfirmation(
  confirmHighRisk: boolean,
  action: string,
  details: Record<string, unknown>,
  message: string
): ConfirmationResult | null {
  if (!confirmHighRisk) {
    return null;
  }

  return {
    needs_confirmation: true,
    action,
    details,
    message,
  };
}

export function formatConfirmation(
  action: string,
  details: Record<string, unknown>
): string {
  const lines = [`Action: ${action}`];
  for (const [key, value] of Object.entries(details)) {
    if (value !== undefined && value !== null && value !== '') {
      lines.push(`  ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
    }
  }
  return lines.join('\n');
}
