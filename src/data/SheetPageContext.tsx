import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { normalizeId } from '../domain/normalize';
import type { Batch } from '../domain/types';
import type { BatchInput } from './DataStore';
import { useAppData } from './AppDataContext';
import type { LogSheetPageDef, SheetLabelRef } from './logSheetPages';
import { LOG_SHEET_PAGES } from './logSheetPages';
import { compressImageFile } from '../utils/compressImage';

const ACTIVE_PAGE_KEY = 'lvs-active-sheet-page';

interface SheetPageContextValue {
  pages: LogSheetPageDef[];
  activePage: LogSheetPageDef;
  activePageId: string;
  /** Batches for the active page only — check-out memory is per sheet. */
  pageBatches: Batch[];
  sheetPhotoUrl: string | null;
  uploadError: string | null;
  selectPage: (pageId: string) => Promise<void>;
  uploadSheetPhoto: (file: File) => Promise<void>;
  resetSheetPage: (pageId: string) => Promise<void>;
  loading: boolean;
}

const SheetPageContext = createContext<SheetPageContextValue | null>(null);

function labelToBatchInput(pageId: string, label: SheetLabelRef): BatchInput {
  return {
    batchNumber: label.batchNumber,
    itemNumber: label.itemNumber,
    productName: label.productName,
    labelCode: label.labelCode,
    upc: label.upc || null,
    quantity: label.quantity,
    dom: label.dom,
    doe: label.doe,
    source: 'manual',
    sheetPageId: pageId,
  };
}

export function SheetPageProvider({ children }: { children: ReactNode }) {
  const { store, batches, refreshBatches, logAudit } = useAppData();
  const [activePageId, setActivePageId] = useState(
    () => localStorage.getItem(ACTIVE_PAGE_KEY) ?? LOG_SHEET_PAGES[0].id,
  );
  const [sheetPhotoUrl, setSheetPhotoUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const activePage = useMemo(
    () => LOG_SHEET_PAGES.find((p) => p.id === activePageId) ?? LOG_SHEET_PAGES[0],
    [activePageId],
  );

  const pageBatches = useMemo(() => {
    const activeNorms = new Set(activePage.labels.map((l) => normalizeId(l.batchNumber)));
    return batches.filter(
      (b) =>
        b.sheetPageId === activePageId ||
        (!b.sheetPageId && activeNorms.has(b.batchNumberNorm)),
    );
  }, [batches, activePageId, activePage]);

  const resolvePhoto = useCallback(
    async (page: LogSheetPageDef): Promise<string | null> => {
      const uploaded = await store.getSheetPhoto(page.id);
      if (uploaded) return uploaded;
      return page.defaultSheetPhotoUrl;
    },
    [store],
  );

  /** Add missing rows for this page only — never deletes other pages' batches. */
  const syncPageQueue = useCallback(
    async (page: LogSheetPageDef, quiet = false) => {
      const onPage = await store.getBatchesForPage(page.id);
      const existingByNorm = new Map(onPage.map((b) => [b.batchNumberNorm, b]));
      let added = 0;

      for (const label of page.labels) {
        const norm = normalizeId(label.batchNumber);
        if (!existingByNorm.has(norm)) {
          await store.addBatch(labelToBatchInput(page.id, label));
          added++;
        }
      }

      await refreshBatches();
      if (!quiet) {
        await logAudit({
          type: 'page_select',
          operatorId: null,
          operatorName: null,
          batchNumber: null,
          detail: `Log sheet ${page.referenceNumber} — ${page.labels.length} row(s)${added ? `, ${added} new` : ', memory preserved'}`,
        });
      }
    },
    [store, refreshBatches, logAudit],
  );

  const selectPage = useCallback(
    async (pageId: string) => {
      const page = LOG_SHEET_PAGES.find((p) => p.id === pageId);
      if (!page) return;
      setActivePageId(pageId);
      localStorage.setItem(ACTIVE_PAGE_KEY, pageId);
      setLoading(true);
      setUploadError(null);
      await syncPageQueue(page);
      setSheetPhotoUrl(await resolvePhoto(page));
      setLoading(false);
    },
    [syncPageQueue, resolvePhoto],
  );

  const uploadSheetPhoto = useCallback(
    async (file: File) => {
      setUploadError(null);
      try {
        const dataUrl = await compressImageFile(file);
        await store.saveSheetPhoto(activePage.id, dataUrl);
        setSheetPhotoUrl(dataUrl);
        await logAudit({
          type: 'sheet_photo',
          operatorId: null,
          operatorName: null,
          batchNumber: null,
          detail: `Uploaded photo of physical log sheet ${activePage.referenceNumber}`,
        });
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Upload failed — try a smaller photo or a JPG/PNG file.';
        setUploadError(msg);
        throw err;
      }
    },
    [store, activePage, logAudit],
  );

  const resetSheetPage = useCallback(
    async (pageId: string) => {
      const page = LOG_SHEET_PAGES.find((p) => p.id === pageId);
      if (!page) return;
      await store.deletePageData(pageId);
      await refreshBatches();
      await syncPageQueue(page, true);
      setSheetPhotoUrl(await resolvePhoto(page));
      await logAudit({
        type: 'sheet_reset',
        operatorId: null,
        operatorName: null,
        batchNumber: null,
        detail: `Reset log sheet ${page.referenceNumber} — all check-outs and uploaded photo cleared`,
      });
    },
    [store, refreshBatches, syncPageQueue, resolvePhoto, logAudit],
  );

  useEffect(() => {
    void (async () => {
      const MIGRATE = 'lvs-batch-page-id-v1';
      if (!localStorage.getItem(MIGRATE)) {
        localStorage.setItem(MIGRATE, '1');
        for (const page of LOG_SHEET_PAGES) {
          const norms = page.labels.map((l) => normalizeId(l.batchNumber));
          await store.assignOrphanBatches(page.id, norms);
        }
        await refreshBatches();
      }
      await syncPageQueue(activePage, true);
      setSheetPhotoUrl(await resolvePhoto(activePage));
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  const value = useMemo(
    () => ({
      pages: LOG_SHEET_PAGES,
      activePage,
      activePageId,
      pageBatches,
      sheetPhotoUrl,
      uploadError,
      selectPage,
      uploadSheetPhoto,
      resetSheetPage,
      loading,
    }),
    [
      activePage,
      activePageId,
      pageBatches,
      sheetPhotoUrl,
      uploadError,
      selectPage,
      uploadSheetPhoto,
      resetSheetPage,
      loading,
    ],
  );

  return <SheetPageContext.Provider value={value}>{children}</SheetPageContext.Provider>;
}

export function useSheetPage(): SheetPageContextValue {
  const ctx = useContext(SheetPageContext);
  if (!ctx) throw new Error('useSheetPage must be used within SheetPageProvider');
  return ctx;
}
