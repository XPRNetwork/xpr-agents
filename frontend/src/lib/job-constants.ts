export const STATE_COLORS: Record<number, string> = {
  0: 'bg-surface-2 text-ink-2',       // Created
  1: 'bg-blue-50 text-blue-600',       // Funded
  2: 'bg-indigo-500/10 text-indigo-400',   // Accepted
  3: 'bg-yellow-50 text-yellow-600',   // In Progress
  4: 'bg-orange-500/10 text-orange-600',   // Delivered
  5: 'bg-red-50 text-red-600',         // Disputed
  6: 'bg-emerald-50 text-emerald-600', // Completed
  7: 'bg-surface-2 text-muted',       // Refunded
  8: 'bg-accent/10 text-accent',   // Arbitrated
};

export function getTxId(result: any): string | undefined {
  return result?.processed?.id;
}
