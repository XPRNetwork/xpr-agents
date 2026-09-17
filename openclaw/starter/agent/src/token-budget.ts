/**
 * LLM spend budget.
 *
 * SECURITY / cost-control: MAX_TURNS and MAX_CONCURRENT_RUNS bound a single run's
 * shape but nothing bounded total token spend, so a flood of events (or a single
 * pathological run) could run up an unbounded bill. This caps tokens per run and
 * per UTC day. Provider pricing differs, so we count tokens (input+output), the
 * common denominator across providers. Set either env to 0 to disable that cap.
 */
/** Parse a non-negative integer env var, falling back to `def` for empty/invalid
 *  input so a typo can never silently disable the cap (NaN). Negative -> 0. */
function envCap(raw: string | undefined, def: number): number {
  if (raw === undefined || raw.trim() === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return def;
  return n;
}
export const MAX_TOKENS_PER_RUN = envCap(process.env.AGENT_MAX_TOKENS_PER_RUN, 300000);
export const MAX_TOKENS_PER_DAY = envCap(process.env.AGENT_MAX_TOKENS_PER_DAY, 10000000);

let tokenDay = '';
let tokensToday = 0;

function utcDayKey(): string { return new Date().toISOString().slice(0, 10); }
function rollover(): void {
  const d = utcDayKey();
  if (tokenDay !== d) { tokenDay = d; tokensToday = 0; }
}

/** True once the per-day cap is reached (checked before starting/continuing a run). */
export function dailyTokenBudgetExhausted(): boolean {
  if (MAX_TOKENS_PER_DAY <= 0) return false;
  rollover();
  return tokensToday >= MAX_TOKENS_PER_DAY;
}

/** Record a completion's usage against the daily total. Returns tokens added. */
export function recordTokenUsage(usage?: { input_tokens: number; output_tokens: number }): number {
  const n = usage ? (usage.input_tokens || 0) + (usage.output_tokens || 0) : 0;
  if (n > 0) { rollover(); tokensToday += n; }
  return n;
}

export function tokenBudgetStats(): { today: number; day: string; per_run_cap: number; per_day_cap: number } {
  rollover();
  return { today: tokensToday, day: tokenDay, per_run_cap: MAX_TOKENS_PER_RUN, per_day_cap: MAX_TOKENS_PER_DAY };
}

/** Test-only: reset the daily accumulator. */
export function __resetTokenBudget(): void { tokenDay = ''; tokensToday = 0; }
