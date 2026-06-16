import {
  autoDetectMapping,
  parseCsvWithMapping,
  peekCsvHeaders,
} from './csvMapping';
import type { CsvParseResult } from './csvMapping';

export type { CsvParseResult, ColumnMapping, CsvField } from './csvMapping';
export {
  CSV_FIELD_LABELS,
  CSV_REQUIRED,
  HEADER_ALIASES,
  autoDetectMapping,
  loadSavedColumnMapping,
  saveColumnMapping,
  peekCsvHeaders,
  parseCsvWithMapping,
} from './csvMapping';

/** Legacy import path — auto-detects column mapping from headers. */
export function parseCsvFile(file: File): Promise<CsvParseResult> {
  return peekCsvHeaders(file).then(({ headers, errors }) => {
    if (headers.length === 0) {
      return { rows: [], errors: errors.length ? errors : ['No headers found in file.'], mappingUsed: {} };
    }
    const mapping = autoDetectMapping(headers);
    if (!mapping.batchNumber) {
      return {
        rows: [],
        errors: [
          `No batch number column found. Headers seen: ${headers.join(', ') || '(none)'}`,
        ],
        mappingUsed: mapping,
      };
    }
    return parseCsvWithMapping(file, mapping);
  });
}
