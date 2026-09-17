import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * LLM spend budget. The caps are read from env at module load, so tests that
 * exercise a specific cap reset the module registry and re-import with the env set.
 */
describe('token budget', () => {
  const saved = process.env.AGENT_MAX_TOKENS_PER_DAY;
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    if (saved === undefined) delete process.env.AGENT_MAX_TOKENS_PER_DAY;
    else process.env.AGENT_MAX_TOKENS_PER_DAY = saved;
  });

  it('accumulates usage and reports it in stats', async () => {
    const tb = await import('../src/token-budget');
    tb.__resetTokenBudget();
    expect(tb.recordTokenUsage({ input_tokens: 100, output_tokens: 50 })).toBe(150);
    expect(tb.recordTokenUsage(undefined)).toBe(0);
    expect(tb.tokenBudgetStats().today).toBe(150);
  });

  it('reports exhausted once the daily cap is reached', async () => {
    process.env.AGENT_MAX_TOKENS_PER_DAY = '1000';
    vi.resetModules();
    const tb = await import('../src/token-budget');
    tb.__resetTokenBudget();
    expect(tb.dailyTokenBudgetExhausted()).toBe(false);
    tb.recordTokenUsage({ input_tokens: 600, output_tokens: 500 }); // 1100 >= 1000
    expect(tb.dailyTokenBudgetExhausted()).toBe(true);
  });

  it('treats a cap of 0 as unlimited', async () => {
    process.env.AGENT_MAX_TOKENS_PER_DAY = '0';
    vi.resetModules();
    const tb = await import('../src/token-budget');
    tb.__resetTokenBudget();
    tb.recordTokenUsage({ input_tokens: 10_000_000, output_tokens: 0 });
    expect(tb.dailyTokenBudgetExhausted()).toBe(false);
  });
});
