import type { Batch } from './types';

/** Full order quantity across all runs in a family. */
export function familyOrderTotal(members: Batch[]): number | null {
  const stored = members
    .map((m) => m.orderTotalQty)
    .filter((v): v is number => v != null && v > 0);
  if (stored.length > 0) return Math.max(...stored);
  const sum = members.reduce((s, m) => s + (m.quantity ?? 0), 0);
  return sum > 0 ? sum : null;
}

/** Per-label run quantity. */
export function formatRunQty(batch: Batch): string {
  return batch.quantity != null ? String(batch.quantity) : '';
}

/**
 * Per-run split size — hidden when it matches this row's qty and there is only one run.
 */
export function formatSplitQty(batch: Batch, familyMemberCount: number): string {
  if (batch.splitQty == null) return '—';
  if (familyMemberCount <= 1 && batch.splitQty === batch.quantity) return '—';
  return String(batch.splitQty);
}

export function formatOrderTotal(total: number | null): string {
  return total != null ? String(total) : '';
}
