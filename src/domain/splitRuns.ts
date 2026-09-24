/**
 * D365 "Split" column — max quantity per production run when the full order
 * cannot be printed in one go. Child batches (-02, -03, …) get one run each.
 *
 * Example: total 900, split 250 → runs [250, 250, 250, 150] (remainder last).
 */

/** Compute per-run quantities; empty split means a single run of the full total. */
export function computeRunQuantities(total: number, splitQty: number | null | undefined): number[] {
  if (total <= 0) return [];
  if (!splitQty || splitQty <= 0 || splitQty >= total) return [total];

  const runs: number[] = [];
  let remaining = total;
  while (remaining > 0) {
    const chunk = Math.min(splitQty, remaining);
    runs.push(chunk);
    remaining -= chunk;
  }
  return runs;
}

/**
 * Human-readable run breakdown — e.g. `1000 × 3` or `250 × 3 + 150`.
 * Returns `—` for a single run (nothing to show).
 */
export function formatRunsSummary(
  total: number | null | undefined,
  splitQty: number | null | undefined,
): string {
  if (total == null || total <= 0) return '—';
  const runs = computeRunQuantities(total, splitQty);
  if (runs.length <= 1) return '—';
  return formatRunsCompact(runs);
}

function formatRunsCompact(runs: number[]): string {
  const allSame = runs.every((r) => r === runs[0]);
  if (allSame) {
    return `${formatQty(runs[0]!)} × ${runs.length}`;
  }

  const last = runs[runs.length - 1]!;
  const rest = runs.slice(0, -1);
  if (rest.length > 0 && rest.every((r) => r === rest[0]) && last !== rest[0]) {
    if (rest.length === 1) {
      return `${formatQty(rest[0]!)} + ${formatQty(last)}`;
    }
    return `${formatQty(rest[0]!)} × ${rest.length} + ${formatQty(last)}`;
  }

  const parts: string[] = [];
  let i = 0;
  while (i < runs.length) {
    const v = runs[i]!;
    let count = 1;
    while (i + count < runs.length && runs[i + count] === v) count++;
    parts.push(count === 1 ? formatQty(v) : `${formatQty(v)} × ${count}`);
    i += count;
  }
  return parts.join(' + ');
}

function formatQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}
