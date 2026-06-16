import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import { normalizeId } from '../domain/normalize';
import { newId, nowIso } from '../domain/types';
import type { AuditEvent, Batch, Operator } from '../domain/types';
import type { AuditInput, BatchInput, DataStore, ImportResult } from './DataStore';

interface LvsDb extends DBSchema {
  batches: {
    key: string;
    value: Batch;
    indexes: { byBatchNumberNorm: string; bySheetPageId: string };
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
  sheetPhotos: {
    key: string;
    value: { pageId: string; dataUrl: string; updatedAt: string };
  };
}

export class IndexedDbStore implements DataStore {
  private dbPromise: Promise<IDBPDatabase<LvsDb>>;

  constructor() {
    this.dbPromise = openDB<LvsDb>('label-verification', 3, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          const batches = db.createObjectStore('batches', { keyPath: 'id' });
          batches.createIndex('byBatchNumberNorm', 'batchNumberNorm');
          batches.createIndex('bySheetPageId', 'sheetPageId');
          const operators = db.createObjectStore('operators', { keyPath: 'id' });
          operators.createIndex('byBadgeIdNorm', 'badgeIdNorm');
          const audit = db.createObjectStore('audit', { keyPath: 'id' });
          audit.createIndex('byTs', 'ts');
        }
        if (oldVersion < 2) {
          db.createObjectStore('sheetPhotos', { keyPath: 'pageId' });
        }
        if (oldVersion >= 1 && oldVersion < 3) {
          const batches = transaction.objectStore('batches');
          if (!batches.indexNames.contains('bySheetPageId')) {
            batches.createIndex('bySheetPageId', 'sheetPageId');
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

  async findBatchByNumber(batchNumber: string): Promise<Batch | undefined> {
    const db = await this.dbPromise;
    return db.getFromIndex('batches', 'byBatchNumberNorm', normalizeId(batchNumber));
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
      dom: input.dom ?? null,
      doe: input.doe ?? null,
      status: 'pending',
      verifiedAt: null,
      verifiedById: null,
      verifiedByName: null,
      createdAt: nowIso(),
      source: input.source ?? 'manual',
      sheetPageId: input.sheetPageId,
    };
    await db.put('batches', batch);
    return batch;
  }

  async importBatches(pageId: string, inputs: BatchInput[]): Promise<ImportResult> {
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
      await this.addBatch({ ...input, sheetPageId: pageId, source: input.source ?? 'csv' });
      added++;
    }
    return { added, skipped };
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
    await db.delete('sheetPhotos', pageId);
  }

  async assignOrphanBatches(pageId: string, batchNumberNorms: string[]): Promise<number> {
    const db = await this.dbPromise;
    const normSet = new Set(batchNumberNorms);
    const all = await db.getAll('batches');
    let assigned = 0;
    for (const b of all) {
      if (b.sheetPageId?.length || !normSet.has(b.batchNumberNorm)) continue;
      await db.put('batches', { ...b, sheetPageId: pageId });
      assigned++;
    }
    return assigned;
  }

  async deleteSheetPhoto(pageId: string): Promise<void> {
    const db = await this.dbPromise;
    await db.delete('sheetPhotos', pageId);
  }

  // ---- Sheet photos --------------------------------------------------

  async getSheetPhoto(pageId: string): Promise<string | null> {
    const db = await this.dbPromise;
    const row = await db.get('sheetPhotos', pageId);
    return row?.dataUrl ?? null;
  }

  async saveSheetPhoto(pageId: string, dataUrl: string): Promise<void> {
    const db = await this.dbPromise;
    try {
      await db.put('sheetPhotos', { pageId, dataUrl, updatedAt: nowIso() });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'QuotaExceededError') {
        throw new Error('Photo is too large to save — try a smaller image.');
      }
      throw err;
    }
  }

  // ---- Operators -----------------------------------------------------

  async getOperators(): Promise<Operator[]> {
    const db = await this.dbPromise;
    const all = await db.getAll('operators');
    return all.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getOperatorByBadge(badgeId: string): Promise<Operator | undefined> {
    const db = await this.dbPromise;
    return db.getFromIndex('operators', 'byBadgeIdNorm', normalizeId(badgeId));
  }

  async enrollOperator(badgeId: string, name: string): Promise<Operator> {
    const existing = await this.getOperatorByBadge(badgeId);
    if (existing) throw new Error(`Badge already enrolled to ${existing.name}`);
    const db = await this.dbPromise;
    const operator: Operator = {
      id: newId(),
      badgeIdNorm: normalizeId(badgeId),
      name: name.trim(),
      createdAt: nowIso(),
    };
    await db.put('operators', operator);
    return operator;
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
}
