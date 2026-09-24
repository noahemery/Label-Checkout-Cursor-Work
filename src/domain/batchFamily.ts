import type { Batch, BatchStatus } from './types';

/**
 * Batch order families within a print run.
 *
 *   Parent:  BO636845       — no dash suffix; the first (or only) production run
 *   Split:   BO636845-02    — one child per additional run, from the D365 Split column
 *
 * Matching is always by the full batch number, never by the base.
 */

const SPLIT_SUFFIX = /-(\d{2})$/;
const ANY_TRAILING_RUN_SUFFIX = /-(\d+)$/;

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

/**
 * Ends in -digits, but not the canonical two-digit run suffix. Such a batch is
 * not recognised as a child at all, so it would silently import as its own order.
 */
export function hasMalformedRunSuffix(batchNumber: string): boolean {
  const m = batchNumber.match(ANY_TRAILING_RUN_SUFFIX);
  return m !== null && m[1].length !== 2;
}

export interface BatchFamilyGroup {
  /** Parent batch (no -NN suffix) or the only batch in a standalone order. */
  parent: Batch;
  /** Child batches (-02, -03, …), sorted by suffix. */
  children: Batch[];
  /** All members including parent, in run order. */
  members: Batch[];
}

const STATUS_RANK: Record<BatchStatus, number> = {
  flagged: 0,
  pending: 1,
  verified: 2,
};

/** Worst status in a family drives sort order (flagged first). */
export function familyStatusRank(members: Batch[]): number {
  return Math.min(...members.map((m) => STATUS_RANK[m.status]));
}

function familySortRank(members: Batch[]): number {
  return familyStatusRank(members);
}

export function groupBatchesIntoFamilies(batches: Batch[]): BatchFamilyGroup[] {
  const byBase = new Map<string, Batch[]>();
  for (const b of batches) {
    const base = batchBaseNumber(b.batchNumber);
    const list = byBase.get(base) ?? [];
    list.push(b);
    byBase.set(base, list);
  }

  const groups: BatchFamilyGroup[] = [];
  for (const members of byBase.values()) {
    members.sort((a, b) => {
      const sa = splitSuffix(a.batchNumber) ?? '00';
      const sb = splitSuffix(b.batchNumber) ?? '00';
      return sa.localeCompare(sb);
    });
    const parent = members.find((m) => splitSuffix(m.batchNumber) === null) ?? members[0];
    const children = members.filter((m) => splitSuffix(m.batchNumber) !== null);
    groups.push({ parent, children, members });
  }

  return groups.sort((a, b) => {
    const rank = familySortRank(a.members) - familySortRank(b.members);
    if (rank !== 0) return rank;
    return a.parent.batchNumber.localeCompare(b.parent.batchNumber);
  });
}
