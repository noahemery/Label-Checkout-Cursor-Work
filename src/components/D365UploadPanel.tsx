import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useAppData } from '../data/AppDataContext';
import {
  CSV_FIELD_LABELS,
  CSV_REQUIRED,
  analyzeCsvWithMapping,
  autoDetectMapping,
  loadSavedColumnMapping,
  saveColumnMapping,
  peekCsvHeaders,
  type ColumnMapping,
  type CsvField,
  type CsvImportAnalysis,
} from '../data/csvMapping';
import { useSheetPage } from '../data/SheetPageContext';
import { useSession } from '../session/SessionContext';

const FIELDS = Object.keys(CSV_FIELD_LABELS) as CsvField[];

interface ImportFeedback {
  filename: string;
  /** Parent orders + standalone child rows from the CSV (before split expansion). */
  ordersLoaded: number;
  labelsLoaded: number;
  skipped: number;
  totalLabels: number;
}

function normalizeImportFeedback(raw: unknown): ImportFeedback | null {
  if (!raw || typeof raw !== 'object') return null;
  const fb = raw as Record<string, unknown>;
  if (typeof fb.filename !== 'string') return null;
  // Legacy shape stored expanded label count in `added`.
  const ordersLoaded =
    typeof fb.ordersLoaded === 'number'
      ? fb.ordersLoaded
      : typeof fb.added === 'number'
        ? fb.added
        : 0;
  const totalLabels =
    typeof fb.totalLabels === 'number'
      ? fb.totalLabels
      : typeof fb.totalOnPage === 'number'
        ? fb.totalOnPage
        : 0;
  return {
    filename: fb.filename,
    ordersLoaded,
    labelsLoaded: typeof fb.labelsLoaded === 'number' ? fb.labelsLoaded : ordersLoaded,
    skipped: typeof fb.skipped === 'number' ? fb.skipped : 0,
    totalLabels,
  };
}

type ImportStep = 'mapping' | 'preview';

const SAMPLE_EXPORT_URL = '/sample-d365-export.csv';
const SAMPLE_EXPORT_NAME = 'sample-d365-export.csv';

