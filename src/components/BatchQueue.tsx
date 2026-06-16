import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { rollDisplayLabel } from '../domain/batchFamily';
import { useSheetPage } from '../data/SheetPageContext';
import { useSession } from '../session/SessionContext';
import { D365UploadPanel } from './D365UploadPanel';
import { ResetSheetModal } from './ResetSheetModal';
import { SheetLabelsModal } from './SheetLabelsModal';

function formatTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const STATUS_LABEL = {
  pending: 'WAITING',
  verified: 'VERIFIED',
  flagged: 'FLAGGED',
} as const;

export function BatchQueue() {
  const { operator } = useSession();
  const {
    activePage,
    pages,
    pageBatches,
    selectPage,
    uploadSheetPhoto,
    resetSheetPage,
    uploadError,
    loading,
  } = useSheetPage();
  const [sheetLabelsOpen, setSheetLabelsOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const verifiedCount = pageBatches.filter((b) => b.status === 'verified').length;
  const flaggedCount = pageBatches.filter((b) => b.status === 'flagged').length;
  const sheetBatchNumbers = pageBatches.map((b) => b.batchNumber);

  const sorted = [...pageBatches].sort((a, b) => {
    const order = { flagged: 0, pending: 1, verified: 2 } as const;
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return a.createdAt.localeCompare(b.createdAt);
  });

  const onPageChange = (e: ChangeEvent<HTMLSelectElement>) => {
    void selectPage(e.target.value);
  };

  const onPhotoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    void uploadSheetPhoto(file)
      .then(() => setPhotoName(file.name))
      .catch(() => {})
      .finally(() => setUploading(false));
  };

  const pct =
    pageBatches.length > 0 ? Math.round((verifiedCount / pageBatches.length) * 100) : 0;

  return (
    <section className="queue zone-panel">
      <header className="queue-header">
        <div className="queue-header-left">
          <span className="zone-tag">Batch log</span>
          <h2 className="zone-title">Today&rsquo;s check-outs</h2>
        </div>
        <div className="queue-header-right">
          <div className="progress-ring-wrap" title={`${verifiedCount} of ${pageBatches.length} verified`}>
            <svg className="progress-ring" viewBox="0 0 36 36">
              <path
                className="progress-ring-bg"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <path
                className="progress-ring-fill"
                strokeDasharray={`${pct}, 100`}
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
            <span className="progress-ring-label">{pct}%</span>
          </div>
          <div className="queue-stats">
            <span className="stat-chip stat-verified">{verifiedCount} verified</span>
            <span className="stat-chip stat-waiting">
              {pageBatches.length - verifiedCount - flaggedCount} waiting
            </span>
            {flaggedCount > 0 && (
              <span className="stat-chip stat-flagged">{flaggedCount} flagged</span>
            )}
          </div>
          {operator && (
            <button className="btn btn-ghost btn-sm" onClick={() => setSheetLabelsOpen(true)}>
              View sheet
            </button>
          )}
        </div>
      </header>

      <div className="upload-zone">
        <D365UploadPanel />

        <div className="sheet-photo-block">
          <div className="sheet-photo-head">
            <h4 className="sheet-photo-title">Physical log sheet photo</h4>
            <p className="sheet-photo-desc">Reference image of the FMI B001 page (optional)</p>
          </div>
          <div className="page-bar">
            <label className="page-bar-select">
              <span className="page-bar-label">Sheet page</span>
              <select value={activePage.id} onChange={onPageChange} disabled={loading}>
                {pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.referenceNumber} — {p.title}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? 'Uploading…' : 'Upload photo'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm reset-sheet-trigger"
              disabled={loading}
              onClick={() => setResetOpen(true)}
            >
              Reset sheet…
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/*"
              hidden
              onChange={onPhotoUpload}
            />
          </div>
          {photoName && !uploadError && (
            <div className="upload-ok">Photo saved: {photoName}</div>
          )}
          {uploadError && <div className="upload-error">{uploadError}</div>}
        </div>
      </div>

      <div className="table-zone">
        {loading ? (
          <div className="queue-empty">Loading page…</div>
        ) : sorted.length === 0 ? (
          <div className="queue-empty">Upload a D365 file or select a log sheet to load batches.</div>
        ) : (
          <table className="queue-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Roll</th>
                <th>Batch</th>
                <th>Product</th>
                <th>Item #</th>
                <th>Label code</th>
                <th>Qty</th>
                <th>DOM</th>
                <th>DOE</th>
                <th>Verified</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((b) => (
                <tr key={b.id} className={`queue-row queue-row-${b.status}`}>
                  <td>
                    <span className={`status-indicator status-${b.status}`}>
                      <span className="status-lamp" aria-hidden />
                      {STATUS_LABEL[b.status]}
                    </span>
                  </td>
                  <td>
                    {(() => {
                      const roll = rollDisplayLabel(b.batchNumber, sheetBatchNumbers);
                      if (!roll) return '';
                      return roll === 'PARENT' ? (
                        <span className="roll-pill roll-parent">PARENT</span>
                      ) : (
                        <span className="roll-pill roll-split">{roll}</span>
                      );
                    })()}
                  </td>
                  <td className="queue-batch">{b.batchNumber}</td>
                  <td className="queue-product">{b.productName ?? ''}</td>
                  <td>{b.itemNumber ?? ''}</td>
                  <td>{b.labelCode ?? ''}</td>
                  <td>{b.quantity ?? ''}</td>
                  <td>{b.dom ?? ''}</td>
                  <td>{b.doe ?? ''}</td>
                  <td className="queue-verified">
                    {b.verifiedByName && (
                      <>
                        {b.verifiedByName} · {formatTime(b.verifiedAt)}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <SheetLabelsModal open={sheetLabelsOpen} onClose={() => setSheetLabelsOpen(false)} />
      <ResetSheetModal
        page={activePage}
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={() => resetSheetPage(activePage.id)}
      />
    </section>
  );
}
