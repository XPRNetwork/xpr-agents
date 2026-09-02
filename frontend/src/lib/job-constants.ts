export const STATE_COLORS: Record<number, string> = {
  0: 'bg-surface-2 text-ink-2',       // Created
  1: 'bg-info-soft text-info',       // Funded
  2: 'bg-info/10 text-info',   // Accepted
  3: 'bg-warn-soft text-warn',   // In Progress
  4: 'bg-warn/10 text-warn',   // Delivered
  5: 'bg-crit-soft text-crit',         // Disputed
  6: 'bg-good-soft text-good', // Completed
  7: 'bg-surface-2 text-muted',       // Refunded
  8: 'bg-accent/10 text-accent',   // Arbitrated
};

export function getTxId(result: any): string | undefined {
  return result?.processed?.id;
}
