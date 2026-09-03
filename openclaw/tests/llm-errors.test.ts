import { describe, it, expect } from 'vitest';
import { isLlmUnavailableError, describeLlmError } from '../starter/agent/src/llm-errors';

/** Shape the Anthropic SDK throws for the charliebot job #67 failure */
function anthropicCreditError() {
  const err: any = new Error(
    '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}'
  );
  err.name = 'BadRequestError';
  err.status = 400;
  err.error = { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' };
  return err;
}

describe('isLlmUnavailableError', () => {
  it('treats an out-of-credits 400 as unavailable (charliebot job #67)', () => {
    expect(isLlmUnavailableError(anthropicCreditError())).toBe(true);
  });

  it('treats auth, quota, rate-limit and server statuses as unavailable', () => {
    for (const status of [401, 402, 403, 408, 429, 500, 502, 503, 529]) {
      expect(isLlmUnavailableError({ status, message: 'boom' }), `status ${status}`).toBe(true);
    }
    expect(isLlmUnavailableError({ response: { status: 503 }, message: 'upstream' })).toBe(true);
    expect(isLlmUnavailableError({ statusCode: 429, message: 'slow down' })).toBe(true);
  });

  it('treats SDK error classes as unavailable', () => {
    expect(isLlmUnavailableError({ name: 'APIConnectionError', message: 'Connection error.' })).toBe(true);
    expect(isLlmUnavailableError({ name: 'RateLimitError', message: 'too many requests' })).toBe(true);
    expect(isLlmUnavailableError({ name: 'InternalServerError', message: 'oops' })).toBe(true);
  });

  it('treats network failures as unavailable, including wrapped causes', () => {
    expect(isLlmUnavailableError({ code: 'ECONNRESET', message: 'socket' })).toBe(true);
    expect(isLlmUnavailableError({ code: 'ENOTFOUND', message: 'dns' })).toBe(true);
    const wrapped: any = new TypeError('fetch failed');
    wrapped.cause = { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' };
    expect(isLlmUnavailableError(wrapped)).toBe(true);
  });

  it('treats provider overload and quota messages as unavailable', () => {
    expect(isLlmUnavailableError({ message: 'Overloaded' })).toBe(true);
    expect(isLlmUnavailableError({ message: 'insufficient_quota: check your plan' })).toBe(true);
    expect(isLlmUnavailableError('Request timed out')).toBe(true);
  });

  it('does NOT treat job-level or tool failures as unavailable', () => {
    expect(isLlmUnavailableError(new Error('Tool xpr_deliver_job failed: evidence_uri is required'))).toBe(false);
    expect(isLlmUnavailableError({ status: 400, message: 'messages: at least one message is required' })).toBe(false);
    expect(isLlmUnavailableError({ status: 404, message: 'model not found' })).toBe(false);
    expect(isLlmUnavailableError(new Error('Job #67 has no deliverables'))).toBe(false);
    expect(isLlmUnavailableError(undefined)).toBe(false);
    expect(isLlmUnavailableError(null)).toBe(false);
  });
});

describe('describeLlmError', () => {
  it('renders status and message on one line', () => {
    expect(describeLlmError(anthropicCreditError())).toContain('400');
    expect(describeLlmError(anthropicCreditError())).toContain('credit balance is too low');
  });

  it('falls back to the error code when there is no message', () => {
    expect(describeLlmError({ code: 'ECONNRESET' })).toBe('ECONNRESET');
    expect(describeLlmError({})).toBe('unknown error');
  });
});
