import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppData } from './AppDataContext';
import {
  DROP_FOLDER_KEY,
  FolderSource,
  POLL_MS,
  scanDropFolder,
  type CsvSource,
  type DropFolderFile,
  type DropFolderScan,
} from './dropFolder';
import { isTauriRuntime } from './createStore';

/**
 * Watches the shared folder for D365 exports this station has not imported.
 *
 * Polling rather than a filesystem watcher on purpose: OneDrive materialises a
 * synced file in several steps, and a watcher fires on each one. A poll that
 * only reports files which have been unchanged for a while (see `SETTLE_MS`)
 * sees the finished article instead of three-quarters of it.
 *
 * Finding a file is all this does. Importing it is still a decision someone
 * makes, because the batch log is what operators check labels against and
 * nothing should appear there that nobody chose to put there.
 */
export interface DropFolderState {
  /** False when no folder is configured, or in a browser with no filesystem. */
  enabled: boolean;
  folder: string;
  scan: DropFolderScan | null;
  /** Folder unreachable, permission denied — shown to a supervisor, not the floor. */
  error: string | null;
  checking: boolean;
  /** Read one of the files the scan turned up. */
  read: (name: string) => Promise<string>;
  refresh: () => void;
}

export function useDropFolder(): DropFolderState {
  const { store, importSessions } = useAppData();
  const [folder, setFolder] = useState('');
  const [files, setFiles] = useState<DropFolderFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void store
      .getSetting(DROP_FOLDER_KEY)
      .then((v) => {
        if (!cancelled) setFolder(v ?? '');
      })
      .catch(() => {
        if (!cancelled) setFolder('');
      });
    return () => {
      cancelled = true;
    };
  }, [store, tick]);

  const source: CsvSource | null = useMemo(
    () => (isTauriRuntime() && folder.trim() ? new FolderSource(folder.trim()) : null),
    [folder],
  );

  useEffect(() => {
    if (!source) return;

    let cancelled = false;

    const check = async () => {
      setChecking(true);
      try {
        const found = await source.list();
        if (cancelled) return;
        setFiles(found);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setFiles([]);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setChecking(false);
      }
    };

    void check();
    const id = window.setInterval(() => void check(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [source, tick]);

  // What counts as "already imported" is the filenames on import_sessions, so
  // deriving the scan rather than storing it means a finished import drops the
  // file out of the banner immediately instead of after the next poll.
  const scan = useMemo(
    () => (source && files ? scanDropFolder(files, importSessions.map((s) => s.filename)) : null),
    [source, files, importSessions],
  );

  const read = useCallback(
    async (name: string) => {
      if (!source) throw new Error('No drop folder is configured on this station.');
      return source.read(name);
    },
    [source],
  );

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  return {
    enabled: source !== null,
    folder,
    scan,
    error,
    checking,
    read,
    refresh,
  };
}
