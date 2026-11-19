import { invoke } from '@tauri-apps/api/core';
import type { Batch, ImportSession } from '../domain/types';

/** The one file the D365 PC window reads. Not a CSV, so the importer ignores it. */
export const STATION_STATUS_NAME = 'station-status.json';

export const INBOX_HANDLED_KEY = 'lvs-inbox-handled';

export interface StationSheet {
  id: string;
  filename: string;
  labelCount: number;
  active: boolean;
  importedAt: string;
}

export interface StationLastImport {
  filename: string;
  added: number;
  skipped: number;
  error: string | null;
}

export interface StationStatus {
  station: string;
  writtenAt: string;
  sheets: StationSheet[];
  lastImport: StationLastImport | null;
}

export interface HandledInboxFile {
  name: string;
  size: number;
  modifiedMs: number | null;
}

export type InboxRequestAction = 'hide' | 'show' | 'remove';

const REQUEST_NAME =
  /^(hide|show|remove)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.request$/i;

export function parseInboxRequest(
  name: string,
): { action: InboxRequestAction; id: string } | null {
  const match = REQUEST_NAME.exec(name.trim());
  if (!match) return null;
  const action = match[1].toLowerCase() as InboxRequestAction;
  return { action, id: match[2].toLowerCase() };
}

export function buildStationStatus(
  station: string,
  sessions: ImportSession[],
  batches: Batch[],
  pageId: string,
  lastImport: StationLastImport | null,
  writtenAt = new Date().toISOString(),
): StationStatus {
  const sheets = sessions
    .filter((session) => session.pageId === pageId)
    .map((session) => ({
      id: session.id,
      filename: session.filename,
      labelCount: batches.filter((batch) => batch.importId === session.id).length,
      active: session.active !== false,
      importedAt: session.importedAt,
    }))
    .sort((a, b) => (a.importedAt < b.importedAt ? 1 : a.importedAt > b.importedAt ? -1 : 0));

  return { station, writtenAt, sheets, lastImport };
}

export function sameHandledFile(
  entry: HandledInboxFile,
  file: { name: string; size: number; modifiedMs: number | null },
): boolean {
  return (
    entry.name.trim().toLowerCase() === file.name.trim().toLowerCase() &&
    entry.size === file.size &&
    entry.modifiedMs === file.modifiedMs
  );
}

export function parseHandledLedger(raw: string | null): HandledInboxFile[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { files?: HandledInboxFile[] };
    if (!Array.isArray(parsed.files)) return [];
    return parsed.files.filter(
      (file) => file && typeof file.name === 'string' && typeof file.size === 'number',
    );
  } catch {
    return [];
  }
}

export function describeLastImport(last: StationLastImport | null): string | null {
  if (!last) return null;
  if (last.error) return `${last.filename}: ${last.error}`;
  if (last.added === 0) {
    return `${last.filename} was already on the station. Nothing new was added.`;
  }
  const skipped =
    last.skipped > 0 ? `, ${last.skipped} already on the station` : '';
  return `${last.filename}: ${last.added} label${last.added === 1 ? '' : 's'} added${skipped}.`;
}

export function writeStationStatus(folder: string, status: StationStatus): Promise<void> {
  return invoke('write_inbox_status', { folder, body: JSON.stringify(status) });
}

export function listInboxRequests(folder: string): Promise<string[]> {
  return invoke<string[]>('list_inbox_requests', { folder });
}

export function deleteInboxRequest(folder: string, name: string): Promise<void> {
  return invoke('delete_inbox_request', { folder, name });
}

export function readStationHostName(): Promise<string> {
  return invoke<string>('station_host_name');
}
