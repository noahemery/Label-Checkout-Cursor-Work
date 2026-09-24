import Papa from 'papaparse';
import { batchBaseNumber, hasMalformedRunSuffix, splitSuffix } from '../domain/batchFamily';
import { normalizeId } from '../domain/normalize';
import { computeRunQuantities, formatRunsSummary } from '../domain/splitRuns';
import type { BatchInput } from './DataStore';

export type CsvField = keyof Omit<BatchInput, 'source' | 'sheetPageId' | 'orderTotalQty' | 'importId'>;

export const CSV_FIELD_LABELS: Record<CsvField, string> = {
  batchNumber: 'Batch Number',
  itemNumber: 'Item Number',
  productName: 'Product Name',
  labelCode: 'Label Code',
  upc: 'UPC / GTIN',
  quantity: 'Quantity',
  splitQty: 'Split (per run)',
  dom: 'Date of Manufacture',
  doe: 'Date of Expiration',
  deliveryDate: 'Delivery date (D365)',
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
    'production',
  ],
  itemNumber: ['item', 'itemnumber', 'itemno', 'itemcode', 'itemid', 'productnumber'],
  productName: ['product', 'productname', 'description', 'name', 'productdescription'],
  labelCode: ['label', 'labelcode', 'labelid', 'labelno', 'labelnumber'],
  upc: ['upc', 'upccode', 'gtin', 'ean', 'barcode'],
  quantity: ['qty', 'quantity', 'count', 'labels', 'labelqty', 'labelcount'],
  splitQty: ['split', 'splitqty', 'runsize', 'perrun', 'runqty', 'lotsize'],
  dom: ['dom', 'dateofmanufacture', 'mfgdate', 'manufacturedate', 'manufactured', 'proddate'],
  doe: [
    'doe',
    'dateofexpiration',
    'expdate',
    'expirationdate',
    'expiration',
    'expiry',
    'bestby',
  ],
  deliveryDate: ['delivery', 'deliverydate', 'shipdate', 'scheduleddelivery'],
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

