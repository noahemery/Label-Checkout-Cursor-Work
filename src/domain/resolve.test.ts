import { describe, expect, it } from 'vitest';
import { looksLikeDate, looksLikeGtin } from './resolve';

describe('looksLikeDate — the expiration date barcode is not a badge', () => {
  it.each(['20280318', '2028-03-18', '03182028', '280318', '(17)280318'])('recognizes %s', (value) => {
    expect(looksLikeDate(value)).toBe(true);
  });

  it.each(['12345', '20281332', '20280000', 'BO636845', '123456789'])('does not treat %s as a date', (value) => {
    expect(looksLikeDate(value)).toBe(false);
  });
});

describe('looksLikeGtin — a product barcode is not a batch', () => {
  it('recognizes 12- to 16-digit product codes', () => {
    expect(looksLikeGtin('012345678905')).toBe(true);
    expect(looksLikeGtin('(01)00012345678905')).toBe(true);
  });

  it('leaves badges and batch numbers alone', () => {
    expect(looksLikeGtin('12345')).toBe(false);
    expect(looksLikeGtin('BO636845')).toBe(false);
  });
});
