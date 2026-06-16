import type { AuditEvent, Batch, Operator } from '../domain/types';

/**
 * Repository abstraction for all persistence.
 *
 * Today this is implemented by IndexedDbStore (local-only). When Azure is
 * ready (Azure SQL or Dataverse behind a small API), write a new class that
 * implements this interface and swap it in AppDataContext — nothing else in
 * the app should change.
 *
 * Equivalent SQL schema sketch (see README for details):
 *   batches(id PK, batch_number, batch_number_norm, item_number, product_name,
 *           label_code, quantity, dom, doe, status, verified_at,
 *           verified_by_id, verified_by_name, created_at, source)
 *   operators(id PK, badge_id_norm UNIQUE, name, created_at)
 *   audit_events(id PK, ts, type, operator_id, operator_name, batch_number, detail)
 */

export interface BatchInput {
  batchNumber: string;
  itemNumber?: string | null;
  productName?: string | null;
  labelCode?: string | null;
  upc?: string | null;
  quantity?: number | null;
  dom?: string | null;
  doe?: string | null;
  source?: Batch['source'];
  /** Required for addBatch; importBatches sets this from the page id. */
  sheetPageId?: string;
}

export type AuditInput = Omit<AuditEvent, 'id' | 'ts'>;

export interface ImportResult {
  added: number;
  skipped: number;
}

export interface DataStore {
  // Batches
  getBatches(): Promise<Batch[]>;
  getBatchesForPage(pageId: string): Promise<Batch[]>;
  findBatchOnPage(pageId: string, batchNumber: string): Promise<Batch | undefined>;
  findBatchByNumber(batchNumber: string): Promise<Batch | undefined>;
  addBatch(input: BatchInput): Promise<Batch>;
  importBatches(pageId: string, inputs: BatchInput[]): Promise<ImportResult>;
  verifyRow(batchId: string, operator: Operator): Promise<Batch>;
  reopenRow(batchId: string): Promise<Batch>;
  flagRow(batchId: string): Promise<Batch>;
  deleteBatch(batchId: string): Promise<void>;
  /** Wipe all batches + uploaded photo for one log sheet page. */
  deletePageData(pageId: string): Promise<void>;
  assignOrphanBatches(pageId: string, batchNumberNorms: string[]): Promise<number>;

  // Log sheet page photos (uploaded physical FMI B001 pages)
  getSheetPhoto(pageId: string): Promise<string | null>;
  saveSheetPhoto(pageId: string, dataUrl: string): Promise<void>;
  deleteSheetPhoto(pageId: string): Promise<void>;

  // Operators
  getOperators(): Promise<Operator[]>;
  getOperatorByBadge(badgeId: string): Promise<Operator | undefined>;
  enrollOperator(badgeId: string, name: string): Promise<Operator>;
  removeOperator(operatorId: string): Promise<void>;

  // Audit trail (scan events, verifications, mismatches, re-opens, sessions)
  saveScanEvent(input: AuditInput): Promise<AuditEvent>;
  getAuditEvents(limit?: number): Promise<AuditEvent[]>;
}
