import { describe, expect, it } from 'vitest';
import {
  compareFamily,
  dbSideFromBatch,
  keyedEntrySuffix,
  memberPairFromLabelScan,
  mismatchedPairs,
} from './familyCheckout';
import { emptySide, type SideData } from './matching';
import type { Batch } from './types';

function batch(batchNumber: string, labelCode: string | null): Batch {
  return {
    id: `id-${batchNumber}`,
    batchNumber,
    batchNumberNorm: batchNumber.replace(/[^a-zA-Z0-9]/g, '').toUpperCase(),
    itemNumber: '02.0120.067.012',
    labelCode,
    status: 'pending',
  } as Batch;
}

function scanned(batchNumber: string, labelCode: string | null): SideData {
  return { ...emptySide(), batchNumber, labelCode };
}

const QR = { batch: 'qr', code: 'qr' } as const;

describe('core control — the scanned side is never filled from the D365 record', () => {
  it('dbSideFromBatch reads the expected side from the imported row', () => {
    expect(dbSideFromBatch(batch('BO1', 'US0'))).toMatchObject({ batchNumber: 'BO1', labelCode: 'US0' });
  });

  it('a label scan with no label code fails rather than borrowing the expected code', () => {
    const pair = memberPairFromLabelScan(batch('BO1', 'US0'), scanned('BO1', null), QR);
    expect(pair.label.labelCode).toBeNull();
    expect(pair.result.ok).toBe(false);
  });

  it('a wrong label code is a mismatch', () => {
    const pair = memberPairFromLabelScan(batch('BO1', 'US0'), scanned('BO1', 'WRONG'), QR);
    expect(pair.result.ok).toBe(false);
  });

  it('a matching printed label passes', () => {
    const pair = memberPairFromLabelScan(batch('BO1', 'US0'), scanned('BO1', 'US0.18 V2'), QR);
    expect(pair.result.ok).toBe(true);
  });
});

describe('compareFamily', () => {
  it('an order with no scanned members never passes', () => {
    expect(compareFamily([]).ok).toBe(false);
  });

  it('one mismatched member fails the order and is reported in run order', () => {
    const good = memberPairFromLabelScan(batch('BO1', 'US0'), scanned('BO1', 'US0'), QR);
    const bad = memberPairFromLabelScan(batch('BO1-02', 'US0'), scanned('BO1-02', 'CA0'), QR);
    expect(compareFamily([good, bad]).ok).toBe(false);
    expect(mismatchedPairs([good, bad]).map((p) => p.batchNumber)).toEqual(['BO1-02']);
  });
});

describe('keyedEntrySuffix — no-QR labels are marked in the audit trail', () => {
  it('adds nothing for a label read entirely from its QR', () => {
    expect(keyedEntrySuffix(QR)).toBe('');
  });

  it('marks a batch barcode plus a typed label code', () => {
    expect(keyedEntrySuffix({ batch: 'barcode', code: 'typed' })).toBe(
      ' [no QR — batch by barcode, label code typed]',
    );
  });
});
