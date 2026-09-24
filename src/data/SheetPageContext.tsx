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
import type { LogSheetPageDef } from './logSheetPages';
import { LEGACY_SHEET_PAGE_IDS, PRINT_RUN_PAGE, PRINT_RUN_PAGE_ID } from './logSheetPages';

interface SheetPageContextValue {
  activePage: LogSheetPageDef;
  activePageId: string;
  /** Batches for the current print run. */
  pageBatches: Batch[];
  clearPrintRun: () => Promise<void>;
  loading: boolean;
}

const SheetPageContext = createContext<SheetPageContextValue | null>(null);

export function SheetPageProvider({ children }: { children: ReactNode }) {
  const { store, batches, refreshBatches, refreshImportSessions, logAudit } = useAppData();
  const [loading, setLoading] = useState(true);

  const pageBatches = useMemo(
    () => batches.filter((b) => b.sheetPageId === PRINT_RUN_PAGE_ID),
    [batches],
  );

  const clearPrintRun = useCallback(async () => {
    await store.deletePageData(PRINT_RUN_PAGE_ID);
    await refreshBatches();
    await refreshImportSessions();
    await logAudit({
      type: 'sheet_reset',
      operatorId: null,
      operatorName: null,
      batchNumber: null,
      detail: 'Cleared print run — all batches removed',
    });
  }, [store, refreshBatches, refreshImportSessions, logAudit]);

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
      clearPrintRun,
      loading,
    }),
    [pageBatches, clearPrintRun, loading],
  );

  return <SheetPageContext.Provider value={value}>{children}</SheetPageContext.Provider>;
}

export function useSheetPage(): SheetPageContextValue {
  const ctx = useContext(SheetPageContext);
  if (!ctx) throw new Error('useSheetPage must be used within SheetPageProvider');
  return ctx;
}
