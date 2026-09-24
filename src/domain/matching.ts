import { normalizeId } from './normalize';

/**
 * One side of a label comparison.
 *
 * The two sides are:
 *   label    — read off the physical printed label (`LBL|` QR, or hand-typed)
 *   expected — the D365 record for the member the order is currently on,
 *              built by `dbSideFromBatch` in ./familyCheckout
 *
 * The label side must carry a batch number AND a label code before a verdict
 * is computed, and it is only ever filled from what the operator scanned or
 * typed off the physical artifact — never merged with the expected side. The
 * operator's attestation lives one level up: they pick the order, work its
 * labels in order, and sign the whole thing with their badge. See AGENTS.md.
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

/**
 * Label code comparison.
 *
 * D365 carries a short code in its `Label` column — a country/region code for
 * most products (`US0`, `GT0`, `CA0`, `JP0`, `SA6`) and a product-specific one
 * for a few (`PET`, `PURINA`, `999`). The printed roll extends that code with a
 * year and version, so BarTender puts `US0.18 V2` where D365 says `US0`.
 *
 * Matching therefore anchors on the D365 value as a *prefix* of what was
 * scanned: the code that identifies the label stock must agree, while the year
 * and version that only exist on the roll are ignored. A prefix rule handles
 * the longer codes correctly too — `PURINA` will not be satisfied by `PET`.
 */
export function labelCodeMatches(
  scanned: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!scanned || !expected) return false;
  return normalizeId(scanned).startsWith(normalizeId(expected));
}

export interface MatchResult {
  ok: boolean;
  comparisons: FieldComparison[];
}

export function compareSides(label: SideData, sheet: SideData): MatchResult {
  const comparisons: FieldComparison[] = [];

  const compare = (
    field: string,
    a: string | null,
    b: string | null,
    required: boolean,
    matches: (a: string, b: string) => boolean = (x, y) => normalizeId(x) === normalizeId(y),
  ) => {
    if (!required && (!a || !b)) return; // optional fields only compared when both present
    const ok = !!a && !!b && matches(a, b);
    comparisons.push({ field, labelValue: a ?? '—', sheetValue: b ?? '—', ok });
  };

  compare('Batch number', label.batchNumber, sheet.batchNumber, true);
  compare('Label code', label.labelCode, sheet.labelCode, true, labelCodeMatches);
  compare('Item number', label.itemNumber, sheet.itemNumber, false);

  return { ok: comparisons.every((c) => c.ok), comparisons };
}
