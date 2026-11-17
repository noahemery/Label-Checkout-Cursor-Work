import {
  analyzeCsvWithMapping,
  loadSavedColumnMapping,
  mappingForHeaders,
  peekCsvHeaders,
} from './csvMapping';
import type { AuditInput, DataStore } from './DataStore';
import { PRINT_RUN_PAGE_ID } from './logSheetPages';
import type { DropFolderFile } from './dropFolder';
import {
  buildStationStatus,
  deleteInboxRequest,
  describeLastImport,
  listInboxRequests,
  parseHandledLedger,
  parseInboxRequest,
  readStationHostName,
  sameHandledFile,
  writeStationStatus,
  INBOX_HANDLED_KEY,
  type HandledInboxFile,
  type StationLastImport,
} from './inboxStatus';

export interface InboxSyncInput {
  store: DataStore;
  folder: string;
  ready: DropFolderFile[];
  readFile: (name: string) => Promise<string>;
  logAudit: (input: AuditInput) => Promise<void>;
  lastImport: StationLastImport | null;
  hostName?: string;
}

export interface InboxSyncResult {
  lastImport: StationLastImport | null;
  statusLine: string | null;
  /** Sheets or labels changed, so the on-screen list needs a refresh. */
  changed: boolean;
}

const LEDGER_LIMIT = 500;

/**
 * Import finished CSVs from the inbox and apply hide / show / remove requests
 * the sender window dropped beside them.
 *
 * A file that adds nothing is not left behind as an empty sheet. The filename
 * is then gone from import sessions, so the handled ledger is what stops the
 * next poll from importing that same file again.
 *
 * A file whose columns do not match is left in the folder and retried. Saving
 * a column layout on the station can make the next poll succeed.
 */
export async function syncInbox(input: InboxSyncInput): Promise<InboxSyncResult> {
  const hostName = input.hostName ?? (await readStationHostName());
  let lastImport = input.lastImport;
  let changed = await applyRequests(input);
  const ledger = parseHandledLedger(await input.store.getSetting(INBOX_HANDLED_KEY));

  for (const file of input.ready) {
    if (ledger.some((entry) => sameHandledFile(entry, file))) continue;
    const outcome = await importOne(input, file);
    lastImport = outcome.lastImport;
    if (outcome.changed) changed = true;
    if (outcome.remember) {
      const replaced = rememberHandled(ledger, file);
      ledger.length = 0;
      ledger.push(...replaced);
    }
  }

  if (ledger.length > LEDGER_LIMIT) {
    ledger.splice(0, ledger.length - LEDGER_LIMIT);
  }
  await input.store.setSetting(INBOX_HANDLED_KEY, JSON.stringify({ files: ledger }));

  const [sessions, batches] = await Promise.all([
    input.store.getImportSessions(),
    input.store.getBatches(),
  ]);
  await writeStationStatus(
    input.folder,
    buildStationStatus(hostName, sessions, batches, PRINT_RUN_PAGE_ID, lastImport),
  );

  return { lastImport, statusLine: describeLastImport(lastImport), changed };
}

async function applyRequests(input: InboxSyncInput): Promise<boolean> {
  const names = await listInboxRequests(input.folder);
  if (names.length === 0) return false;
  const sessions = await input.store.getImportSessions();

  for (const name of names) {
    const request = parseInboxRequest(name);
    if (!request) continue;
    const session = sessions.find((item) => item.id === request.id);
    if (request.action === 'remove') {
      if (session) {
        const result = await input.store.deleteImportSession(request.id);
        await input.logAudit({
          type: 'import_deleted',
          operatorId: null,
          operatorName: null,
          batchNumber: null,
          detail: `Removed "${result.filename}" from the D365 PC window — ${result.deleted} label${result.deleted === 1 ? '' : 's'} left the log`,
        });
      }
    } else if (session) {
      const active = request.action === 'show';
      await input.store.setImportSessionActive(request.id, active);
      await input.logAudit({
        type: active ? 'import_shown' : 'import_hidden',
        operatorId: null,
        operatorName: null,
        batchNumber: null,
        detail: active
          ? `Showed "${session.filename}" on the live log from the D365 PC window`
          : `Hid "${session.filename}" from the live log from the D365 PC window — rows kept`,
      });
    }
    await deleteInboxRequest(input.folder, name);
  }
  return true;
}

async function importOne(
  input: InboxSyncInput,
  file: DropFolderFile,
): Promise<{ lastImport: StationLastImport; remember: boolean; changed: boolean }> {
  const base = { filename: file.name, added: 0, skipped: 0, error: null as string | null };
  try {
    const text = await input.readFile(file.name);
    const wrapped = new File([text], file.name, { type: 'text/csv' });
    const peeked = await peekCsvHeaders(wrapped);
    if (peeked.headers.length === 0) {
      return {
        lastImport: {
          ...base,
          error: peeked.errors[0] ?? 'Could not read column headers from that file.',
        },
        remember: true,
        changed: false,
      };
    }

    const resolved = mappingForHeaders(peeked.headers, loadSavedColumnMapping());
    if (resolved.source === 'unmapped') {
      return {
        lastImport: {
          ...base,
          error:
            'This file does not match the saved column layout. Match the columns once on the station, then it will import.',
        },
        remember: false,
        changed: false,
      };
    }

    const analysis = await analyzeCsvWithMapping(wrapped, resolved.mapping);
    if (analysis.rows.length === 0) {
      return {
        lastImport: {
          ...base,
          error: analysis.parseErrors[0] ?? 'No batch rows found in that file.',
        },
        remember: true,
        changed: false,
      };
    }

    const result = await input.store.importBatches(PRINT_RUN_PAGE_ID, analysis.rows, {
      filename: file.name,
    });

    if (result.added === 0) {
      await input.store.deleteImportSession(result.importId);
      await input.logAudit({
        type: 'csv_import',
        operatorId: null,
        operatorName: null,
        batchNumber: null,
        detail: `Inbox file "${file.name}" added nothing — every batch number was already on the station`,
      });
      return {
        lastImport: { ...base, skipped: result.skipped },
        remember: true,
        changed: true,
      };
    }

    const onPage = await input.store.getBatchesForPage(PRINT_RUN_PAGE_ID);
    await input.logAudit({
      type: 'csv_import',
      operatorId: null,
      operatorName: null,
      batchNumber: null,
      detail: `Inbox import "${file.name}": ${analysis.stats.sourceOrders} orders (${result.added} labels) added, ${result.skipped} skipped → ${onPage.length} labels in print run`,
    });
    return {
      lastImport: { filename: file.name, added: result.added, skipped: result.skipped, error: null },
      remember: true,
      changed: true,
    };
  } catch (err) {
    return {
      lastImport: {
        ...base,
        error: err instanceof Error ? err.message : 'Could not import that file.',
      },
      remember: false,
      changed: false,
    };
  }
}

export function rememberHandled(
  ledger: HandledInboxFile[],
  file: DropFolderFile,
): HandledInboxFile[] {
  const next = ledger.filter(
    (entry) => entry.name.trim().toLowerCase() !== file.name.trim().toLowerCase(),
  );
  next.push({ name: file.name, size: file.size, modifiedMs: file.modifiedMs });
  return next;
}
