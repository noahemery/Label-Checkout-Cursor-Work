import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuditEvent, Batch, Operator } from '../domain/types';
import type { AuditInput, DataStore } from './DataStore';
import { IndexedDbStore } from './IndexedDbStore';

/**
 * Holds the DataStore instance plus in-memory caches of batches, operators
 * and the audit trail. All mutations go through the store, then refresh the
 * relevant cache. Swapping to an Azure-backed store later only changes the
 * `new IndexedDbStore()` line below.
 */

interface AppDataContextValue {
  store: DataStore;
  batches: Batch[];
  operators: Operator[];
  audit: AuditEvent[];
  refreshBatches: () => Promise<void>;
  refreshOperators: () => Promise<void>;
  refreshAudit: () => Promise<void>;
  logAudit: (input: AuditInput) => Promise<void>;
}

const AppDataContext = createContext<AppDataContextValue | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<DataStore | null>(null);
  if (!storeRef.current) storeRef.current = new IndexedDbStore();
  const store = storeRef.current;

  const [batches, setBatches] = useState<Batch[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);

  const refreshBatches = useCallback(async () => {
    setBatches(await store.getBatches());
  }, [store]);

  const refreshOperators = useCallback(async () => {
    setOperators(await store.getOperators());
  }, [store]);

  const refreshAudit = useCallback(async () => {
    setAudit(await store.getAuditEvents());
  }, [store]);

  const logAudit = useCallback(
    async (input: AuditInput) => {
      await store.saveScanEvent(input);
      await refreshAudit();
    },
    [store, refreshAudit],
  );

  useEffect(() => {
    void refreshBatches();
    void refreshOperators();
    void refreshAudit();
  }, [refreshBatches, refreshOperators, refreshAudit]);

  const value = useMemo(
    () => ({
      store,
      batches,
      operators,
      audit,
      refreshBatches,
      refreshOperators,
      refreshAudit,
      logAudit,
    }),
    [store, batches, operators, audit, refreshBatches, refreshOperators, refreshAudit, logAudit],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataContextValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider');
  return ctx;
}
