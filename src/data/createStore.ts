import type { DataStore } from './DataStore';
import { IndexedDbStore } from './IndexedDbStore';

/**
 * Picks the persistence backend for the current runtime.
 *
 * Desktop (Tauri) gets SQLite — a real file on disk that can be copied for
 * backup. A plain browser keeps IndexedDB so `npm run dev` still works for
 * development without the desktop shell.
 *
 * The SQLite module is loaded dynamically so the browser bundle never pulls in
 * the Tauri plugin.
 */

export type StoreKind = 'sqlite' | 'indexeddb';

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export interface CreatedStore {
  store: DataStore;
  kind: StoreKind;
}

export async function createStore(): Promise<CreatedStore> {
  if (isTauriRuntime()) {
    const { SqliteStore } = await import('./SqliteStore');
    return { store: await SqliteStore.open(), kind: 'sqlite' };
  }
  return { store: new IndexedDbStore(), kind: 'indexeddb' };
}
