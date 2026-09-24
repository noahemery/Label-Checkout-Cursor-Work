import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuditEvent, Batch, ImportSession, Operator } from '../domain/types';
import type { AuditInput, DataStore } from './DataStore';
import { createStore, type StoreKind } from './createStore';

/**
 * Holds the DataStore instance plus in-memory caches of batches, operators,
 * import sessions, and the audit trail. All mutations go through the store,
 * then refresh the relevant cache.
 *
 * The backend is chosen at runtime — SQLite on the desktop build, IndexedDB in
 * a browser — so opening it is asynchronous. Children are not rendered until
 * the store is ready, which keeps every consumer below this point unchanged.
 */

interface AppDataContextValue {
  store: DataStore;
  storeKind: StoreKind;
  batches: Batch[];
  importSessions: ImportSession[];
  importSessionsById: Map<string, ImportSession>;
  operators: Operator[];
  audit: AuditEvent[];
  refreshBatches: () => Promise<void>;
  refreshImportSessions: () => Promise<void>;
  refreshOperators: () => Promise<void>;
  refreshAudit: () => Promise<void>;
  logAudit: (input: AuditInput) => Promise<void>;
}

const AppDataContext = createContext<AppDataContextValue | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<DataStore | null>(null);
  const [storeKind, setStoreKind] = useState<StoreKind | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const [batches, setBatches] = useState<Batch[]>([]);
  const [importSessions, setImportSessions] = useState<ImportSession[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);

  useEffect(() => {
    let cancelled = false;
    void createStore()
      .then((created) => {
        if (cancelled) return;
        setStore(created.store);
        setStoreKind(created.kind);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setOpenError(
          err instanceof Error ? err.message : 'The local database could not be opened.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshBatches = useCallback(async () => {
    if (!store) return;
    setBatches(await store.getBatches());
  }, [store]);

  const refreshImportSessions = useCallback(async () => {
    if (!store) return;
    setImportSessions(await store.getImportSessions());
  }, [store]);

  const importSessionsById = useMemo(
    () => new Map(importSessions.map((s) => [s.id, s])),
    [importSessions],
  );

  const refreshOperators = useCallback(async () => {
    if (!store) return;
    setOperators(await store.getOperators());
  }, [store]);

  const refreshAudit = useCallback(async () => {
    if (!store) return;
    setAudit(await store.getAuditEvents());
  }, [store]);

  const logAudit = useCallback(
    async (input: AuditInput) => {
      if (!store) return;
      const event = await store.saveScanEvent(input);
      // Prepend locally instead of re-reading the table on every scan.
      setAudit((prev) => [event, ...prev].slice(0, 300));
    },
    [store],
  );

  useEffect(() => {
    if (!store) return;
    void refreshBatches();
    void refreshImportSessions();
    void refreshOperators();
    void refreshAudit();
  }, [store, refreshBatches, refreshImportSessions, refreshOperators, refreshAudit]);

  const value = useMemo(
    () =>
      store && storeKind
        ? {
            store,
            storeKind,
            batches,
            importSessions,
            importSessionsById,
            operators,
            audit,
            refreshBatches,
            refreshImportSessions,
            refreshOperators,
            refreshAudit,
            logAudit,
          }
        : null,
    [
      store,
      storeKind,
      batches,
      importSessions,
      importSessionsById,
      operators,
      audit,
      refreshBatches,
      refreshImportSessions,
      refreshOperators,
      refreshAudit,
      logAudit,
    ],
  );

  if (openError) {
    return (
      <div className="storage-gate storage-gate-error" role="alert">
        <h1 className="storage-gate-title">The local database could not be opened</h1>
        <p className="storage-gate-body">{openError}</p>
        <p className="storage-gate-hint">
          Nothing has been lost. Close the application and start it again. If this keeps
          happening, tell a supervisor before checking out any labels.
        </p>
      </div>
    );
  }

  if (!value) {
    return (
      <div className="storage-gate" role="status">
        <p className="storage-gate-body">Opening the label database…</p>
      </div>
    );
  }

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataContextValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider');
  return ctx;
}
