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
  /**
   * D365 Split — max qty per production run. When less than quantity, the order
   * is split into parent + child batches (-02, -03, …); remainder is last run.
   */
  splitQty: number | null;
  /** Full order quantity before per-run split (same on every label in a family). */
  orderTotalQty: number | null;
  /** Date of manufacture, stored as the display string from the sheet/import. */
  dom: string | null;
  /** Date of expiration (from label / sheet — not the D365 Delivery column). */
  doe: string | null;
  /** D365 Delivery column — scheduled ship/delivery date. */
  deliveryDate: string | null;
  /** Pre-built REF|… string for the on-screen reference QR (null if no label code). */
  referenceQrPayload: string | null;
  status: BatchStatus;
  verifiedAt: string | null;
  verifiedById: string | null;
  verifiedByName: string | null;
  createdAt: string;
  source: BatchSource;
  /** Log sheet page this row belongs to — check-out memory is per page. */
  sheetPageId: string;
  /** D365 CSV import that created this row (null for legacy / manual adds). */
  importId: string | null;
}

/** One D365 CSV import into a print run — shown as the "Sheet" column in the batch log. */
export interface ImportSession {
  id: string;
  pageId: string;
  filename: string;
  importedAt: string;
  /** Rows added during this import (snapshot at import time). */
  labelCount: number;
}

/** Badge-in profile — admins see full tools; operators get a minimal checkout screen. */
export type UserRole = 'admin' | 'operator';

export interface Operator {
  id: string;
  /** Normalized badge ID (alphanumeric-only uppercase). */
  badgeIdNorm: string;
  name: string;
  role: UserRole;
  createdAt: string;
}

export type AuditType =
  | 'scan'
  | 'order_open'
  | 'verify'
  | 'mismatch'
  /** A later badge tap corroborated who was at the station for an earlier event. */
  | 'badge_attribution'
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
