/**
 * LLM transport failures vs. job failures.
 *
 * The poller counts how many times it has invoked the model for a FUNDED job so
 * a genuinely impossible job cannot burn credits forever. A run that never
 * reached the model — no API credits, a bad key, a rate limit, a 5xx, a dropped
 * connection — must NOT count: charliebot lost job #67 permanently when two
 * "credit balance is too low" failures pushed its counter to the retry cap and
 * the counter was then persisted across restarts.
 *
 * Pure module (no imports, no side effects) so it can be unit tested.
 */

/** Error-ish shape the provider SDKs (Anthropic, OpenAI, Gemini) throw. */
interface ErrorLike {
  name?: unknown;
  message?: unknown;
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
  type?: unknown;
  response?: { status?: unknown };
  cause?: unknown;
  error?: { type?: unknown; message?: unknown };
}

/** HTTP statuses that mean "the model was not reached", never "the job is bad" */
function isUnavailableStatus(status: number): boolean {
  // 401/403 bad or revoked key, 402 payment required, 408 timeout,
  // 409 conflict (provider-side), 429 rate limit / quota, any 5xx
  return status === 401 || status === 402 || status === 403 || status === 408 ||
    status === 409 || status === 429 || (status >= 500 && status <= 599);
}

/** Node / undici network error codes */
const NETWORK_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'EPIPE', 'ETIMEDOUT',
  'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'ERR_NETWORK',
]);

/**
 * Message fragments that identify a provider-side refusal even when the status
 * is a plain 400 — Anthropic returns HTTP 400 for "credit balance is too low".
 */
const UNAVAILABLE_PATTERNS = [
  /credit balance is too low/i,
  /insufficient[_ ]quota/i,
  /quota exceeded/i,
  /billing/i,
  /payment required/i,
  /rate[_ ]?limit/i,
  /overloaded/i,
  /(server|service)[_ ](error|unavailable)/i,
  /temporarily unavailable/i,
  /api[_ ]?key/i,
  /unauthorized|authentication[_ ]error|permission[_ ]error/i,
  /connection error|network error|fetch failed|socket hang up/i,
  /timed? ?out/i,
];

function numberish(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d{3}$/.test(value)) return Number(value);
  return null;
}

/**
 * True when a failed agent run never got a usable response out of the LLM API.
 * Callers must not count such a run as an attempt against the job.
 */
export function isLlmUnavailableError(err: unknown): boolean {
  if (!err || (typeof err !== 'object' && typeof err !== 'string')) return false;

  if (typeof err === 'string') {
    return UNAVAILABLE_PATTERNS.some(p => p.test(err));
  }

  const e = err as ErrorLike;

  const status = numberish(e.status) ?? numberish(e.statusCode) ?? numberish(e.response?.status);
  if (status !== null && isUnavailableStatus(status)) return true;

  const code = typeof e.code === 'string' ? e.code : '';
  if (code && NETWORK_CODES.has(code)) return true;

  const name = typeof e.name === 'string' ? e.name : '';
  if (/^(APIConnectionError|APIConnectionTimeoutError|APIUserAbortError|RateLimitError|InternalServerError|AuthenticationError|PermissionDeniedError)$/.test(name)) {
    return true;
  }

  const type = typeof e.type === 'string' ? e.type : (typeof e.error?.type === 'string' ? e.error.type : '');
  if (/rate_limit_error|overloaded_error|api_error|authentication_error|permission_error|billing/i.test(type)) {
    return true;
  }

  const message = [
    typeof e.message === 'string' ? e.message : '',
    typeof e.error?.message === 'string' ? e.error.message : '',
  ].join(' ');
  if (message && UNAVAILABLE_PATTERNS.some(p => p.test(message))) return true;

  // undici wraps the real cause (`TypeError: fetch failed` → cause ECONNREFUSED)
  if (e.cause && e.cause !== err) return isLlmUnavailableError(e.cause);

  return false;
}

/** Short one-line reason for logs, e.g. "400 credit balance is too low". */
export function describeLlmError(err: unknown): string {
  if (typeof err === 'string') return err.slice(0, 160);
  const e = (err || {}) as ErrorLike;
  const status = numberish(e.status) ?? numberish(e.statusCode) ?? numberish(e.response?.status);
  const message = (typeof e.message === 'string' && e.message) ||
    (typeof e.error?.message === 'string' && e.error.message) ||
    (typeof e.code === 'string' && e.code) || 'unknown error';
  return `${status !== null ? `${status} ` : ''}${String(message).slice(0, 160)}`;
}
