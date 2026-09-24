import Database from '@tauri-apps/plugin-sql';
import { normalizeId } from '../domain/normalize';
import { buildReferenceQrPayload } from '../domain/referenceQr';
import { newId, nowIso } from '../domain/types';
import type { AuditEvent, Batch, ImportSession, Operator, UserRole } from '../domain/types';
import type { AuditInput, BatchInput, DataStore, ImportMeta, ImportResult } from './DataStore';
import { SCHEMA_STATEMENTS, SCHEMA_VERSION, WAL_PRAGMA } from './sqliteSchema';

/**
 * SQLite-backed DataStore for the desktop build.
 *
 * The file lives in the Tauri app data directory, so backing the station up is
 * copying one file. Bind placeholders are `$1`-style, which is what the SQLite
 * driver behind tauri-plugin-sql expects.
 *
 * Writes are ordered so a failure part way through leaves recoverable state
 * rather than orphans: the import session row is written before the batches it
 * owns, and both import and page-wipe are safe to run again.
 */

const DB_FILE = 'sqlite:label-verification.db';

interface BatchRow {
  id: string;
  batch_number: string;
  batch_number_norm: string;
  item_number: string | null;
  product_name: string | null;
  label_code: string | null;
  upc: string | null;
  quantity: number | null;
  split_qty: number | null;
  order_total_qty: number | null;
  dom: string | null;
  doe: string | null;
  delivery_date: string | null;
  reference_qr_payload: string | null;
  status: Batch['status'];
  verified_at: string | null;
  verified_by_id: string | null;
  verified_by_name: string | null;
  created_at: string;
  source: Batch['source'];
  sheet_page_id: string;
  import_id: string | null;
}

interface ImportSessionRow {
  id: string;
  page_id: string;
  filename: string;
  imported_at: string;
  label_count: number;
}

interface OperatorRow {
  id: string;
  badge_id_norm: string;
  name: string;
  role: UserRole;
  created_at: string;
}

interface AuditRow {
  id: string;
  ts: string;
  type: AuditEvent['type'];
  operator_id: string | null;
  operator_name: string | null;
  batch_number: string | null;
  detail: string;
}

function toBatch(r: BatchRow): Batch {
  return {
    id: r.id,
    batchNumber: r.batch_number,
    batchNumberNorm: r.batch_number_norm,
    itemNumber: r.item_number,
    productName: r.product_name,
    labelCode: r.label_code,
    upc: r.upc,
    quantity: r.quantity,
    splitQty: r.split_qty,
    orderTotalQty: r.order_total_qty,
    dom: r.dom,
    doe: r.doe,
    deliveryDate: r.delivery_date,
    referenceQrPayload: r.reference_qr_payload,
    status: r.status,
    verifiedAt: r.verified_at,
    verifiedById: r.verified_by_id,
    verifiedByName: r.verified_by_name,
    createdAt: r.created_at,
    source: r.source,
    sheetPageId: r.sheet_page_id,
    importId: r.import_id,
  };
}

function toImportSession(r: ImportSessionRow): ImportSession {
  return {
    id: r.id,
    pageId: r.page_id,
    filename: r.filename,
    importedAt: r.imported_at,
    labelCount: r.label_count,
  };
}

function toOperator(r: OperatorRow): Operator {
  return {
    id: r.id,
    badgeIdNorm: r.badge_id_norm,
    name: r.name,
    role: r.role ?? 'operator',
    createdAt: r.created_at,
  };
}

function toAuditEvent(r: AuditRow): AuditEvent {
  return {
    id: r.id,
    ts: r.ts,
    type: r.type,
    operatorId: r.operator_id,
    operatorName: r.operator_name,
    batchNumber: r.batch_number,
    detail: r.detail,
  };
}

const BATCH_COLUMNS = `
  id, batch_number, batch_number_norm, item_number, product_name, label_code, upc,
  quantity, split_qty, order_total_qty, dom, doe, delivery_date, reference_qr_payload,
  status, verified_at, verified_by_id, verified_by_name, created_at, source,
  sheet_page_id, import_id
`;

function batchFromInput(input: BatchInput, sheetPageId: string): Batch {
  return {
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
    sheetPageId,
    importId: input.importId ?? null,
  };
}

function batchBindValues(b: Batch): unknown[] {
  return [
    b.id,
    b.batchNumber,
    b.batchNumberNorm,
    b.itemNumber,
    b.productName,
    b.labelCode,
    b.upc,
    b.quantity,
    b.splitQty,
    b.orderTotalQty,
    b.dom,
    b.doe,
    b.deliveryDate,
    b.referenceQrPayload,
    b.status,
    b.verifiedAt,
    b.verifiedById,
    b.verifiedByName,
    b.createdAt,
    b.source,
    b.sheetPageId,
    b.importId,
  ];
}

