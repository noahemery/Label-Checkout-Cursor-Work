import type { AuditEvent, Batch, ImportSession, Operator, UserRole } from '../domain/types';

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
  /** Per-run size from D365 Split; null = one run for full quantity. */
  splitQty?: number | null;
  /** Full order quantity (before per-run split). */
  orderTotalQty?: number | null;
  dom?: string | null;
  doe?: string | null;
  deliveryDate?: string | null;
  source?: Batch['source'];
  /** Required for addBatch; importBatches sets this from the page id. */
  sheetPageId?: string;
  /** Set by importBatches when rows come from a CSV import session. */
  importId?: string | null;
}

export interface ImportMeta {
  filename: string;
}

export type AuditInput = Omit<AuditEvent, 'id' | 'ts'>;

export interface ImportResult {
  added: number;
  skipped: number;
  importId: string;
}

export interface DataStore {
  // Batches
  getBatches(): Promise<Batch[]>;
  getBatchesForPage(pageId: string): Promise<Batch[]>;
  findBatchOnPage(pageId: string, batchNumber: string): Promise<Batch | undefined>;
  addBatch(input: BatchInput): Promise<Batch>;
  importBatches(pageId: string, inputs: BatchInput[], meta?: ImportMeta): Promise<ImportResult>;
  getImportSessions(): Promise<ImportSession[]>;
  getImportSessionsForPage(pageId: string): Promise<ImportSession[]>;
  verifyRow(batchId: string, operator: Operator): Promise<Batch>;
  reopenRow(batchId: string): Promise<Batch>;
  flagRow(batchId: string): Promise<Batch>;
  deleteBatch(batchId: string): Promise<void>;
  /** Wipe every batch in one print run. */
  deletePageData(pageId: string): Promise<void>;

  // Operators
  getOperators(): Promise<Operator[]>;
  getOperatorByBadge(badgeId: string): Promise<Operator | undefined>;
  enrollOperator(badgeId: string, name: string, role?: UserRole): Promise<Operator>;
  updateUserRole(operatorId: string, role: UserRole): Promise<Operator>;
  removeOperator(operatorId: string): Promise<void>;

  // Audit trail (scan events, verifications, mismatches, re-opens, sessions)
  saveScanEvent(input: AuditInput): Promise<AuditEvent>;
  getAuditEvents(limit?: number): Promise<AuditEvent[]>;

  // Station configuration (SQLite settings table on desktop, localStorage in browser)
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
}
