import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import { normalizeId } from '../domain/normalize';
import { buildReferenceQrPayload } from '../domain/referenceQr';
import { newId, nowIso } from '../domain/types';
import type { AuditEvent, Batch, ImportSession, Operator, UserRole } from '../domain/types';
import type { AuditInput, BatchInput, DataStore, ImportMeta, ImportResult } from './DataStore';

interface LvsDb extends DBSchema {
  batches: {
    key: string;
    value: Batch;
    indexes: { byBatchNumberNorm: string; bySheetPageId: string };
  };
  importSessions: {
    key: string;
    value: ImportSession;
    indexes: { byPageId: string };
  };
  operators: {
    key: string;
    value: Operator;
    indexes: { byBadgeIdNorm: string };
  };
  audit: {
    key: string;
    value: AuditEvent;
    indexes: { byTs: string };
  };
}

export class IndexedDbStore implements DataStore {
  private dbPromise: Promise<IDBPDatabase<LvsDb>>;

  constructor() {
    this.dbPromise = openDB<LvsDb>('label-verification', 10, {
      async upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          const batches = db.createObjectStore('batches', { keyPath: 'id' });
          batches.createIndex('byBatchNumberNorm', 'batchNumberNorm');
          batches.createIndex('bySheetPageId', 'sheetPageId');
          const operators = db.createObjectStore('operators', { keyPath: 'id' });
          operators.createIndex('byBadgeIdNorm', 'badgeIdNorm');
          const audit = db.createObjectStore('audit', { keyPath: 'id' });
          audit.createIndex('byTs', 'ts');
        }
        if (oldVersion >= 1 && oldVersion < 3) {
          const batches = transaction.objectStore('batches');
          if (!batches.indexNames.contains('bySheetPageId')) {
            batches.createIndex('bySheetPageId', 'sheetPageId');
          }
        }
        if (oldVersion >= 1 && oldVersion < 4) {
          const operators = transaction.objectStore('operators');
          const all = await operators.getAll();
          for (const op of all) {
            if (!op.role) {
              await operators.put({ ...op, role: 'operator' });
            }
          }
        }
        if (oldVersion >= 1 && oldVersion < 5) {
          const batches = transaction.objectStore('batches');
          const all = await batches.getAll();
          for (const batch of all) {
            if (batch.splitQty === undefined) {
              await batches.put({ ...batch, splitQty: null });
            }
          }
        }
        if (oldVersion >= 1 && oldVersion < 6) {
          const batches = transaction.objectStore('batches');
          const all = await batches.getAll();
          for (const batch of all) {
            if (batch.deliveryDate === undefined) {
              await batches.put({ ...batch, deliveryDate: null });
            }
          }
        }
        if (oldVersion >= 1 && oldVersion < 7) {
          const LEGACY_PAGE_IDS = new Set(['fmlb003-production', 'fmi-b001-demo']);
          const batches = transaction.objectStore('batches');
          const all = await batches.getAll();
          for (const batch of all) {
            if (LEGACY_PAGE_IDS.has(batch.sheetPageId)) {
              await batches.delete(batch.id);
              continue;
            }
            if (batch.orderTotalQty === undefined) {
              await batches.put({ ...batch, orderTotalQty: batch.quantity ?? null });
            }
          }
        }
        if (oldVersion >= 1 && oldVersion < 8) {
          const batches = transaction.objectStore('batches');
          const all = await batches.getAll();
          for (const batch of all) {
            if (batch.referenceQrPayload === undefined) {
              await batches.put({
                ...batch,
                referenceQrPayload: buildReferenceQrPayload(batch),
              });
            }
          }
        }
        // v9 — the paper log sheet photo feature is gone. The store is no
        // longer in LvsDb, so drop it through an untyped handle.
        const legacy = db as unknown as IDBPDatabase;
        if (legacy.objectStoreNames.contains('sheetPhotos')) {
          legacy.deleteObjectStore('sheetPhotos');
        }
        if (oldVersion < 10) {
          if (!db.objectStoreNames.contains('importSessions')) {
            const sessions = db.createObjectStore('importSessions', { keyPath: 'id' });
            sessions.createIndex('byPageId', 'pageId');
          }
          const batches = transaction.objectStore('batches');
          const all = await batches.getAll();
          for (const batch of all) {
            if (batch.importId === undefined) {
              await batches.put({ ...batch, importId: null });
            }
          }
        }
      },
    });
  }

  // ---- Batches -------------------------------------------------------

  async getBatches(): Promise<Batch[]> {
    const db = await this.dbPromise;
    const all = await db.getAll('batches');
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getBatchesForPage(pageId: string): Promise<Batch[]> {
    const db = await this.dbPromise;
    const all = await db.getAllFromIndex('batches', 'bySheetPageId', pageId);
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async findBatchOnPage(pageId: string, batchNumber: string): Promise<Batch | undefined> {
    const norm = normalizeId(batchNumber);
    const onPage = await this.getBatchesForPage(pageId);
    return onPage.find((b) => b.batchNumberNorm === norm);
  }

  async addBatch(input: BatchInput): Promise<Batch> {
    if (!input.sheetPageId) {
      throw new Error('sheetPageId is required when adding a batch');
    }
    const db = await this.dbPromise;
    const batch: Batch = {
      id: newId(),
      batchNumber: input.batchNumber.trim(),
      batchNumberNorm: normalizeId(input.batchNumber),
      itemNumber: input.itemNumber ?? null,
      productName: input.productName ?? null,
      labelCode: input.labelCode ?? null,
      upc: input.upc ?? null,
      quantity: input.quantity ?? null,
      splitQty: input.splitQty ?? null,
      orderTotalQty: input.orderTotalQty ?? input.quantity ?? null,
      dom: input.dom ?? null,
      doe: input.doe ?? null,
      deliveryDate: input.deliveryDate ?? null,
      referenceQrPayload: buildReferenceQrPayload(input),
      status: 'pending',
      verifiedAt: null,
      verifiedById: null,
      verifiedByName: null,
      createdAt: nowIso(),
      source: input.source ?? 'manual',
      sheetPageId: input.sheetPageId,
      importId: input.importId ?? null,
    };
    await db.put('batches', batch);
    return batch;
  }

  async importBatches(pageId: string, inputs: BatchInput[], meta?: ImportMeta): Promise<ImportResult> {
    const db = await this.dbPromise;
    const importId = newId();
    const session: ImportSession = {
      id: importId,
      pageId,
      filename: meta?.filename ?? 'import.csv',
      importedAt: nowIso(),
      labelCount: 0,
    };

    let added = 0;
    let skipped = 0;
    for (const input of inputs) {
      if (!input.batchNumber?.trim()) {
        skipped++;
        continue;
      }
      const existing = await this.findBatchOnPage(pageId, input.batchNumber);
      if (existing) {
        skipped++;
        continue;
      }
      await this.addBatch({
        ...input,
        sheetPageId: pageId,
        source: input.source ?? 'csv',
        importId,
      });
      added++;
    }

    session.labelCount = added;
    await db.put('importSessions', session);
    return { added, skipped, importId };
  }

  async getImportSessions(): Promise<ImportSession[]> {
    const db = await this.dbPromise;
    const all = await db.getAll('importSessions');
    return all.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  }

  async getImportSessionsForPage(pageId: string): Promise<ImportSession[]> {
    const db = await this.dbPromise;
    const all = await db.getAllFromIndex('importSessions', 'byPageId', pageId);
    return all.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  }

  private async updateBatch(batchId: string, patch: Partial<Batch>): Promise<Batch> {
    const db = await this.dbPromise;
    const batch = await db.get('batches', batchId);
    if (!batch) throw new Error(`Batch ${batchId} not found`);
    const next = { ...batch, ...patch };
    await db.put('batches', next);
    return next;
  }

  async verifyRow(batchId: string, operator: Operator): Promise<Batch> {
    return this.updateBatch(batchId, {
      status: 'verified',
      verifiedAt: nowIso(),
      verifiedById: operator.id,
      verifiedByName: operator.name,
    });
  }

  async reopenRow(batchId: string): Promise<Batch> {
    return this.updateBatch(batchId, {
      status: 'pending',
      verifiedAt: null,
      verifiedById: null,
      verifiedByName: null,
    });
  }

  async flagRow(batchId: string): Promise<Batch> {
    return this.updateBatch(batchId, { status: 'flagged' });
  }

  async deleteBatch(batchId: string): Promise<void> {
    const db = await this.dbPromise;
    await db.delete('batches', batchId);
  }

  async deletePageData(pageId: string): Promise<void> {
    const db = await this.dbPromise;
    const onPage = await db.getAllFromIndex('batches', 'bySheetPageId', pageId);
    for (const b of onPage) {
      await db.delete('batches', b.id);
    }
    const sessions = await db.getAllFromIndex('importSessions', 'byPageId', pageId);
    for (const s of sessions) {
      await db.delete('importSessions', s.id);
    }
  }

  // ---- Operators -----------------------------------------------------

  async getOperators(): Promise<Operator[]> {
    const db = await this.dbPromise;
    const all = await db.getAll('operators');
    return all
      .map((op) => ({ ...op, role: op.role ?? 'operator' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getOperatorByBadge(badgeId: string): Promise<Operator | undefined> {
    const db = await this.dbPromise;
    const op = await db.getFromIndex('operators', 'byBadgeIdNorm', normalizeId(badgeId));
    if (!op) return undefined;
    return { ...op, role: op.role ?? 'operator' };
  }

  async enrollOperator(badgeId: string, name: string, role: UserRole = 'operator'): Promise<Operator> {
    const existing = await this.getOperatorByBadge(badgeId);
    if (existing) throw new Error(`Badge already enrolled to ${existing.name}`);
    const db = await this.dbPromise;
    const operator: Operator = {
      id: newId(),
      badgeIdNorm: normalizeId(badgeId),
      name: name.trim(),
      role,
      createdAt: nowIso(),
    };
    await db.put('operators', operator);
    return operator;
  }

  async updateUserRole(operatorId: string, role: UserRole): Promise<Operator> {
    const db = await this.dbPromise;
    const operator = await db.get('operators', operatorId);
    if (!operator) throw new Error(`User ${operatorId} not found`);
    const next = { ...operator, role };
    await db.put('operators', next);
    return next;
  }

  async removeOperator(operatorId: string): Promise<void> {
    const db = await this.dbPromise;
    await db.delete('operators', operatorId);
  }

  // ---- Audit ---------------------------------------------------------

  async saveScanEvent(input: AuditInput): Promise<AuditEvent> {
    const db = await this.dbPromise;
    const event: AuditEvent = { ...input, id: newId(), ts: nowIso() };
    await db.put('audit', event);
    return event;
  }

  async getAuditEvents(limit = 300): Promise<AuditEvent[]> {
    const db = await this.dbPromise;
    const all = await db.getAllFromIndex('audit', 'byTs');
    return all.reverse().slice(0, limit);
  }

  // ---- Settings (localStorage — browser has no settings object store) -

  async getSetting(key: string): Promise<string | null> {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  async setSetting(key: string, value: string): Promise<void> {
    localStorage.setItem(key, value);
  }
}
