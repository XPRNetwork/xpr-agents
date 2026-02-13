export const STATE_COLORS: Record<number, string> = {
  0: 'bg-zinc-500/10 text-zinc-400',       // Created
  1: 'bg-blue-500/10 text-blue-400',       // Funded
  2: 'bg-indigo-500/10 text-indigo-400',   // Accepted
  3: 'bg-yellow-500/10 text-yellow-400',   // In Progress
  4: 'bg-orange-500/10 text-orange-400',   // Delivered
  5: 'bg-red-500/10 text-red-400',         // Disputed
  6: 'bg-emerald-500/10 text-emerald-400', // Completed
  7: 'bg-zinc-500/10 text-zinc-500',       // Refunded
  8: 'bg-purple-500/10 text-purple-400',   // Arbitrated
};

export function getTxId(result: any): string | undefined {
  return result?.processed?.id;
}
