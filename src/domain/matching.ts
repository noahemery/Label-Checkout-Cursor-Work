import { normalizeId } from './normalize';

/**
 * One side of the two-scan handshake.
 * Side 1 = the physical printed label. Side 2 = the paper log sheet row.
 *
 * Strict matching rule: BOTH sides must explicitly carry a batch number AND
 * a label code (scanned or hand-typed from the physical artifact) before a
 * verdict is computed. Values are never auto-filled from the database.
 */
export interface SideData {
  batchNumber: string | null;
  itemNumber: string | null;
  labelCode: string | null;
  /** True when the batch number matched a row already in the queue. */
  knownBatch: boolean;
}

export function emptySide(): SideData {
  return { batchNumber: null, itemNumber: null, labelCode: null, knownBatch: false };
}

export function sideComplete(s: SideData): boolean {
  return !!s.batchNumber && !!s.labelCode;
}

export interface FieldComparison {
  field: string;
  labelValue: string;
  sheetValue: string;
  ok: boolean;
}

export interface MatchResult {
  ok: boolean;
  comparisons: FieldComparison[];
}

export function compareSides(label: SideData, sheet: SideData): MatchResult {
  const comparisons: FieldComparison[] = [];

  const compare = (field: string, a: string | null, b: string | null, required: boolean) => {
    if (!required && (!a || !b)) return; // optional fields only compared when both present
    const ok = !!a && !!b && normalizeId(a) === normalizeId(b);
    comparisons.push({ field, labelValue: a ?? '—', sheetValue: b ?? '—', ok });
  };

  compare('Batch number', label.batchNumber, sheet.batchNumber, true);
  compare('Label code', label.labelCode, sheet.labelCode, true);
  compare('Item number', label.itemNumber, sheet.itemNumber, false);

  return { ok: comparisons.every((c) => c.ok), comparisons };
}