export function D365UploadPanel({ onOpenTestLabels }: { onOpenTestLabels?: () => void }) {
  const { store, refreshBatches, refreshImportSessions, logAudit } = useAppData();
  const { activePageId, clearPrintRun, pageBatches } = useSheetPage();
  const { operator } = useSession();
  const fileRef = useRef<HTMLInputElement>(null);

  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>(() => loadSavedColumnMapping());
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [step, setStep] = useState<ImportStep>('mapping');
  const [analysis, setAnalysis] = useState<CsvImportAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ImportFeedback | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`lvs-d365-last-import-${activePageId}`);
      setFeedback(normalizeImportFeedback(raw ? JSON.parse(raw) : null));
    } catch {
      setFeedback(null);
    }
  }, [activePageId]);

  const resetImportFlow = () => {
    setImportOpen(false);
    setStep('mapping');
    setAnalysis(null);
    setPendingFile(null);
    setHeaders([]);
    setError(null);
  };

  const beginImportFile = (file: File) => {
    setError(null);
    setAnalysis(null);
    setStep('mapping');
    setBusy(true);
    void peekCsvHeaders(file)
      .then(({ headers: h, errors }) => {
        if (h.length === 0) {
          setError(errors[0] ?? 'Could not read column headers from that file.');
          return;
        }
        const saved = loadSavedColumnMapping();
        const detected = autoDetectMapping(h);
        const merged = { ...saved, ...detected };
        setHeaders(h);
        setMapping(merged);
        setPendingFile(file);
        setImportOpen(true);
      })
      .finally(() => setBusy(false));
  };

  const onFilePick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    beginImportFile(file);
  };

  const loadSampleExport = () => {
    setError(null);
    setBusy(true);
    void fetch(SAMPLE_EXPORT_URL)
      .then((res) => {
        if (!res.ok) throw new Error('Could not load the sample export.');
        return res.blob();
      })
      .then((blob) => {
        const file = new File([blob], SAMPLE_EXPORT_NAME, { type: 'text/csv' });
        beginImportFile(file);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Could not load the sample export.');
        setBusy(false);
      });
  };

  const setFieldMapping = (field: CsvField, header: string) => {
    setMapping((m) => {
      const next = { ...m };
      if (!header) delete next[field];
      else next[field] = header;
      return next;
    });
    setAnalysis(null);
    setStep('mapping');
  };

  const runPreview = () => {
    if (!pendingFile) return;
    if (!mapping.batchNumber) {
      setError('Batch Number column is required.');
      return;
    }
    setBusy(true);
    setError(null);
    void analyzeCsvWithMapping(pendingFile, mapping)
      .then((result) => {
        if (result.rows.length === 0) {
          setError(result.parseErrors[0] ?? 'No batch rows found in file.');
          return;
        }
        setAnalysis(result);
        setStep('preview');
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Preview failed.');
      })
      .finally(() => setBusy(false));
  };

  const runImport = () => {
    if (!pendingFile || !analysis) return;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        saveColumnMapping(mapping);
        const result = await store.importBatches(activePageId, analysis.rows, {
          filename: pendingFile.name,
        });
        await refreshBatches();
        await refreshImportSessions();
        const onPage = await store.getBatchesForPage(activePageId);
        const fb: ImportFeedback = {
          filename: pendingFile.name,
          ordersLoaded: analysis.stats.sourceOrders,
          labelsLoaded: result.added,
          skipped: result.skipped,
          totalLabels: onPage.length,
        };
        setFeedback(fb);
        localStorage.setItem(`lvs-d365-last-import-${activePageId}`, JSON.stringify(fb));
        await logAudit({
          type: 'csv_import',
          operatorId: operator?.id ?? null,
          operatorName: operator?.name ?? null,
          batchNumber: null,
          detail: `D365 import "${pendingFile.name}": ${analysis.stats.sourceOrders} orders (${result.added} labels) added, ${result.skipped} skipped → ${onPage.length} labels in print run`,
        });
        resetImportFlow();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Import failed.');
      } finally {
        setBusy(false);
      }
    })();
  };

  const runClearRun = () => {
    if (pageBatches.length === 0) return;
    if (!window.confirm('Remove all batches from today\u2019s print run? This cannot be undone.')) {
      return;
    }
    setClearing(true);
    setError(null);
    void clearPrintRun()
      .then(() => {
        setFeedback(null);
        localStorage.removeItem(`lvs-d365-last-import-${activePageId}`);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Clear failed.');
      })
      .finally(() => setClearing(false));
  };

  return (
    <div className="d365-upload">
      <div className="d365-upload-top">
        <div className="zone-head-text">
          <h3 className="zone-title">D365 batch data</h3>
          <p className="zone-desc">
            Upload today&rsquo;s print run export (.csv) from Dynamics 365, or load the bundled
            sample to walk through mapping and preview.
          </p>
        </div>

        <div className="d365-upload-aside">
          {(pageBatches.length > 0 || feedback) && (
            <div className="d365-upload-row">
              {pageBatches.length > 0 ? (
                <button
                  type="button"
                  className="btn btn-ghost d365-upload-btn"
                  disabled={busy || clearing}
                  onClick={runClearRun}
                >
                  {clearing ? 'Clearing…' : 'Clear run'}
                </button>
              ) : (
                <span className="d365-upload-btn-spacer" aria-hidden />
              )}
              {feedback && (
                <div className="d365-feedback-file" title={feedback.filename}>
                  <span className="d365-feedback-icon" aria-hidden>
                    ✓
                  </span>
                  <span className="d365-feedback-filename">{feedback.filename}</span>
                </div>
              )}
            </div>
          )}

          <div className="d365-upload-row">
            <button
              type="button"
              className="btn btn-primary d365-upload-btn"
              disabled={busy || clearing}
              onClick={loadSampleExport}
            >
              {busy ? 'Loading…' : 'Load sample export'}
            </button>
            <button
              type="button"
              className="btn btn-ghost d365-upload-btn"
              disabled={busy || clearing}
              onClick={() => fileRef.current?.click()}
            >
              Choose your file…
            </button>
            {pageBatches.length > 0 && onOpenTestLabels && (
              <button
                type="button"
                className="btn btn-ghost d365-upload-btn"
                disabled={busy || clearing}
                onClick={onOpenTestLabels}
              >
                Test labels
              </button>
            )}
            {feedback && (
              <p className="d365-feedback-detail" role="status">
                {feedback.ordersLoaded} order{feedback.ordersLoaded === 1 ? '' : 's'} loaded
                {feedback.skipped > 0 ? ` · ${feedback.skipped} skipped` : ''}
                {' · '}
                <strong>{feedback.totalLabels} labels</strong> in print run
              </p>
            )}
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,.txt,application/vnd.ms-excel"
          hidden
          onChange={onFilePick}
        />
      </div>

      {error && <div className="upload-error">{error}</div>}

      {importOpen && pendingFile && (
        <div className="d365-mapping">
          <div className="d365-mapping-head">
            <strong>{step === 'mapping' ? 'Column mapping' : 'Import preview'}</strong>
            <span className="d365-mapping-file">{pendingFile.name}</span>
          </div>

          {step === 'mapping' && (
            <>
              <p className="d365-mapping-hint">
                Match your D365 export columns to app fields. For the standard Dynamics export,
                <strong> Production</strong> → Batch, <strong>Label</strong> → Label code,{' '}
                <strong>Split</strong> → per-run size (blank = one run),{' '}
                <strong>Delivery</strong> → delivery date (not expiration).
              </p>
              <table className="d365-mapping-table">
                <thead>
                  <tr>
                    <th>App field</th>
                    <th>D365 / file column</th>
                  </tr>
                </thead>
                <tbody>
                  {FIELDS.map((field) => (
                    <tr key={field}>
                      <td>
                        {CSV_FIELD_LABELS[field]}
                        {CSV_REQUIRED.has(field) && <span className="req"> *</span>}
                      </td>
                      <td>
                        <select
                          value={mapping[field] ?? ''}
                          onChange={(e) => setFieldMapping(field, e.target.value)}
                        >
                          <option value="">— not mapped —</option>
                          {headers.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="d365-mapping-actions">
                <button type="button" className="btn btn-ghost" onClick={resetImportFlow}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !mapping.batchNumber}
                  onClick={runPreview}
                >
                  {busy ? 'Parsing…' : 'Review import'}
                </button>
              </div>
            </>
          )}

          {step === 'preview' && analysis && (
            <>
              <div className="d365-preview-summary">
                <span>
                  <strong>{analysis.stats.sourceOrders}</strong> order
                  {analysis.stats.sourceOrders === 1 ? '' : 's'}
                  {analysis.stats.total !== analysis.stats.sourceOrders && (
                    <>
                      {' '}
                      · <strong>{analysis.stats.total}</strong> labels
                    </>
                  )}
                </span>
                {analysis.stats.multiBatchFamilies > 0 && (
                  <span>{analysis.stats.multiBatchFamilies} families</span>
                )}
                {analysis.stats.autoGeneratedChildren > 0 && (
                  <span className="d365-preview-warn-stat">
                    +{analysis.stats.autoGeneratedChildren} from split
                  </span>
                )}
                {analysis.stats.missingLabelCode > 0 && (
                  <span className="d365-preview-warn-stat">
                    {analysis.stats.missingLabelCode} missing label code
                  </span>
                )}
                {analysis.stats.duplicateInFile > 0 && (
                  <span className="d365-preview-warn-stat">
                    {analysis.stats.duplicateInFile} duplicate batch #
                  </span>
                )}
                {analysis.stats.orphanChildren > 0 && (
                  <span className="d365-preview-warn-stat">
                    {analysis.stats.orphanChildren} child batch
                    {analysis.stats.orphanChildren === 1 ? '' : 'es'} with no parent
                  </span>
                )}
                {analysis.stats.malformedSuffixes > 0 && (
                  <span className="d365-preview-warn-stat">
                    {analysis.stats.malformedSuffixes} bad run suffix
                    {analysis.stats.malformedSuffixes === 1 ? '' : 'es'}
                  </span>
                )}
              </div>

              {analysis.globalWarnings.length > 0 && (
                <ul className="d365-preview-warnings">
                  {analysis.globalWarnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}

              {analysis.parseErrors.length > 0 && (
                <ul className="d365-preview-errors">
                  {analysis.parseErrors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}

              <div className="d365-preview-table-wrap">
                <table className="d365-preview-table">
                  <thead>
                    <tr>
                      <th>Line</th>
                      <th>Family</th>
                      <th>Batch</th>
                      <th>Item</th>
                      <th>Label</th>
                      <th>Run</th>
                      <th>Split</th>
                      <th>Total</th>
                      <th>Runs</th>
                      <th>Product</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.previews.map((row) => (
                      <tr
                        key={`${row.line}-${row.batchNumber}`}
                        className={row.warnings.length > 0 ? 'd365-preview-row-warn' : ''}
                      >
                        <td>{row.line > 0 ? row.line : 'gen'}</td>
                        <td>
                          {row.familyLabel === 'PARENT' ? (
                            <span className="roll-pill roll-parent">PARENT</span>
                          ) : row.familyLabel ? (
                            <span className="roll-pill roll-split">{row.familyLabel}</span>
                          ) : (
                            ''
                          )}
                        </td>
                        <td className="d365-preview-batch">{row.batchNumber}</td>
                        <td>{row.itemNumber ?? '—'}</td>
                        <td>{row.labelCode ?? '—'}</td>
                        <td>{row.quantity ?? '—'}</td>
                        <td>
                          {row.splitQty != null &&
                          row.orderTotalQty != null &&
                          row.splitQty < row.orderTotalQty
                            ? row.splitQty
                            : '—'}
                        </td>
                        <td>{row.orderTotalQty ?? row.quantity ?? '—'}</td>
                        <td className="d365-preview-runs">{row.runsSummary}</td>
                        <td className="d365-preview-product">{row.productName ?? '—'}</td>
                        <td className="d365-preview-notes">
                          {row.warnings.length > 0 ? row.warnings.join(' · ') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="d365-mapping-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setStep('mapping')}
                >
                  Back to mapping
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || analysis.rows.length === 0}
                  onClick={runImport}
                >
                  {busy
                    ? 'Importing…'
                    : analysis.stats.total === analysis.stats.sourceOrders
                      ? `Confirm import (${analysis.stats.sourceOrders} order${analysis.stats.sourceOrders === 1 ? '' : 's'})`
                      : `Confirm import (${analysis.stats.sourceOrders} orders · ${analysis.stats.total} labels)`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
