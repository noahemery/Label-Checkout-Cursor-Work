import type { Operator, UserRole } from '../domain/types';

/**
 * The badge roster as a file, so one station's enrollments can be carried to
 * another without re-scanning thirty badges by hand.
 *
 * This is deliberately one-directional: a station **exports** its roster and
 * another **imports** it. There is no merge of two divergent rosters, because
 * there is no correct answer when both sides changed the same person. Whoever
 * maintains the roster exports; everyone else imports.
 *
 * When the server lands this file retires — the roster becomes an API call and
 * `upsertOperators` is what that adapter will call too.
 */

export const ROSTER_FILE_KIND = 'lvs-roster';
export const ROSTER_FILE_VERSION = 1;

export interface RosterFile {
  kind: typeof ROSTER_FILE_KIND;
  version: number;
  exportedAt: string;
  operators: Operator[];
}

export interface RosterImportResult {
  added: number;
  updated: number;
  unchanged: number;
}

function isRole(value: unknown): value is UserRole {
  return value === 'admin' || value === 'operator';
}

/**
 * Read one operator out of parsed JSON.
 *
 * `badgeIdNorm` and `name` are the only fields a roster cannot do without.
 * `id` is carried across so audit rows written on either station point at the
 * same person once the trails are aggregated; a file missing it still imports,
 * the importing station just mints a new one.
 */
function toOperator(raw: unknown): Operator | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const badgeIdNorm = typeof o.badgeIdNorm === 'string' ? o.badgeIdNorm.trim() : '';
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  if (!badgeIdNorm || !name) return null;

  return {
    id: typeof o.id === 'string' && o.id ? o.id : crypto.randomUUID(),
    badgeIdNorm,
    name,
    role: isRole(o.role) ? o.role : 'operator',
    createdAt: typeof o.createdAt === 'string' && o.createdAt ? o.createdAt : new Date().toISOString(),
  };
}

export function buildRosterFile(operators: Operator[]): RosterFile {
  return {
    kind: ROSTER_FILE_KIND,
    version: ROSTER_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    operators: [...operators].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export class RosterParseError extends Error {}

/**
 * Parse a roster file, rejecting anything that is not clearly one.
 *
 * A wrong file picked by mistake must fail loudly here rather than import zero
 * operators and look like it worked.
 */
export function parseRosterFile(text: string): Operator[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RosterParseError('That file is not valid JSON — pick a roster file exported from Admin.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new RosterParseError('That file is not a roster export.');
  }

  const file = parsed as Record<string, unknown>;
  if (file.kind !== ROSTER_FILE_KIND) {
    throw new RosterParseError(
      'That file is not a roster export. Use "Export roster" on the station that has the badges.',
    );
  }
  if (typeof file.version !== 'number' || file.version > ROSTER_FILE_VERSION) {
    throw new RosterParseError(
      `That roster was written by a newer version of the app (file version ${String(file.version)}). Update this station first.`,
    );
  }
  if (!Array.isArray(file.operators)) {
    throw new RosterParseError('That roster file has no operators list.');
  }

  const operators = file.operators.map(toOperator).filter((o): o is Operator => o !== null);
  if (operators.length === 0) {
    throw new RosterParseError('That roster file has no usable badge entries.');
  }

  // Two rows for one badge would make the import order decide who wins.
  const seen = new Set<string>();
  const deduped: Operator[] = [];
  for (const op of operators) {
    if (seen.has(op.badgeIdNorm)) continue;
    seen.add(op.badgeIdNorm);
    deduped.push(op);
  }
  return deduped;
}

export function rosterFilename(now = new Date()): string {
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  return `label-verification-roster-${stamp}.json`;
}

/** Hand the roster to the browser/webview as a download. */
export function downloadRoster(operators: Operator[]): string {
  const file = buildRosterFile(operators);
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const filename = rosterFilename();
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
  return filename;
}

export function summarizeRosterImport(result: RosterImportResult): string {
  const parts: string[] = [];
  if (result.added > 0) parts.push(`${result.added} added`);
  if (result.updated > 0) parts.push(`${result.updated} updated`);
  if (result.unchanged > 0) parts.push(`${result.unchanged} already matched`);
  return parts.length > 0 ? parts.join(', ') : 'nothing to change';
}
