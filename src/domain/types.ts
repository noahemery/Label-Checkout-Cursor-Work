/**
 * Core domain types. Kept flat and SQL-friendly so the schema maps 1:1
 * onto Azure SQL / Dataverse tables later.
 */

export type BatchStatus = 'pending' | 'verified' | 'flagged';

export type BatchSource = 'manual' | 'csv' | 'sheet-scan' | 'auto-verify';

export interface Batch {
  id: string;
  batchNumber: string;
  /** Alphanumeric-only uppercase form, used for all matching. */
  batchNumberNorm: string;
  itemNumber: string | null;
  productName: string | null;
  labelCode: string | null;
  /** Product UPC/GTIN — identifies the product, never the batch. */
  upc: string | null;
  quantity: number | null;
  /** Date of manufacture, stored as the display string from the sheet/import. */
  dom: string | null;
  /** Date of expiration. */
  doe: string | null;
  status: BatchStatus;
  verifiedAt: string | null;
  verifiedById: string | null;
  verifiedByName: string | null;
  createdAt: string;
  source: BatchSource;
  /** Log sheet page this row belongs to — check-out memory is per page. */
  sheetPageId: string;
}

export interface Operator {
  id: string;
  /** Normalized badge ID (alphanumeric-only uppercase). */
  badgeIdNorm: string;
  name: string;
  createdAt: string;
}

export type AuditType =
  | 'scan'
  | 'verify'
  | 'mismatch'
  | 'reopen'
  | 'flag'
  | 'sign_in'
  | 'sign_out'
  | 'enroll'
  | 'operator_removed'
  | 'batch_add'
  | 'batch_delete'
  | 'csv_import'
  | 'page_select'
  | 'sheet_photo'
  | 'sheet_reset';

export interface AuditEvent {
  id: string;
  /** ISO timestamp. */
  ts: string;
  type: AuditType;
  operatorId: string | null;
  operatorName: string | null;
  batchNumber: string | null;
  detail: string;
}

export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
