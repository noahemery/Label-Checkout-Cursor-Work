import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useAppData } from './AppDataContext';
import { syncInbox } from './inboxImport';
import type { StationLastImport } from './inboxStatus';
import { useDropFolder } from './useDropFolder';
import type { DropFolderFile } from './dropFolder';

export interface InboxNotice {
  line: string | null;
  bad: boolean;
}

const InboxStatusContext = createContext<InboxNotice>({ line: null, bad: false });

/** One sync at a time. A second poll waits, then sees the ledger the first one wrote. */
let syncChain: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): Promise<void> {
  const run = syncChain.then(task, task);
  syncChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * While the station is open, finished CSVs in the inbox folder become sheets
 * and the sheet list is written back for the D365 PC window.
 */
export function InboxSync({ children }: { children: ReactNode }) {
  const notice = useInboxSync();
  return <InboxStatusContext.Provider value={notice}>{children}</InboxStatusContext.Provider>;
}

export function useInboxStatus(): InboxNotice {
  return useContext(InboxStatusContext);
}

function useInboxSync(): InboxNotice {
  const { store, importSessions, refreshBatches, refreshImportSessions, logAudit } = useAppData();
  const dropFolder = useDropFolder();
  const [notice, setNotice] = useState<InboxNotice>({ line: null, bad: false });
  const lastImportRef = useRef<StationLastImport | null>(null);
  const sessionsKey = importSessions.map((session) => `${session.id}:${session.active}`).join('|');
  const ready = dropFolder.scan?.ready;

  useEffect(() => {
    const folder = dropFolder.folder.trim();
    if (!dropFolder.enabled || !folder) return;
    let cancelled = false;
    const files: DropFolderFile[] = ready ?? [];
    void enqueue(async () => {
      try {
        const result = await syncInbox({
          store,
          folder,
          ready: files,
          readFile: dropFolder.read,
          logAudit,
          lastImport: lastImportRef.current,
        });
        lastImportRef.current = result.lastImport;
        if (cancelled) return;
        setNotice({ line: result.statusLine, bad: Boolean(result.lastImport?.error) });
        if (result.changed) {
          await refreshBatches();
          await refreshImportSessions();
        }
      } catch (err) {
        if (cancelled) return;
        setNotice({
          line: err instanceof Error ? err.message : 'Could not update the inbox.',
          bad: true,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    dropFolder.enabled,
    dropFolder.folder,
    dropFolder.read,
    logAudit,
    ready,
    refreshBatches,
    refreshImportSessions,
    sessionsKey,
    store,
  ]);

  return notice;
}