/** Parse D365-style quantities like `6,000.00`. */
export function parseCsvQuantity(value: string): number | null {
  const cleaned = value.replace(/,/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isNaN(n) ? null : n;
}

function buildRowFromRecord(
  record: Record<string, string>,
  mapping: ColumnMapping,
): Omit<BatchInput, 'sheetPageId'> {
  const row: Omit<BatchInput, 'sheetPageId'> = { batchNumber: '' };
  for (const field of Object.keys(CSV_FIELD_LABELS) as CsvField[]) {
    const header = mapping[field];
    if (!header) continue;
    const value = record[header]?.trim();
    if (!value) continue;
    if (field === 'quantity' || field === 'splitQty') {
      row[field] = parseCsvQuantity(value);
    } else {
      row[field] = value;
    }
  }
  if (row.quantity != null) {
    row.orderTotalQty = row.quantity;
  }
  return row;
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

export interface CsvRowPreview {
  line: number;
  batchNumber: string;
  itemNumber: string | null;
  productName: string | null;
  labelCode: string | null;
  quantity: number | null;
  splitQty: number | null;
  orderTotalQty: number | null;
  runsSummary: string;
  dom: string | null;
  doe: string | null;
  deliveryDate: string | null;
  familyLabel: string | null;
  warnings: string[];
}

export interface CsvImportAnalysis {
  rows: Omit<BatchInput, 'sheetPageId'>[];
  previews: CsvRowPreview[];
  parseErrors: string[];
  globalWarnings: string[];
  stats: {
    /** CSV rows before split expansion — parent orders + standalone child rows. */
    sourceOrders: number;
    /** Expanded label rows ready to import (after split). */
    total: number;
    missingLabelCode: number;
    duplicateInFile: number;
    multiBatchFamilies: number;
    autoGeneratedChildren: number;
    /** Child runs (-NN) whose parent batch is absent from the file. */
    orphanChildren: number;
    /** Batch numbers ending in -digits that are not the two-digit run suffix. */
    malformedSuffixes: number;
  };
  mappingUsed: ColumnMapping;
}

const EMPTY_STATS: CsvImportAnalysis['stats'] = {
  sourceOrders: 0,
  total: 0,
  missingLabelCode: 0,
  duplicateInFile: 0,
  multiBatchFamilies: 0,
  autoGeneratedChildren: 0,
  orphanChildren: 0,
  malformedSuffixes: 0,
};

/** Comma-joined batch numbers for a warning, capped so long lists stay readable. */
function nameList(names: string[], max = 5): string {
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} +${names.length - max} more`;
}

function buildFamilyLabels(batchNumbers: string[]): Map<string, string> {
  const byBase = new Map<string, string[]>();
  for (const bn of batchNumbers) {
    const base = batchBaseNumber(bn);
    const list = byBase.get(base) ?? [];
    list.push(bn);
    byBase.set(base, list);
  }
  const labels = new Map<string, string>();
  for (const family of byBase.values()) {
    if (family.length <= 1) continue;
    for (const bn of family) {
      const suffix = splitSuffix(bn);
      labels.set(bn, suffix ? `-${suffix}` : 'PARENT');
    }
  }
  return labels;
}

/**
 * When a parent row has split < total quantity, expand into parent (run 1) +
 * child batches -02, -03, … one per additional run. Skips children already in CSV.
 */
export function expandSplitBatches(
  raw: { row: Omit<BatchInput, 'sheetPageId'>; line: number }[],
): {
  rows: Omit<BatchInput, 'sheetPageId'>[];
  lineNumbers: (number | null)[];
  generatedCount: number;
} {
  const existingNorms = new Set(raw.map((r) => normalizeId(r.row.batchNumber)));
  const result: Omit<BatchInput, 'sheetPageId'>[] = [];
  const lineNumbers: (number | null)[] = [];
  let generatedCount = 0;

  for (const { row, line } of raw) {
    const base = batchBaseNumber(row.batchNumber);
    const isChild = splitSuffix(row.batchNumber) !== null;
    const total = row.quantity;
    const split = row.splitQty;

    if (isChild || total == null || total <= 0 || !split || split <= 0 || split >= total) {
      result.push({
        ...row,
        orderTotalQty: row.orderTotalQty ?? row.quantity ?? null,
      });
      lineNumbers.push(line);
      continue;
    }

    const runs = computeRunQuantities(total, split);
    if (runs.length <= 1) {
      result.push({
        ...row,
        orderTotalQty: row.orderTotalQty ?? total,
      });
      lineNumbers.push(line);
      continue;
    }

    result.push({
      ...row,
      quantity: runs[0],
      splitQty: split,
      orderTotalQty: total,
    });
    lineNumbers.push(line);

    for (let i = 1; i < runs.length; i++) {
      const suffix = String(i + 1).padStart(2, '0');
      const childNumber = `${base}-${suffix}`;
      const childNorm = normalizeId(childNumber);
      if (existingNorms.has(childNorm)) continue;

      result.push({
        ...row,
        batchNumber: childNumber,
        quantity: runs[i],
        splitQty: split,
        orderTotalQty: total,
      });
      lineNumbers.push(null);
      existingNorms.add(childNorm);
      generatedCount++;
    }
  }

  return { rows: result, lineNumbers, generatedCount };
}

function analyzeRows(
  rows: Omit<BatchInput, 'sheetPageId'>[],
  lineNumbers: (number | null)[],
  parseErrors: string[],
  mapping: ColumnMapping,
  autoGeneratedChildren: number,
  sourceOrders: number,
): CsvImportAnalysis {
  const globalWarnings: string[] = [];
  const batchCounts = new Map<string, number>();
  const batchNumbers = rows.map((r) => r.batchNumber);
  const familyLabels = buildFamilyLabels(batchNumbers);

  for (const bn of batchNumbers) {
    batchCounts.set(bn, (batchCounts.get(bn) ?? 0) + 1);
  }

  const duplicateInFile = [...batchCounts.values()].filter((c) => c > 1).length;
  if (duplicateInFile > 0) {
    globalWarnings.push(
      `${duplicateInFile} batch number${duplicateInFile === 1 ? '' : 's'} appear more than once in this file — only the first will import; others will be skipped.`,
    );
  }

  const missingLabelCode = rows.filter((r) => !r.labelCode?.trim()).length;
  if (missingLabelCode > 0) {
    globalWarnings.push(
      `${missingLabelCode} row${missingLabelCode === 1 ? '' : 's'} missing label code — QR generation will not work for those batches until label code is mapped.`,
    );
  }

  if (!mapping.labelCode) {
    globalWarnings.push('Label Code column is not mapped — label codes will be empty.');
  }

  // Family count is normal on any real export — reported as a neutral stat, not a warning.
  const familyGroupCount = new Set(
    batchNumbers.filter((bn) => familyLabels.has(bn)).map((bn) => batchBaseNumber(bn)),
  ).size;

  // A child run whose parent is missing: the run count for that order is unknowable,
  // and checkout export would cite a parent batch this run never saw.
  const basesWithParent = new Set(
    rows
      .filter((r) => splitSuffix(r.batchNumber) === null)
      .map((r) => batchBaseNumber(r.batchNumber)),
  );
  const orphanChildBatches = batchNumbers.filter(
    (bn) => splitSuffix(bn) !== null && !basesWithParent.has(batchBaseNumber(bn)),
  );
  const orphanChildren = new Set(orphanChildBatches);
  if (orphanChildren.size > 0) {
    const missingParents = [...new Set(orphanChildBatches.map(batchBaseNumber))];
    globalWarnings.push(
      `${orphanChildren.size} child batch${orphanChildren.size === 1 ? '' : 'es'} reference a parent order not in this file: ${nameList(missingParents)}. Check D365 for the missing runs before checking these out.`,
    );
  }

  const malformedBatches = batchNumbers.filter(hasMalformedRunSuffix);
  const malformedSuffixes = new Set(malformedBatches);
  if (malformedSuffixes.size > 0) {
    globalWarnings.push(
      `${malformedSuffixes.size} batch number${malformedSuffixes.size === 1 ? '' : 's'} end in an unrecognized run suffix (expected two digits, e.g. -02): ${nameList([...malformedSuffixes])}. They will import as standalone orders.`,
    );
  }

  if (autoGeneratedChildren > 0) {
    globalWarnings.push(
      `${autoGeneratedChildren} child batch${autoGeneratedChildren === 1 ? '' : 'es'} auto-generated from Split column (extra production runs).`,
    );
  }

  const previews: CsvRowPreview[] = rows.map((row, i) => {
    const warnings: string[] = [];
    if (!row.labelCode?.trim()) warnings.push('Missing label code');
    if ((batchCounts.get(row.batchNumber) ?? 0) > 1) warnings.push('Duplicate batch in file');
    const familyLabel = familyLabels.get(row.batchNumber) ?? null;
    if (orphanChildren.has(row.batchNumber)) {
      warnings.push('Child batch with no parent row in file');
    }
    if (malformedSuffixes.has(row.batchNumber)) {
      warnings.push('Unrecognized run suffix — expected two digits (-02, -03)');
    }
    if (lineNumbers[i] === null) warnings.push('Auto-generated from parent split');
    if (
      row.splitQty &&
      row.quantity &&
      row.splitQty < row.quantity &&
      !splitSuffix(row.batchNumber) &&
      lineNumbers[i] !== null
    ) {
      warnings.push(`Will split into ${formatRunsSummary(row.quantity, row.splitQty)}`);
    }
    return {
      line: lineNumbers[i] ?? 0,
      batchNumber: row.batchNumber,
      itemNumber: row.itemNumber ?? null,
      productName: row.productName ?? null,
      labelCode: row.labelCode ?? null,
      quantity: row.quantity ?? null,
      splitQty: row.splitQty ?? null,
      orderTotalQty: row.orderTotalQty ?? row.quantity ?? null,
      runsSummary: formatRunsSummary(row.orderTotalQty ?? row.quantity, row.splitQty),
      dom: row.dom ?? null,
      doe: row.doe ?? null,
      deliveryDate: row.deliveryDate ?? null,
      familyLabel,
      warnings,
    };
  });

  return {
    rows,
    previews,
    parseErrors,
    globalWarnings,
    stats: {
      sourceOrders,
      total: rows.length,
      missingLabelCode,
      duplicateInFile,
      multiBatchFamilies: familyGroupCount,
      autoGeneratedChildren,
      orphanChildren: orphanChildren.size,
      malformedSuffixes: malformedSuffixes.size,
    },
    mappingUsed: mapping,
  };
}

export function analyzeCsvWithMapping(
  file: File,
  mapping: ColumnMapping,
): Promise<CsvImportAnalysis> {
  return new Promise((resolve) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (result) => {
        const parseErrors = result.errors.slice(0, 5).map((e) => e.message);
        if (!mapping.batchNumber) {
          resolve({
            rows: [],
            previews: [],
            parseErrors: ['Batch Number column is required — pick a column in the mapping table.'],
            globalWarnings: [],
            stats: EMPTY_STATS,
            mappingUsed: mapping,
          });
          return;
        }

        const rawRows: { row: Omit<BatchInput, 'sheetPageId'>; line: number }[] = [];
        result.data.forEach((record, index) => {
          const row = buildRowFromRecord(record, mapping);
          if (!row.batchNumber) return;
          rawRows.push({ row, line: index + 2 });
        });

        const { rows, lineNumbers, generatedCount } = expandSplitBatches(rawRows);
        resolve(analyzeRows(rows, lineNumbers, parseErrors, mapping, generatedCount, rawRows.length));
      },
      error: (err) =>
        resolve({
          rows: [],
          previews: [],
          parseErrors: [err.message],
          globalWarnings: [],
          stats: EMPTY_STATS,
          mappingUsed: mapping,
        }),
    });
  });
}

export function parseCsvWithMapping(
  file: File,
  mapping: ColumnMapping,
): Promise<CsvParseResult> {
  return analyzeCsvWithMapping(file, mapping).then((analysis) => ({
    rows: analysis.rows,
    errors: analysis.parseErrors,
    mappingUsed: analysis.mappingUsed,
  }));
}
