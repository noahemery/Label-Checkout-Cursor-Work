import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useAppData } from '../data/AppDataContext';
import {
  CSV_FIELD_LABELS,
  CSV_REQUIRED,
  autoDetectMapping,
  loadSavedColumnMapping,
  parseCsvWithMapping,
  peekCsvHeaders,
  saveColumnMapping,
  type ColumnMapping,
  type CsvField,
} from '../data/csvMapping';
import { useSheetPage } from '../data/SheetPageContext';
import { useSession } from '../session/SessionContext';

const FIELDS = Object.keys(CSV_FIELD_LABELS) as CsvField[];

interface ImportFeedback {
  filename: string;
  added: number;
  skipped: number;
  totalOnPage: number;
}

export function D365UploadPanel() {
  const { store, refreshBatches, logAudit } = useAppData();
  const { activePage, activePageId } = useSheetPage();
  const { operator } = useSession();
  const fileRef = useRef<HTMLInputElement>(null);

  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>(() => loadSavedColumnMapping());
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ImportFeedback | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`lvs-d365-last-import-${activePageId}`);
      setFeedback(raw ? (JSON.parse(raw) as ImportFeedback) : null);
    } catch {
      setFeedback(null);
    }
  }, [activePageId]);

  const onFilePick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
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
        setMappingOpen(true);
      })
      .finally(() => setBusy(false));
  };

  const setFieldMapping = (field: CsvField, header: string) => {
    setMapping((m) => {
      const next = { ...m };
      if (!header) delete next[field];
      else next[field] = header;
      return next;
    });
  };

  const runImport = () => {
    if (!pendingFile) return;
    if (!mapping.batchNumber) {
      setError('Batch Number column is required.');
      return;
    }
    setBusy(true);
    setError(null);
    void parseCsvWithMapping(pendingFile, mapping)
      .then(async ({ rows, errors }) => {
        if (rows.length === 0) {
          setError(errors[0] ?? 'No batch rows found in file.');
          return;
        }
        saveColumnMapping(mapping);
        const result = await store.importBatches(activePageId, rows);
        await refreshBatches();
        const onPage = await store.getBatchesForPage(activePageId);
        const fb: ImportFeedback = {
          filename: pendingFile.name,
          added: result.added,
          skipped: result.skipped,
          totalOnPage: onPage.length,
        };
        setFeedback(fb);
        localStorage.setItem(`lvs-d365-last-import-${activePageId}`, JSON.stringify(fb));
        await logAudit({
          type: 'csv_import',
          operatorId: operator?.id ?? null,
          operatorName: operator?.name ?? null,
          batchNumber: null,
          detail: `D365 import "${pendingFile.name}": ${result.added} added, ${result.skipped} skipped → ${onPage.length} batches on ${activePage.referenceNumber}`,
        });
        setMappingOpen(false);
        setPendingFile(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Import failed.');
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="d365-upload">
      <div className="zone-head">
        <div className="zone-head-text">
          <h3 className="zone-title">D365 batch data</h3>
          <p className="zone-desc">
            Upload today&rsquo;s print run export (.csv or .xlsx saved as .csv) from Dynamics 365.
            Batches load onto <strong>{activePage.referenceNumber}</strong>.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? 'Reading file…' : 'Choose D365 file'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,.txt,application/vnd.ms-excel"
          hidden
          onChange={onFilePick}
        />
      </div>

      {feedback && (
        <div className="d365-feedback">
          <span className="d365-feedback-icon">✓</span>
          <div>
            <div className="d365-feedback-file">{feedback.filename}</div>
            <div className="d365-feedback-detail">
              {feedback.added} batch{feedback.added === 1 ? '' : 'es'} loaded
              {feedback.skipped > 0 ? ` · ${feedback.skipped} skipped (duplicates)` : ''}
              {' · '}
              <strong>{feedback.totalOnPage} total</strong> on this sheet
            </div>
          </div>
        </div>
      )}

      {error && <div className="upload-error">{error}</div>}

      {mappingOpen && pendingFile && (
        <div className="d365-mapping">
          <div className="d365-mapping-head">
            <strong>Column mapping</strong>
            <span className="d365-mapping-file">{pendingFile.name}</span>
          </div>
          <p className="d365-mapping-hint">
            Match your D365 export columns to app fields. Mapping is saved for next time.
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
            <button type="button" className="btn btn-ghost" onClick={() => setMappingOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !mapping.batchNumber}
              onClick={runImport}
            >
              {busy ? 'Importing…' : 'Import batches'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
