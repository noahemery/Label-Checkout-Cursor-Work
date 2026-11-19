import { describe, expect, it } from 'vitest';
import { compareSides, labelCodeMatches, sideComplete, type SideData } from './matching';
import { cleanPayload, normalizeId } from './normalize';

function side(batchNumber: string | null, labelCode: string | null, itemNumber: string | null = null): SideData {
  return { batchNumber, labelCode, itemNumber, knownBatch: false };
}

describe('labelCodeMatches — the scanned code must start with the D365 code', () => {
  it('accepts the printed year and version suffix', () => {
    expect(labelCodeMatches('US0.18 V2', 'US0')).toBe(true);
    expect(labelCodeMatches('PURINA 2026', 'PURINA')).toBe(true);
  });

  it('accepts an exact match', () => {
    expect(labelCodeMatches('GT0', 'GT0')).toBe(true);
  });

  it('is lenient about punctuation and case', () => {
    expect(labelCodeMatches('us0.18.v2', 'US0')).toBe(true);
  });

  it('rejects a different region code', () => {
    expect(labelCodeMatches('CA0.18 V2', 'US0')).toBe(false);
  });

  it('rejects a shorter code that is only a prefix of the expected one', () => {
    expect(labelCodeMatches('PET', 'PURINA')).toBe(false);
    expect(labelCodeMatches('US', 'US0')).toBe(false);
  });

  it('never matches when either side is missing', () => {
    expect(labelCodeMatches(null, 'US0')).toBe(false);
    expect(labelCodeMatches('US0', null)).toBe(false);
    expect(labelCodeMatches('', '')).toBe(false);
  });
});

describe('compareSides', () => {
  it('passes when batch and label code agree', () => {
    expect(compareSides(side('BO636845-02', 'US0.18 V2'), side('BO636845-02', 'US0')).ok).toBe(true);
  });

  it('compares batch numbers for equality, not prefix', () => {
    expect(compareSides(side('BO636845', 'US0'), side('BO636845-02', 'US0')).ok).toBe(false);
  });

  it('fails a label side with no label code instead of borrowing the expected one', () => {
    const result = compareSides(side('BO636845', null), side('BO636845', 'US0'));
    expect(result.ok).toBe(false);
    expect(result.comparisons.find((c) => c.field === 'Label code')?.ok).toBe(false);
  });

  it('only compares item number when both sides carry one', () => {
    expect(compareSides(side('B1', 'US0'), side('B1', 'US0', '02.0120.067.012')).ok).toBe(true);
    expect(compareSides(side('B1', 'US0', '02.0120.067.999'), side('B1', 'US0', '02.0120.067.012')).ok).toBe(
      false,
    );
  });
});

describe('sideComplete', () => {
  it('needs both a batch number and a label code', () => {
    expect(sideComplete(side('B1', 'US0'))).toBe(true);
    expect(sideComplete(side('B1', null))).toBe(false);
    expect(sideComplete(side(null, 'US0'))).toBe(false);
  });
});

describe('normalizeId / cleanPayload', () => {
  it('treats punctuation and spacing variants as the same id', () => {
    expect(normalizeId('US0.18.V2')).toBe(normalizeId('US0.18  V2'));
    expect(normalizeId('us018v2')).toBe('US018V2');
  });

  it('strips a scanner AIM symbology prefix and surrounding whitespace', () => {
    expect(cleanPayload('  ]Q1BO676767  ')).toBe('BO676767');
    expect(cleanPayload(']C0BO676767')).toBe('BO676767');
  });
});
