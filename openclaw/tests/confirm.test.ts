import { describe, it, expect } from 'vitest';
import { needsConfirmation, formatConfirmation } from '../src/util/confirm';

describe('Confirmation Gate', () => {
  it('returns null when confirmHighRisk is false', () => {
    const result = needsConfirmation(false, 'Test Action', { key: 'value' }, 'Test message');
    expect(result).toBeNull();
  });

  it('returns confirmation object when confirmHighRisk is true', () => {
    const result = needsConfirmation(true, 'Test Action', { key: 'value' }, 'Test message');
    expect(result).not.toBeNull();
    expect(result!.needs_confirmation).toBe(true);
    expect(result!.action).toBe('Test Action');
    expect(result!.message).toBe('Test message');
    expect(result!.details).toEqual({ key: 'value' });
  });
});

describe('formatConfirmation', () => {
  it('formats action with details', () => {
    const result = formatConfirmation('Fund Job', { job_id: 42, amount: '1000 XPR' });
    expect(result).toContain('Fund Job');
    expect(result).toContain('job_id: 42');
    expect(result).toContain('amount: 1000 XPR');
  });

  it('skips empty/null values', () => {
    const result = formatConfirmation('Test', { present: 'yes', empty: '', absent: null });
    expect(result).toContain('present: yes');
    expect(result).not.toContain('empty:');
    expect(result).not.toContain('absent:');
  });
});
