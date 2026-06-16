import { normalizeId } from './normalize';

/**
 * Batch order families on the log sheet.
 *
 *   Parent (P):  BO122232       — no dash suffix, # of entries = "P" or "1"
 *   Split:       BO122232-02    — always has -NN when more than one roll
 *
 * Matching is always by the full scanned batch number against a row on the sheet.
 */

const SPLIT_SUFFIX = /-(\d{2})$/;

export function batchBaseNumber(batchNumber: string): string {
  return batchNumber.replace(SPLIT_SUFFIX, '');
}

export function splitSuffix(batchNumber: string): string | null {
  const m = batchNumber.match(SPLIT_SUFFIX);
  return m ? m[1] : null;
}

export function isParentBatch(batchNumber: string): boolean {
  return splitSuffix(batchNumber) === null;
}

/** Parse # OF ENTRIES like "P, 2-3" or "P, 2, 3, 4" into split suffixes 02, 03… */
export function parseEntrySuffixes(entries: string | null): string[] {
  if (!entries) return [];
  const rest = entries.replace(/^P\s*,?\s*/i, '').trim();
  if (!rest) return [];

  const suffixes: string[] = [];
  for (const part of rest.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (/^\d+\s*-\s*\d+$/.test(part)) {
      const [a, b] = part.split('-').map((n) => Number(n.trim()));
      for (let i = a; i <= b; i++) suffixes.push(String(i).padStart(2, '0'));
    } else {
      const n = Number(part);
      if (!Number.isNaN(n)) suffixes.push(String(n).padStart(2, '0'));
    }
  }
  return suffixes;
}

export function familyBatchNumbers(baseBatch: string, entries: string | null): string[] {
  const base = baseBatch.trim();
  const numbers = [base];
  for (const suffix of parseEntrySuffixes(entries)) {
    numbers.push(`${base}-${suffix}`);
  }
  return numbers;
}

export function findBatchByScannedValue<T extends { batchNumber: string; batchNumberNorm?: string }>(
  value: string,
  batches: T[],
): T | undefined {
  const norm = normalizeId(value);
  return batches.find(
    (b) => (b.batchNumberNorm ?? normalizeId(b.batchNumber)) === norm,
  );
}

/** PARENT, -02, or null when this batch is not part of a multi-roll family on the sheet. */
export function rollDisplayLabel(
  batchNumber: string,
  sheetBatchNumbers: string[],
): string | null {
  const base = batchBaseNumber(batchNumber);
  const family = sheetBatchNumbers.filter((n) => batchBaseNumber(n) === base);
  if (family.length <= 1) return null;
  const suffix = splitSuffix(batchNumber);
  if (suffix === null) return 'PARENT';
  return `-${suffix}`;
}