const INSERT_BATCH_PLACEHOLDERS = Array.from({ length: 22 }, (_, i) => `$${i + 1}`).join(', ');

export class SqliteStore implements DataStore {
  private readonly db: Database;

  private constructor(db: Database) {
    this.db = db;
  }

  /** Open the database file and bring the schema up to date. */
  static async open(): Promise<SqliteStore> {
    const db = await Database.load(DB_FILE);
    // journal_mode returns a row, so this has to be select, not execute.
    await db.select(WAL_PRAGMA);
    for (const statement of SCHEMA_STATEMENTS) {
      await db.execute(statement);
    }
    await db.execute(
      `INSERT INTO schema_meta (key, value) VALUES ('schema_version', $1)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      [String(SCHEMA_VERSION)],
    );
    return new SqliteStore(db);
  }

  // ---- Batches -------------------------------------------------------

  async getBatches(): Promise<Batch[]> {
    const rows = await this.db.select<BatchRow[]>(
      `SELECT ${BATCH_COLUMNS} FROM batches ORDER BY created_at ASC`,
    );
    return rows.map(toBatch);
  }

  async getBatchesForPage(pageId: string): Promise<Batch[]> {
    const rows = await this.db.select<BatchRow[]>(
      `SELECT ${BATCH_COLUMNS} FROM batches WHERE sheet_page_id = $1 ORDER BY created_at ASC`,
      [pageId],
    );
    return rows.map(toBatch);
  }

  async findBatchOnPage(pageId: string, batchNumber: string): Promise<Batch | undefined> {
    const rows = await this.db.select<BatchRow[]>(
      `SELECT ${BATCH_COLUMNS} FROM batches
         WHERE sheet_page_id = $1 AND batch_number_norm = $2 LIMIT 1`,
      [pageId, normalizeId(batchNumber)],
    );
    return rows[0] ? toBatch(rows[0]) : undefined;
  }

  private async getBatchById(batchId: string): Promise<Batch> {
    const rows = await this.db.select<BatchRow[]>(
      `SELECT ${BATCH_COLUMNS} FROM batches WHERE id = $1`,
      [batchId],
    );
    if (!rows[0]) throw new Error(`Batch ${batchId} not found`);
    return toBatch(rows[0]);
  }

  async addBatch(input: BatchInput): Promise<Batch> {
    if (!input.sheetPageId) {
      throw new Error('sheetPageId is required when adding a batch');
    }
    const batch = batchFromInput(input, input.sheetPageId);
    await this.db.execute(
      `INSERT INTO batches (${BATCH_COLUMNS}) VALUES (${INSERT_BATCH_PLACEHOLDERS})`,
      batchBindValues(batch),
    );
    return batch;
  }

  /**
   * The session row is written first so a batch can never reference a session
   * that does not exist. Duplicate batch numbers are rejected by the unique
   * index rather than by a lookup per row, and INSERT OR IGNORE makes a
   * re-run of a partial import a no-op for rows that already landed.
   */
  async importBatches(
    pageId: string,
    inputs: BatchInput[],
    meta?: ImportMeta,
  ): Promise<ImportResult> {
    const importId = newId();
    await this.db.execute(
      `INSERT INTO import_sessions (id, page_id, filename, imported_at, label_count)
         VALUES ($1, $2, $3, $4, 0)`,
      [importId, pageId, meta?.filename ?? 'import.csv', nowIso()],
    );

    let added = 0;
    let skipped = 0;
    for (const input of inputs) {
      if (!input.batchNumber?.trim()) {
        skipped++;
        continue;
      }
      const batch = batchFromInput(
        { ...input, source: input.source ?? 'csv', importId },
        pageId,
      );
      const result = await this.db.execute(
        `INSERT OR IGNORE INTO batches (${BATCH_COLUMNS})
           VALUES (${INSERT_BATCH_PLACEHOLDERS})`,
        batchBindValues(batch),
      );
      if (result.rowsAffected > 0) added++;
      else skipped++;
    }

    await this.db.execute(`UPDATE import_sessions SET label_count = $1 WHERE id = $2`, [
      added,
      importId,
    ]);

    return { added, skipped, importId };
  }

  async getImportSessions(): Promise<ImportSession[]> {
    const rows = await this.db.select<ImportSessionRow[]>(
      `SELECT id, page_id, filename, imported_at, label_count
         FROM import_sessions ORDER BY imported_at DESC`,
    );
    return rows.map(toImportSession);
  }

  async getImportSessionsForPage(pageId: string): Promise<ImportSession[]> {
    const rows = await this.db.select<ImportSessionRow[]>(
      `SELECT id, page_id, filename, imported_at, label_count
         FROM import_sessions WHERE page_id = $1 ORDER BY imported_at DESC`,
      [pageId],
    );
    return rows.map(toImportSession);
  }

  async verifyRow(batchId: string, operator: Operator): Promise<Batch> {
    await this.db.execute(
      `UPDATE batches
         SET status = 'verified', verified_at = $1, verified_by_id = $2, verified_by_name = $3
         WHERE id = $4`,
      [nowIso(), operator.id, operator.name, batchId],
    );
    return this.getBatchById(batchId);
  }

  async reopenRow(batchId: string): Promise<Batch> {
    await this.db.execute(
      `UPDATE batches
         SET status = 'pending', verified_at = NULL, verified_by_id = NULL,
             verified_by_name = NULL
         WHERE id = $1`,
      [batchId],
    );
    return this.getBatchById(batchId);
  }

  async flagRow(batchId: string): Promise<Batch> {
    await this.db.execute(`UPDATE batches SET status = 'flagged' WHERE id = $1`, [batchId]);
    return this.getBatchById(batchId);
  }

  async deleteBatch(batchId: string): Promise<void> {
    await this.db.execute(`DELETE FROM batches WHERE id = $1`, [batchId]);
  }

  /** Batches go before sessions so a re-run after a failure finishes the job. */
  async deletePageData(pageId: string): Promise<void> {
    await this.db.execute(`DELETE FROM batches WHERE sheet_page_id = $1`, [pageId]);
    await this.db.execute(`DELETE FROM import_sessions WHERE page_id = $1`, [pageId]);
  }

  // ---- Operators -----------------------------------------------------

  async getOperators(): Promise<Operator[]> {
    const rows = await this.db.select<OperatorRow[]>(
      `SELECT id, badge_id_norm, name, role, created_at FROM operators ORDER BY name ASC`,
    );
    return rows.map(toOperator);
  }

  async getOperatorByBadge(badgeId: string): Promise<Operator | undefined> {
    const rows = await this.db.select<OperatorRow[]>(
      `SELECT id, badge_id_norm, name, role, created_at
         FROM operators WHERE badge_id_norm = $1 LIMIT 1`,
      [normalizeId(badgeId)],
    );
    return rows[0] ? toOperator(rows[0]) : undefined;
  }

  async enrollOperator(
    badgeId: string,
    name: string,
    role: UserRole = 'operator',
  ): Promise<Operator> {
    const existing = await this.getOperatorByBadge(badgeId);
    if (existing) throw new Error(`Badge already enrolled to ${existing.name}`);

    const operator: Operator = {
      id: newId(),
      badgeIdNorm: normalizeId(badgeId),
      name: name.trim(),
      role,
      createdAt: nowIso(),
    };
    try {
      await this.db.execute(
        `INSERT INTO operators (id, badge_id_norm, name, role, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
        [operator.id, operator.badgeIdNorm, operator.name, operator.role, operator.createdAt],
      );
    } catch (err) {
      // The unique index is the real guard — the check above only improves the message.
      const again = await this.getOperatorByBadge(badgeId);
      if (again) throw new Error(`Badge already enrolled to ${again.name}`);
      throw err;
    }
    return operator;
  }

