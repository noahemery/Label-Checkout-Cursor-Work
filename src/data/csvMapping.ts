import Papa from 'papaparse';
import type { BatchInput } from './DataStore';

export type CsvField = keyof Omit<BatchInput, 'source' | 'sheetPageId'>;

export const CSV_FIELD_LABELS: Record<CsvField, string> = {
  batchNumber: 'Batch Number',
  itemNumber: 'Item Number',
  productName: 'Product Name',
  labelCode: 'Label Code',
  upc: 'UPC / GTIN',
  quantity: 'Quantity',
  dom: 'Date of Manufacture',
  doe: 'Date of Expiration',
};

export const CSV_REQUIRED: Set<CsvField> = new Set(['batchNumber']);

/** Aliases matched after lowercasing and stripping punctuation. */
export const HEADER_ALIASES: Record<CsvField, string[]> = {
  batchNumber: [
    'batch',
    'batchnumber',
    'batchno',
    'batchid',
    'lot',
    'lotnumber',
    'childbatch',
    'productionbatch',
    'inventbatchid',
  ],
  itemNumber: ['item', 'itemnumber', 'itemno', 'itemcode', 'itemid', 'productnumber'],
  productName: ['product', 'productname', 'description', 'name', 'productdescription'],
  labelCode: ['label', 'labelcode', 'labelid', 'labelno', 'labelnumber'],
  upc: ['upc', 'upccode', 'gtin', 'ean', 'barcode'],
  quantity: ['qty', 'quantity', 'count', 'labels', 'labelqty', 'labelcount'],
  dom: ['dom', 'dateofmanufacture', 'mfgdate', 'manufacturedate', 'manufactured', 'proddate'],
  doe: ['doe', 'dateofexpiration', 'expdate', 'expirationdate', 'expiration', 'expiry', 'bestby'],
};

export type ColumnMapping = Partial<Record<CsvField, string>>;

const MAPPING_STORAGE_KEY = 'lvs-csv-column-mapping';

export function loadSavedColumnMapping(): ColumnMapping {
  try {
    const raw = localStorage.getItem(MAPPING_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as ColumnMapping;
  } catch {
    /* ignore */
  }
  return {};
}

export function saveColumnMapping(mapping: ColumnMapping): void {
  localStorage.setItem(MAPPING_STORAGE_KEY, JSON.stringify(mapping));
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function autoDetectMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  for (const header of headers) {
    const norm = normalizeHeader(header);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [CsvField, string[]][]) {
      if (mapping[field]) continue;
      if (aliases.includes(norm)) {
        mapping[field] = header;
        break;
      }
    }
  }
  return mapping;
}

export function peekCsvHeaders(file: File): Promise<{ headers: string[]; errors: string[] }> {
  return new Promise((resolve) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      preview: 1,
      skipEmptyLines: true,
      complete: (result) => {
        resolve({
          headers: result.meta.fields ?? [],
          errors: result.errors.slice(0, 3).map((e) => e.message),
        });
      },
      error: (err) => resolve({ headers: [], errors: [err.message] }),
    });
  });
}

export interface CsvParseResult {
  rows: Omit<BatchInput, 'sheetPageId'>[];
  errors: string[];
  mappingUsed: ColumnMapping;
}

export function parseCsvWithMapping(
  file: File,
  mapping: ColumnMapping,
): Promise<CsvParseResult> {
  return new Promise((resolve) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (result) => {
        const errors: string[] = result.errors.slice(0, 5).map((e) => e.message);
        if (!mapping.batchNumber) {
          resolve({
            rows: [],
            errors: ['Batch Number column is required — pick a column in the mapping table.'],
            mappingUsed: mapping,
          });
          return;
        }

        const rows: Omit<BatchInput, 'sheetPageId'>[] = [];
        for (const record of result.data) {
          const row: Omit<BatchInput, 'sheetPageId'> = { batchNumber: '' };
          for (const field of Object.keys(CSV_FIELD_LABELS) as CsvField[]) {
            const header = mapping[field];
            if (!header) continue;
            const value = record[header]?.trim();
            if (!value) continue;
            if (field === 'quantity') {
              const n = Number(value);
              row.quantity = Number.isNaN(n) ? null : n;
            } else {
              row[field] = value;
            }
          }
          if (row.batchNumber) rows.push(row);
        }
        resolve({ rows, errors, mappingUsed: mapping });
      },
      error: (err) =>
        resolve({ rows: [], errors: [err.message], mappingUsed: mapping }),
    });
  });
}
