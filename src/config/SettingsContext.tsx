import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useAppData } from '../data/AppDataContext';
import {
  loadSettings,
  parseSettings,
  saveSettings,
  SETTINGS_STORAGE_KEY,
} from './settings';
import type { AppSettings } from './settings';

interface SettingsContextValue {
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

/**
 * Must sit under AppDataProvider so desktop settings can live in SQLite.
 * localStorage is still written so a browser session and a first SQLite
 * launch keep the same values.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const { store } = useAppData();
  const [settings, setSettings] = useState<AppSettings>(loadSettings);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const raw = await store.getSetting(SETTINGS_STORAGE_KEY);
      if (cancelled) return;
      if (raw) {
        const parsed = parseSettings(raw);
        setSettings(parsed);
        saveSettings(parsed);
        return;
      }
      const fromLs = loadSettings();
      await store.setSetting(SETTINGS_STORAGE_KEY, JSON.stringify(fromLs));
      if (!cancelled) setSettings(fromLs);
    })();
    return () => {
      cancelled = true;
    };
  }, [store]);

  const updateSettings = useCallback(
    (patch: Partial<AppSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        saveSettings(next);
        void store.setSetting(SETTINGS_STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    [store],
  );

  const value = useMemo(() => ({ settings, updateSettings }), [settings, updateSettings]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
