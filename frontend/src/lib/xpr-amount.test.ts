import { describe, expect, it } from 'vitest';
import { parseXprAmount, formatXprAsset } from './xpr-amount';

describe('XPR amounts', () => {
  it.each([
    ['0', 0, '0.0000 XPR'],
    ['1', 10000, '1.0000 XPR'],
    ['1.0009', 10009, '1.0009 XPR'],
    ['0.0001', 1, '0.0001 XPR'],
    ['001.23', 12300, '1.2300 XPR'],
    ['900719925474.0991', Number.MAX_SAFE_INTEGER, '900719925474.0991 XPR'],
  ])('converts %s exactly', (input, raw, asset) => {
    expect(parseXprAmount(input)).toBe(raw);
    expect(formatXprAsset(raw)).toBe(asset);
  });

  it.each([
    '', ' ', '.', '-.1', '1.', '-1', '+1', '1e2', '0x10',
    'NaN', 'Infinity', '1 XPR', '1.00009', '1.00000', '1.2.3', '1,000',
    '900719925474.0992', '999999999999999999999999',
  ])('rejects %j', input => {
    expect(() => parseXprAmount(input)).toThrow();
  });

  it('ignores surrounding whitespace', () => {
    expect(parseXprAmount(' 1.5 ')).toBe(15000);
    expect(parseXprAmount('1\n')).toBe(10000);
    expect(parseXprAmount('.5')).toBe(5000);
  });

  it.each([-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid raw units %s', raw => {
    expect(() => formatXprAsset(raw)).toThrow();
  });
});
