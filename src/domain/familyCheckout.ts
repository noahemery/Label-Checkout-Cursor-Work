import type { MatchResult, SideData } from './matching';
import { compareSides } from './matching';
import type { Batch } from './types';

/**
 * Order checkout.
 *
 * The operator picks an order in the batch log, which opens it immediately,
 * then works its labels in run order: the parent first, then each split run.
 * Every label is compared against the D365 record for that member.
 *
 * A mismatch does not abort the order — the operator still needs to get the
 * rest of the run's labels out. It is recorded against that member and the
 * order advances, so the badge tap at the end resolves the whole order at
 * once: matched members are checked out, mismatched members are flagged for a
 * supervisor. Nothing is written until that badge tap.
 *
 * The operator attests to the *order context*. The machine checks *label
 * identity*. See the core control section in AGENTS.md.
 */

export type FamilyCheckoutPhase = 'scanning' | 'complete';

/**
 * How each half of the label side reached the station. A label printed
 * without a QR has its batch number on a 1D barcode and its label code only
 * as printed text, so the code is typed.
 */
export interface LabelEntry {
  batch: 'qr' | 'barcode' | 'typed' | null;
  code: 'qr' | 'typed' | null;
}

export function emptyLabelEntry(): LabelEntry {
  return { batch: null, code: null };
}

/** True when any part of the label side was not read from a QR. */
export function isKeyedEntry(entry: LabelEntry): boolean {
  return entry.batch !== 'qr' || entry.code !== 'qr';
}

/** Audit suffix for a member that was not checked by its QR, or '' when it was. */
export function keyedEntrySuffix(entry: LabelEntry): string {
  if (!isKeyedEntry(entry)) return '';
  const batch = entry.batch === 'barcode' ? 'batch by barcode' : `batch ${entry.batch ?? 'unknown'}`;
  const code = entry.code === 'typed' ? 'label code typed' : `label code ${entry.code ?? 'unknown'}`;
  return ` [no QR — ${batch}, ${code}]`;
}

export interface FamilyMemberPair {
  batchId: string;
  batchNumber: string;
  /** Read off the printed label. */
  label: SideData;
  /** How the label side was entered. */
  entry: LabelEntry;
  /** Built from the D365 record for this member — never operator input. */
  expected: SideData;
  result: MatchResult;
}

export interface FamilyCheckoutState {
  phase: FamilyCheckoutPhase;
  parentBatchId: string;
  parentBatchNumber: string;
  memberBatchIds: string[];
  currentMemberIndex: number;
  /** Every member scanned so far, matched or not, in run order. */
  completedPairs: FamilyMemberPair[];
  /** Batch number recorded by the previous label scan, for the "next up" line. */
  lastRecordedBatchNumber: string | null;
}

/**
 * The expected values for a member, read from the imported D365 row.
 *
 * This is deliberately named for its origin: it is the database side of the
 * comparison, and it must never be merged into the operator's scanned side.
 */
export function dbSideFromBatch(batch: Batch): SideData {
  return {
    batchNumber: batch.batchNumber,
    itemNumber: batch.itemNumber,
    labelCode: batch.labelCode,
    knownBatch: true,
  };
}

/** True when the D365 row carries enough data to be checked at all. */
export function batchIsCheckable(batch: Batch): boolean {
  return !!batch.batchNumber && !!batch.labelCode;
}

export function memberPairFromLabelScan(
  batch: Batch,
  label: SideData,
  entry: LabelEntry,
): FamilyMemberPair {
  const expected = dbSideFromBatch(batch);
  return {
    batchId: batch.id,
    batchNumber: batch.batchNumber,
    label,
    entry,
    expected,
    result: compareSides(label, expected),
  };
}

/** Members that did not match, in run order. */
export function mismatchedPairs(pairs: FamilyMemberPair[]): FamilyMemberPair[] {
  return pairs.filter((p) => !p.result.ok);
}

export function compareFamily(pairs: FamilyMemberPair[]): MatchResult {
  if (pairs.length === 0) {
    return {
      ok: false,
      comparisons: [{ field: 'Order', labelValue: '—', sheetValue: '—', ok: false }],
    };
  }
  const comparisons = pairs.flatMap((pair) =>
    pair.result.comparisons.map((c) => ({
      ...c,
      field: `${pair.batchNumber} · ${c.field}`,
    })),
  );
  return { ok: pairs.every((p) => p.result.ok), comparisons };
}
