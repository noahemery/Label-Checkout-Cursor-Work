import { describe, expect, it } from 'vitest';
import { parsePayload } from './payloads';

const BADGE = '^\\d{5,14}$';

describe('parsePayload — printed roll QR (batch|item|product|labelCode|date)', () => {
  it('reads the live BarTender layout', () => {
    const parsed = parsePayload('BO676767|02.0120.067.012|NRP DIGEST PACK|US0|2028-03-18', BADGE);
    expect(parsed).toMatchObject({
      kind: 'label',
      batchNumber: 'BO676767',
      itemNumber: '02.0120.067.012',
      productName: 'NRP DIGEST PACK',
      labelCode: 'US0',
      doe: '2028-03-18',
    });
  });

  it('ignores spaces around the pipes and an AIM prefix', () => {
    const parsed = parsePayload(']Q1 BO676767 | 02.0120 | NRP | US0.18 V2 | 2028-03-18 ', BADGE);
    expect(parsed).toMatchObject({ kind: 'label', batchNumber: 'BO676767', labelCode: 'US0.18 V2' });
  });

  it('joins a product name that contains a pipe back together', () => {
    const parsed = parsePayload('B1|ITEM|NRP|DIGEST|US0|2028-03-18', BADGE);
    expect(parsed).toMatchObject({ kind: 'label', productName: 'NRP DIGEST', labelCode: 'US0' });
  });
});

describe('parsePayload — legacy and rejected forms', () => {
  it('still reads the legacy LBL| label QR', () => {
    expect(parsePayload('LBL|1|BO636845|02.0120|US0', BADGE)).toMatchObject({
      kind: 'label',
      batchNumber: 'BO636845',
      labelCode: 'US0',
    });
  });

  it('recognizes a stray REF| QR by name so it can be rejected specifically', () => {
    expect(parsePayload('REF|1|BO636845|02.0120|US0|900|2026-01-01|2028-01-01', BADGE).kind).toBe(
      'reference',
    );
  });

  it('refuses a payload version this build cannot read', () => {
    expect(parsePayload('LBL|2|BO636845|02.0120|US0', BADGE)).toMatchObject({
      kind: 'unsupported',
      version: '2',
    });
  });
});

describe('parsePayload — badges and raw entries', () => {
  it('reads a 5-digit prox badge', () => {
    expect(parsePayload('12345', BADGE)).toMatchObject({ kind: 'badge', badgeId: '12345' });
  });

  it('treats a typed batch number as raw', () => {
    expect(parsePayload('BO636845-02', BADGE)).toMatchObject({ kind: 'raw', value: 'BO636845-02' });
  });

  it('falls back to raw when the badge pattern is not a valid regex', () => {
    expect(parsePayload('12345', '([')).toMatchObject({ kind: 'raw' });
  });
});
