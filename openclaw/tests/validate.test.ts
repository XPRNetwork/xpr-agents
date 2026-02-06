import { describe, it, expect } from 'vitest';
import {
  validateAccountName,
  validateScore,
  validateConfidence,
  validateUrl,
  validateAmount,
  validatePositiveInt,
  validateRequired,
  validateValidationResult,
  validateClientPercent,
} from '../src/util/validate';

describe('validateAccountName', () => {
  it('accepts valid names', () => {
    expect(() => validateAccountName('alice')).not.toThrow();
    expect(() => validateAccountName('bob.agent')).not.toThrow();
    expect(() => validateAccountName('a1b2c3d4e5f1')).not.toThrow();
  });

  it('rejects empty/missing names', () => {
    expect(() => validateAccountName('')).toThrow('required');
    expect(() => validateAccountName(undefined as any)).toThrow('required');
  });

  it('rejects names longer than 12 chars', () => {
    expect(() => validateAccountName('toolongaccount1')).toThrow('12 characters');
  });

  it('rejects invalid characters', () => {
    expect(() => validateAccountName('ALICE')).toThrow('a-z');
    expect(() => validateAccountName('alice@bob')).toThrow('a-z');
    expect(() => validateAccountName('alice 6')).toThrow('a-z');
  });
});

describe('validateScore', () => {
  it('accepts valid scores 1-5', () => {
    for (let i = 1; i <= 5; i++) {
      expect(() => validateScore(i)).not.toThrow();
    }
  });

  it('rejects out of range', () => {
    expect(() => validateScore(0)).toThrow('between 1 and 5');
    expect(() => validateScore(6)).toThrow('between 1 and 5');
  });

  it('rejects non-integers', () => {
    expect(() => validateScore(2.5)).toThrow('integer');
  });
});

describe('validateConfidence', () => {
  it('accepts 0-100', () => {
    expect(() => validateConfidence(0)).not.toThrow();
    expect(() => validateConfidence(50)).not.toThrow();
    expect(() => validateConfidence(100)).not.toThrow();
  });

  it('rejects out of range', () => {
    expect(() => validateConfidence(-1)).toThrow('between 0 and 100');
    expect(() => validateConfidence(101)).toThrow('between 0 and 100');
  });
});

describe('validateUrl', () => {
  it('accepts valid URLs', () => {
    expect(() => validateUrl('https://example.com')).not.toThrow();
    expect(() => validateUrl('http://localhost:3000')).not.toThrow();
  });

  it('rejects invalid URLs', () => {
    expect(() => validateUrl('not-a-url')).toThrow('valid URL');
    expect(() => validateUrl('')).toThrow('required');
  });
});

describe('validateAmount', () => {
  it('accepts positive amounts', () => {
    expect(() => validateAmount(100, 10000)).not.toThrow();
  });

  it('rejects zero or negative', () => {
    expect(() => validateAmount(0, 10000)).toThrow('positive');
    expect(() => validateAmount(-5, 10000)).toThrow('positive');
  });

  it('rejects exceeding max', () => {
    expect(() => validateAmount(20000, 10000)).toThrow('exceeds maximum');
  });
});

describe('validatePositiveInt', () => {
  it('accepts non-negative integers', () => {
    expect(() => validatePositiveInt(0, 'test')).not.toThrow();
    expect(() => validatePositiveInt(42, 'test')).not.toThrow();
  });

  it('rejects negative numbers', () => {
    expect(() => validatePositiveInt(-1, 'test')).toThrow('non-negative');
  });

  it('rejects floats', () => {
    expect(() => validatePositiveInt(1.5, 'test')).toThrow('non-negative integer');
  });
});

describe('validateRequired', () => {
  it('accepts truthy values', () => {
    expect(() => validateRequired('hello', 'test')).not.toThrow();
    expect(() => validateRequired(42, 'test')).not.toThrow();
  });

  it('rejects empty/null/undefined', () => {
    expect(() => validateRequired('', 'test')).toThrow('required');
    expect(() => validateRequired(null, 'test')).toThrow('required');
    expect(() => validateRequired(undefined, 'test')).toThrow('required');
  });
});

describe('validateValidationResult', () => {
  it('accepts valid results', () => {
    expect(() => validateValidationResult('fail')).not.toThrow();
    expect(() => validateValidationResult('pass')).not.toThrow();
    expect(() => validateValidationResult('partial')).not.toThrow();
  });

  it('rejects invalid results', () => {
    expect(() => validateValidationResult('invalid')).toThrow("'fail', 'pass', or 'partial'");
  });
});

describe('validateClientPercent', () => {
  it('accepts 0-100', () => {
    expect(() => validateClientPercent(0)).not.toThrow();
    expect(() => validateClientPercent(50)).not.toThrow();
    expect(() => validateClientPercent(100)).not.toThrow();
  });

  it('rejects out of range', () => {
    expect(() => validateClientPercent(-1)).toThrow('between 0 and 100');
    expect(() => validateClientPercent(101)).toThrow('between 0 and 100');
  });
});
