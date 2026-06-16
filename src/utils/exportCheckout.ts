import { batchBaseNumber, isParentBatch } from '../domain/batchFamily';
import { normalizeId } from '../domain/normalize';
import type { AuditEvent, AuditType, Batch } from '../domain/types';
import { getShiftSession, todayExportDate } from './shiftSession';

const CHECKOUT_TYPES = new Set<AuditType>(['verify', 'mismatch', 'flag', 'reopen']);

const RESULT_LABEL: Partial<Record<AuditType, string>> = {
  verify: 'Verified',
  mismatch: 'Mismatch',
  flag: 'Flagged',
  reopen: 'Re-opened',
};

export interface CheckoutExportRow {
  operator: string;
  childBatch: string;
  parentBatch: string;
  itemNumber: string;
  quantity: string;
  scanResult: string;
  timestamp: string;
}

const CSV_HEADERS: (keyof CheckoutExportRow)[] = [
  'operator',
  'childBatch',
  'parentBatch',
  'itemNumber',
  'quantity',
  'scanResult',
  'timestamp',
];

const CSV_HEADER_LABELS: Record<keyof CheckoutExportRow, string> = {
  operator: 'Operator',
  childBatch: 'Child Batch',
  parentBatch: 'Parent Batch',
  itemNumber: 'Item Number',
  quantity: 'Quantity',
  scanResult: 'Scan Result',
  timestamp: 'Timestamp',
};

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function findBatch(batches: Batch[], batchNumber: string | null): Batch | undefined {
  if (!batchNumber) return undefined;
  const norm = normalizeId(batchNumber);
  return batches.find((b) => b.batchNumberNorm === norm);
}

export function filterCheckoutEvents(audit: AuditEvent[]): AuditEvent[] {
  return audit
    .filter((e) => CHECKOUT_TYPES.has(e.type))
    .sort((a, b) => a.ts.localeCompare(b.ts));
}

export function buildCheckoutRows(
  audit: AuditEvent[],
  batches: Batch[],
): CheckoutExportRow[] {
  return filterCheckoutEvents(audit).map((e) => {
    const child = e.batchNumber ?? '';
    const batch = findBatch(batches, child);
    const parent = child && !isParentBatch(child) ? batchBaseNumber(child) : child;
    return {
      operator: e.operatorName ?? '',
      childBatch: child,
      parentBatch: parent,
      itemNumber: batch?.itemNumber ?? '',
      quantity: batch?.quantity != null ? String(batch.quantity) : '',
      scanResult: RESULT_LABEL[e.type] ?? e.type,
      timestamp: formatTimestamp(e.ts),
    };
  });
}

export function buildCheckoutCsv(audit: AuditEvent[], batches: Batch[]): string {
  const rows = buildCheckoutRows(audit, batches);
  const headerLine = CSV_HEADERS.map((k) => escapeCsvCell(CSV_HEADER_LABELS[k])).join(',');
  const lines = [
    headerLine,
    ...rows.map((r) => CSV_HEADERS.map((k) => escapeCsvCell(r[k])).join(',')),
  ];
  return lines.join('\r\n');
}

function exportFilename(): string {
  const session = getShiftSession();
  return `label-checkout-${todayExportDate()}-${session.id}.csv`;
}

export function downloadCheckoutCsv(audit: AuditEvent[], batches: Batch[]): number {
  const rows = buildCheckoutRows(audit, batches);
  const csv = buildCheckoutCsv(audit, batches);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = exportFilename();
  anchor.click();
  URL.revokeObjectURL(url);
  return rows.length;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function openPrintableCheckoutSummary(
  audit: AuditEvent[],
  batches: Batch[],
  sheetReference?: string,
): number {
  const session = getShiftSession();
  const rows = buildCheckoutRows(audit, batches);
  const verifiedCount = rows.filter((r) => r.scanResult === 'Verified').length;
  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const tableRows = rows
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.timestamp)}</td><td>${escapeHtml(r.operator)}</td><td>${escapeHtml(r.childBatch)}</td><td>${escapeHtml(r.parentBatch)}</td><td>${escapeHtml(r.itemNumber)}</td><td>${escapeHtml(r.quantity)}</td><td class="result-${r.scanResult.toLowerCase()}">${escapeHtml(r.scanResult)}</td></tr>`,
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Label Checkout Summary — ${escapeHtml(todayExportDate())}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; margin: 0; padding: 24px 32px; color: #111; }
    header { border-bottom: 3px solid #1a5276; padding-bottom: 16px; margin-bottom: 20px; }
    .brand { font-size: 13px; letter-spacing: 0.12em; text-transform: uppercase; color: #555; }
    h1 { margin: 4px 0 8px; font-size: 26px; }
    .meta { display: flex; flex-wrap: wrap; gap: 24px; font-size: 14px; color: #333; }
    .meta strong { color: #111; }
    .stats { margin: 16px 0; padding: 12px 16px; background: #eef6ee; border: 1px solid #b8ddb8; border-radius: 8px; font-size: 15px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; background: #1a5276; color: #fff; padding: 10px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
    td { padding: 8px 12px; border-bottom: 1px solid #ddd; vertical-align: top; }
    tr:nth-child(even) td { background: #f7f9fb; }
    .result-verified { color: #1e7e34; font-weight: 700; }
    .result-mismatch, .result-flagged { color: #c0392b; font-weight: 700; }
    .result-re-opened { color: #b7770a; font-weight: 700; }
    footer { margin-top: 24px; font-size: 11px; color: #888; }
    @media print {
      body { padding: 12px 16px; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">Alltech · Nicholasville</div>
    <h1>Label Verification — Checkout Summary</h1>
    <div class="meta">
      <span><strong>Date:</strong> ${escapeHtml(dateLabel)}</span>
      <span><strong>Shift:</strong> ${escapeHtml(session.shift)}</span>
      <span><strong>Session:</strong> ${escapeHtml(session.id)}</span>
      ${sheetReference ? `<span><strong>Log sheet:</strong> ${escapeHtml(sheetReference)}</span>` : ''}
    </div>
  </header>
  <div class="stats">
    <strong>${verifiedCount}</strong> verified · <strong>${rows.length}</strong> total checkout events
  </div>
  ${
    rows.length === 0
      ? '<p>No checkout events recorded for this session.</p>'
      : `<table>
    <thead><tr>
      <th>Timestamp</th><th>Operator</th><th>Child Batch</th><th>Parent Batch</th>
      <th>Item Number</th><th>Quantity</th><th>Scan Result</th>
    </tr></thead>
    <tbody>${tableRows}</tbody>
  </table>`
  }
  <footer>Generated ${escapeHtml(new Date().toLocaleString())} · Label Verification System (FMI B001 companion)</footer>
  <p class="no-print" style="margin-top:20px"><button onclick="window.print()">Print</button></p>
  <script>window.onload=function(){window.print()}</script>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) return 0;
  win.document.write(html);
  win.document.close();
  return rows.length;
}
