import type { DataStore } from './DataStore';

/**
 * Daily snapshot of the station database to a folder the operator does not own
 * — a synced OneDrive folder, a network share, anywhere off this disk.
 *
 * The station holds the only copy of its audit trail. Updating the app does not
 * touch it (the database lives under the app data directory, not the install
 * directory), so the real exposure is the machine itself dying. One file a day
 * somewhere else closes that gap without a server.
 *
 * The snapshot is a complete SQLite database, so recovery is copying it back
 * over `label-verification.db` — no import step, no special tooling.
 */

/** Folder the daily snapshot is written to. Empty means backups are off. */
export const BACKUP_FOLDER_KEY = 'lvs-backup-folder';
/** ISO timestamp of the last snapshot that actually wrote a file. */
export const BACKUP_LAST_RUN_KEY = 'lvs-backup-last-run';
/**
 * Outcome of the most recent attempt, successful or not.
 *
 * Kept separately from the last *success* on purpose: a backup that has been
 * failing for a week still shows last week's success date, and only this key
 * reveals that nothing has been written since.
 */
export const BACKUP_LAST_STATUS_KEY = 'lvs-backup-last-status';

export type BackupOutcome =
  | { status: 'written'; path: string }
  | { status: 'already-today'; path: string }
  | { status: 'disabled' }
  | { status: 'unsupported' }
  | { status: 'failed'; path: string; message: string };

export function backupFilename(now = new Date()): string {
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  return `label-verification-${stamp}.db`;
}

/** Join a user-typed folder to a filename without doubling or dropping the separator. */
export function joinBackupPath(folder: string, filename: string): string {
  const trimmed = folder.trim().replace(/[\\/]+$/, '');
  const separator = trimmed.includes('/') && !trimmed.includes('\\') ? '/' : '\\';
  return `${trimmed}${separator}${filename}`;
}

/**
 * SQLite refuses to VACUUM INTO a path that already exists, and the driver
 * surfaces that as an opaque error. Distinguishing it from a real failure
 * (folder missing, no permission, disk full) is what tells the operator
 * whether anything is wrong.
 */
function looksLikeTargetExists(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes('already exists') || m.includes('output file already exists');
}

/**
 * Record what happened, so a backup that quietly stopped working is visible in
 * Admin instead of being something nobody notices until the machine dies.
 * Best-effort: if even this write fails there is nowhere left to report to.
 */
async function recordStatus(store: DataStore, outcome: BackupOutcome, now: Date): Promise<void> {
  try {
    await store.setSetting(
      BACKUP_LAST_STATUS_KEY,
      JSON.stringify({ at: now.toISOString(), text: describeBackupOutcome(outcome) }),
    );
  } catch {
    /* nothing further we can do */
  }
}

export async function runDailyBackup(
  store: DataStore,
  folder: string,
  now = new Date(),
): Promise<BackupOutcome> {
  if (!folder.trim()) return { status: 'disabled' };

  if (!store.snapshotTo) {
    const outcome: BackupOutcome = { status: 'unsupported' };
    await recordStatus(store, outcome, now);
    return outcome;
  }

  const path = joinBackupPath(folder, backupFilename(now));
  let outcome: BackupOutcome;

  try {
    await store.snapshotTo(path);
    outcome = { status: 'written', path };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    outcome = looksLikeTargetExists(message)
      ? { status: 'already-today', path }
      : { status: 'failed', path, message };
  }

  await recordStatus(store, outcome, now);
  if (outcome.status === 'written') {
    await store.setSetting(BACKUP_LAST_RUN_KEY, now.toISOString());
  }
  return outcome;
}

export interface BackupStatusRecord {
  at: string;
  text: string;
}

export function parseBackupStatus(raw: string | null): BackupStatusRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BackupStatusRecord>;
    if (typeof parsed.at !== 'string' || typeof parsed.text !== 'string') return null;
    return { at: parsed.at, text: parsed.text };
  } catch {
    return null;
  }
}

export function describeBackupOutcome(outcome: BackupOutcome): string {
  switch (outcome.status) {
    case 'written':
      return `Backed up to ${outcome.path}`;
    case 'already-today':
      return `Today's backup already exists at ${outcome.path}`;
    case 'disabled':
      return 'No backup folder set — this station has no off-machine copy.';
    case 'unsupported':
      return 'Backups need the desktop app. A browser has no filesystem to write to.';
    case 'failed':
      return `Backup failed writing ${outcome.path} — ${outcome.message}`;
  }
}
