import type { BatchFamilyGroup } from './batchFamily';
import { familyStatusRank } from './batchFamily';
import type { ImportSession } from './types';

export type QueueSortMode = 'delivery' | 'sheet';

const STORAGE_KEY = 'lvs-queue-sort';

export function loadQueueSort(): QueueSortMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'sheet' || v === 'delivery') return v;
  } catch {
    /* ignore */
  }
  return 'delivery';
}

export function saveQueueSort(mode: QueueSortMode): void {
  localStorage.setItem(STORAGE_KEY, mode);
}

/** Tolerant parse for D365 delivery strings — sort only; display stays raw. */
export function parseDeliveryDate(raw: string | null | undefined): Date | null {
  if (!raw?.trim()) return null;
  const s = raw.trim();

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
  if (us) {
    let y = Number(us[3]);
    if (y < 100) y += 2000;
    const d = new Date(y, Number(us[1]) - 1, Number(us[2]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

export function sortFamilies(
  groups: BatchFamilyGroup[],
  mode: QueueSortMode,
  sessionsById: Map<string, ImportSession>,
): BatchFamilyGroup[] {
  return [...groups].sort((a, b) => {
    const rank = familyStatusRank(a.members) - familyStatusRank(b.members);
    if (rank !== 0) return rank;

    if (mode === 'delivery') {
      const da = parseDeliveryDate(a.parent.deliveryDate);
      const db = parseDeliveryDate(b.parent.deliveryDate);
      if (da && db) {
        const diff = da.getTime() - db.getTime();
        if (diff !== 0) return diff;
      } else if (da && !db) return -1;
      else if (!da && db) return 1;
      return a.parent.batchNumber.localeCompare(b.parent.batchNumber);
    }

    const sa = a.parent.importId ? sessionsById.get(a.parent.importId) : null;
    const sb = b.parent.importId ? sessionsById.get(b.parent.importId) : null;
    const ta = sa?.importedAt ?? '';
    const tb = sb?.importedAt ?? '';
    if (ta !== tb) return tb.localeCompare(ta);
    return a.parent.batchNumber.localeCompare(b.parent.batchNumber);
  });
}
