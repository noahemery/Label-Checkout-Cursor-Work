/**
 * SQLite schema for the desktop (Tauri) build.
 *
 * Built fresh rather than ported from the IndexedDB migration history — the
 * legacy sheet-photo store, the multi-page sheet model, and the batch sources
 * that were never written are all left out deliberately.
 *
 * Every statement is idempotent so this can run on each launch.
 */

/** Bump when SCHEMA_STATEMENTS changes in a way existing databases must follow. */
export const SCHEMA_VERSION = 1;

/**
 * Audit history is immutable. Deletes are blocked unless the retention gate is
 * opened, which only the archive-then-prune routine is allowed to do.
 */
export const AUDIT_RETENTION_GATE = '_audit_retention_gate';

/** WAL is a file-level setting; applied once via SELECT in SqliteStore.open. */
export const WAL_PRAGMA = `PRAGMA journal_mode = WAL`;

export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS schema_meta (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS import_sessions (
     id          TEXT PRIMARY KEY,
     page_id     TEXT NOT NULL,
     filename    TEXT NOT NULL,
     imported_at TEXT NOT NULL,
     label_count INTEGER NOT NULL DEFAULT 0
   )`,

  `CREATE INDEX IF NOT EXISTS ix_import_sessions_page
     ON import_sessions (page_id, imported_at DESC)`,

  `CREATE TABLE IF NOT EXISTS batches (
     id                   TEXT PRIMARY KEY,
     batch_number         TEXT NOT NULL,
     batch_number_norm    TEXT NOT NULL,
     item_number          TEXT,
     product_name         TEXT,
     label_code           TEXT,
     upc                  TEXT,
     quantity             REAL,
     split_qty            REAL,
     order_total_qty      REAL,
     dom                  TEXT,
     doe                  TEXT,
     delivery_date        TEXT,
     reference_qr_payload TEXT,
     status               TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'verified', 'flagged')),
     verified_at          TEXT,
     verified_by_id       TEXT,
     verified_by_name     TEXT,
     created_at           TEXT NOT NULL,
     source               TEXT NOT NULL,
     sheet_page_id        TEXT NOT NULL,
     import_id            TEXT REFERENCES import_sessions (id) ON DELETE SET NULL
   )`,

  // Enforces the import dedup rule in the database instead of a per-row lookup.
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_batches_page_norm
     ON batches (sheet_page_id, batch_number_norm)`,

  `CREATE INDEX IF NOT EXISTS ix_batches_page ON batches (sheet_page_id)`,
  `CREATE INDEX IF NOT EXISTS ix_batches_import ON batches (import_id)`,

  `CREATE TABLE IF NOT EXISTS operators (
     id            TEXT PRIMARY KEY,
     badge_id_norm TEXT NOT NULL UNIQUE,
     name          TEXT NOT NULL,
     role          TEXT NOT NULL DEFAULT 'operator'
                   CHECK (role IN ('admin', 'operator')),
     created_at    TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS audit_events (
     id            TEXT PRIMARY KEY,
     ts            TEXT NOT NULL,
     type          TEXT NOT NULL,
     operator_id   TEXT,
     operator_name TEXT,
     batch_number  TEXT,
     detail        TEXT NOT NULL
   )`,

  `CREATE INDEX IF NOT EXISTS ix_audit_ts ON audit_events (ts DESC)`,

  `CREATE TABLE IF NOT EXISTS ${AUDIT_RETENTION_GATE} (
     id       INTEGER PRIMARY KEY CHECK (id = 1),
     unlocked INTEGER NOT NULL DEFAULT 0
   )`,

  `INSERT OR IGNORE INTO ${AUDIT_RETENTION_GATE} (id, unlocked) VALUES (1, 0)`,

  // An audit row may never be rewritten. This is the whole point of the trail.
  `CREATE TRIGGER IF NOT EXISTS trg_audit_no_update
     BEFORE UPDATE ON audit_events
     BEGIN
       SELECT RAISE(ABORT, 'audit_events is append-only');
     END`,

  `CREATE TRIGGER IF NOT EXISTS trg_audit_no_delete
     BEFORE DELETE ON audit_events
     WHEN (SELECT unlocked FROM ${AUDIT_RETENTION_GATE} WHERE id = 1) = 0
     BEGIN
       SELECT RAISE(ABORT, 'audit_events delete requires the retention gate');
     END`,

  // Station configuration lives here so a copy of the database file captures it.
  `CREATE TABLE IF NOT EXISTS settings (
     key        TEXT PRIMARY KEY,
     value      TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
];