  async updateUserRole(operatorId: string, role: UserRole): Promise<Operator> {
    await this.db.execute(`UPDATE operators SET role = $1 WHERE id = $2`, [role, operatorId]);
    const rows = await this.db.select<OperatorRow[]>(
      `SELECT id, badge_id_norm, name, role, created_at FROM operators WHERE id = $1`,
      [operatorId],
    );
    if (!rows[0]) throw new Error(`User ${operatorId} not found`);
    return toOperator(rows[0]);
  }

  async removeOperator(operatorId: string): Promise<void> {
    await this.db.execute(`DELETE FROM operators WHERE id = $1`, [operatorId]);
  }

  // ---- Audit ---------------------------------------------------------

  async saveScanEvent(input: AuditInput): Promise<AuditEvent> {
    const event: AuditEvent = { ...input, id: newId(), ts: nowIso() };
    await this.db.execute(
      `INSERT INTO audit_events (id, ts, type, operator_id, operator_name, batch_number, detail)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        event.id,
        event.ts,
        event.type,
        event.operatorId,
        event.operatorName,
        event.batchNumber,
        event.detail,
      ],
    );
    return event;
  }

  /** LIMIT in SQL — the whole table is never read just to show the last few hundred. */
  async getAuditEvents(limit = 300): Promise<AuditEvent[]> {
    const rows = await this.db.select<AuditRow[]>(
      `SELECT id, ts, type, operator_id, operator_name, batch_number, detail
         FROM audit_events ORDER BY ts DESC LIMIT $1`,
      [limit],
    );
    return rows.map(toAuditEvent);
  }

  // ---- Settings ------------------------------------------------------

  async getSetting(key: string): Promise<string | null> {
    const rows = await this.db.select<{ value: string }[]>(
      `SELECT value FROM settings WHERE key = $1 LIMIT 1`,
      [key],
    );
    return rows[0]?.value ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.db.execute(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
      [key, value, nowIso()],
    );
  }
}
