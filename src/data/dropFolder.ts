import { invoke } from '@tauri-apps/api/core';

/**
 * The shared folder D365 exports land in.
 *
 * Someone runs the export in D365 on another PC. The sender window copies the
 * finished CSV into a folder on this station (see scripts/d365-inbox). The
 * station imports that file on its own.
 *
 * `CsvSource` is the seam. Today the only implementation reads a synced folder
 * through two Rust commands. When Graph access is approved a `GraphSource`
 * implements the same two methods against the SharePoint API and nothing above
 * this file changes — the polling, the "is it new" rule, and the banner all
 * work off the interface.
 */

/** Absolute path of the watched folder. Empty means the feature is off. */
export const DROP_FOLDER_KEY = 'lvs-drop-folder';

/**
 * How long a file must sit unchanged before it is offered.
 *
 * A CSV being copied into the folder — or streamed down by OneDrive — is
 * visible and readable while still incomplete. Importing a half-written export
 * would add some of a print run and silently skip the rest, and because
 * `importBatches` is additive and dedupes by batch number, re-importing the
 * finished file afterwards would *not* fill in the gap. Waiting is the fix.
 */
export const SETTLE_MS = 20_000;

/** How often the folder is polled while the app is open. */
export const POLL_MS = 30_000;

export interface DropFolderFile {
  name: string;
  size: number;
  modifiedMs: number | null;
  placeholder: boolean;
}

export interface CsvSource {
  readonly label: string;
  list(): Promise<DropFolderFile[]>;
  read(name: string): Promise<string>;
}

/** Reads a folder on this machine — a OneDrive sync root, or a network share. */
export class FolderSource implements CsvSource {
  readonly label: string;
  private readonly folder: string;

  constructor(folder: string) {
    this.folder = folder;
    this.label = folder;
  }

  list(): Promise<DropFolderFile[]> {
    return invoke<DropFolderFile[]>('list_drop_folder', { folder: this.folder });
  }

  read(name: string): Promise<string> {
    return invoke<string>('read_drop_file', { folder: this.folder, name });
  }
}

/** Why a file that is present is not being offered yet. */
export type HoldReason = 'downloading' | 'settling';

export interface HeldFile {
  file: DropFolderFile;
  reason: HoldReason;
}

export interface DropFolderScan {
  /** New, fully downloaded, and unchanged long enough to be safe to read. */
  ready: DropFolderFile[];
  /** New but not offerable yet, with the reason so the UI can say which. */
  held: HeldFile[];
  /** Files in the folder this station has already imported. */
  alreadyImported: number;
}

/**
 * Decide what to offer.
 *
 * "Already imported" is answered by the filenames on `import_sessions` rather
 * than by a list of seen files kept on the side. That table is already the
 * record of every CSV this station has taken in, it survives restarts, and
 * **Clear run** wipes it — which is exactly the moment re-importing the same
 * file should become possible again.
 *
 * The consequence to know about: a corrected export has to be saved under a new
 * name. Re-saving `print-run.csv` with fixed rows looks like a file that was
 * already handled. That matches how `importBatches` behaves anyway — it skips
 * batch numbers already on the page, so a same-name re-import would do nothing.
 */
export function scanDropFolder(
  files: DropFolderFile[],
  importedFilenames: Iterable<string>,
  now = Date.now(),
  settleMs = SETTLE_MS,
): DropFolderScan {
  const seen = new Set<string>();
  for (const name of importedFilenames) seen.add(name.trim().toLowerCase());

  const ready: DropFolderFile[] = [];
  const held: HeldFile[] = [];
  let alreadyImported = 0;

  for (const file of files) {
    if (seen.has(file.name.trim().toLowerCase())) {
      alreadyImported++;
      continue;
    }
    if (file.placeholder) {
      held.push({ file, reason: 'downloading' });
      continue;
    }
    // A missing timestamp is treated as settled: the file is there and readable,
    // and holding it forever because the filesystem would not say when it
    // changed would strand the import with no way for anyone to clear it.
    if (file.modifiedMs !== null && now - file.modifiedMs < settleMs) {
      held.push({ file, reason: 'settling' });
      continue;
    }
    ready.push(file);
  }

  return { ready, held, alreadyImported };
}

export function describeHold(held: HeldFile[]): string | null {
  if (held.length === 0) return null;
  const downloading = held.filter((h) => h.reason === 'downloading');
  const settling = held.filter((h) => h.reason === 'settling');
  const parts: string[] = [];
  if (downloading.length > 0) {
    parts.push(
      downloading.length === 1
        ? `${downloading[0].file.name} has not downloaded from OneDrive yet`
        : `${downloading.length} files have not downloaded from OneDrive yet`,
    );
  }
  if (settling.length > 0) {
    parts.push(
      settling.length === 1
        ? `${settling[0].file.name} is still being written`
        : `${settling.length} files are still being written`,
    );
  }
  return `${parts.join('; ')}.`;
}
