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

export interface FamilyMemberPair {
  batchId: string;
  batchNumber: string;
  /** Read off the printed label. */
  label: SideData;
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

export function memberPairFromLabelScan(batch: Batch, label: SideData): FamilyMemberPair {
  const expected = dbSideFromBatch(batch);
  return {
    batchId: batch.id,
    batchNumber: batch.batchNumber,
    label,
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
