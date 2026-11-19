import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { Batch } from '../domain/types';
import { useAppData } from './AppDataContext';
import type { DeleteImportResult } from './DataStore';
import type { LogSheetPageDef } from './logSheetPages';
import { LEGACY_SHEET_PAGE_IDS, PRINT_RUN_PAGE, PRINT_RUN_PAGE_ID } from './logSheetPages';

interface SheetPageContextValue {
  activePage: LogSheetPageDef;
  activePageId: string;
  /** Batches from CSVs currently marked active on the live log. */
  pageBatches: Batch[];
  setImportActive: (importId: string, active: boolean) => Promise<void>;
  /** Remove a CSV from this station so its labels leave the log and it can be imported again. */
  deleteImportedSheet: (importId: string) => Promise<DeleteImportResult>;
  loading: boolean;
}

const SheetPageContext = createContext<SheetPageContextValue | null>(null);

export function SheetPageProvider({ children }: { children: ReactNode }) {
  const { store, batches, importSessions, refreshBatches, refreshImportSessions, logAudit } =
    useAppData();
  const [loading, setLoading] = useState(true);

  const hiddenImportIds = useMemo(() => {
    const ids = new Set<string>();
    for (const session of importSessions) {
      if (session.active === false) ids.add(session.id);
    }
    return ids;
  }, [importSessions]);

  const pageBatches = useMemo(
    () =>
      batches.filter((b) => {
        if (b.sheetPageId !== PRINT_RUN_PAGE_ID) return false;
        if (b.importId && hiddenImportIds.has(b.importId)) return false;
        return true;
      }),
    [batches, hiddenImportIds],
  );

  const setImportActive = useCallback(
    async (importId: string, active: boolean) => {
      const session = importSessions.find((s) => s.id === importId);
      await store.setImportSessionActive(importId, active);
      await refreshImportSessions();
      await logAudit({
        type: active ? 'import_shown' : 'import_hidden',
        operatorId: null,
        operatorName: null,
        batchNumber: null,
        detail: active
          ? `Showed "${session?.filename ?? importId}" on the live log`
          : `Hid "${session?.filename ?? importId}" from the live log — rows kept`,
      });
    },
    [store, importSessions, refreshImportSessions, logAudit],
  );

  const deleteImportedSheet = useCallback(
    async (importId: string) => {
      const session = importSessions.find((s) => s.id === importId);
      const result = await store.deleteImportSession(importId);
      await refreshBatches();
      await refreshImportSessions();
      await logAudit({
        type: 'import_deleted',
        operatorId: null,
        operatorName: null,
        batchNumber: null,
        detail: `Removed "${session?.filename ?? result.filename}" from the station — ${result.deleted} label${result.deleted === 1 ? '' : 's'} deleted. Audit trail kept.`,
      });
      return result;
    },
    [store, importSessions, refreshBatches, refreshImportSessions, logAudit],
  );

  useEffect(() => {
    void (async () => {
      const MIGRATE = 'lvs-print-run-v2';
      if (!localStorage.getItem(MIGRATE)) {
        localStorage.setItem(MIGRATE, '1');
        for (const pageId of LEGACY_SHEET_PAGE_IDS) {
          await store.deletePageData(pageId);
        }
        const all = await store.getBatches();
        for (const batch of all) {
          if (batch.sheetPageId !== PRINT_RUN_PAGE_ID) {
            await store.deleteBatch(batch.id);
          }
        }
        await refreshBatches();
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  const value = useMemo(
    () => ({
      activePage: PRINT_RUN_PAGE,
      activePageId: PRINT_RUN_PAGE_ID,
      pageBatches,
      setImportActive,
      deleteImportedSheet,
      loading,
    }),
    [pageBatches, setImportActive, deleteImportedSheet, loading],
  );

  return <SheetPageContext.Provider value={value}>{children}</SheetPageContext.Provider>;
}

export function useSheetPage(): SheetPageContextValue {
  const ctx = useContext(SheetPageContext);
  if (!ctx) throw new Error('useSheetPage must be used within SheetPageProvider');
  return ctx;
}
