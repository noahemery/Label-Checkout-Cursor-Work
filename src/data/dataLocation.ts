/** Set once, when the shared database was copied from a per-account one. */
export const DB_MIGRATED_KEY = 'lvs-db-migrated-from';

export interface DbMigrationRecord {
  from: string;
  at: string;
}

export function parseDbMigration(raw: string | null): DbMigrationRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DbMigrationRecord>;
    return typeof parsed.from === 'string' && typeof parsed.at === 'string'
      ? { from: parsed.from, at: parsed.at }
      : null;
  } catch {
    return null;
  }
}
