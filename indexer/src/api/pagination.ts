export function pagination(query: { limit?: unknown; offset?: unknown }, defaultLimit = 100, cap = 500): { limit: number; offset: number } {
  const integer = (value: unknown, fallback: number): number => {
    if (typeof value !== 'string' && typeof value !== 'number') return fallback;
    if (typeof value === 'string' && value.trim() === '') return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? Math.trunc(number) : fallback;
  };
  return {
    limit: Math.min(Math.max(integer(query.limit, defaultLimit), 1), cap),
    offset: Math.min(Math.max(integer(query.offset, 0), 0), Number.MAX_SAFE_INTEGER),
  };
}
