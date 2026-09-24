import { useMemo } from 'react';
import { useSheetPage } from '../data/SheetPageContext';
import { buildLabelQrPayload, buildWrongLabelQrPayload } from '../domain/referenceQr';
import type { Batch } from '../domain/types';
import { ReferenceQrImage } from './ReferenceQrImage';

interface TestLabelsDrawerProps {
  open: boolean;
  onClose: () => void;
}

function TestLabelCard({ batch }: { batch: Batch }) {
  const good = buildLabelQrPayload(batch);
  const bad = buildWrongLabelQrPayload(batch);

  return (
    <article className="test-label-card">
      <header className="test-label-card-head">
        <strong className="test-label-batch">{batch.batchNumber}</strong>
        <span className="test-label-code">{batch.labelCode ?? '—'}</span>
      </header>
      {batch.productName && <p className="test-label-product">{batch.productName}</p>}
      <div className="test-label-qr-grid">
        <div className="test-label-qr-block">
          <span className="test-label-qr-label">Match (scan this)</span>
          <ReferenceQrImage payload={good} size={140} className="test-label-qr" />
          {good && <code className="test-label-payload">{good}</code>}
        </div>
        <div className="test-label-qr-block test-label-qr-block-wrong">
          <span className="test-label-qr-label">Mismatch test</span>
          <ReferenceQrImage payload={bad} size={140} className="test-label-qr" />
          {bad && <code className="test-label-payload">{bad}</code>}
        </div>
      </div>
    </article>
  );
}

export function TestLabelsDrawer({ open, onClose }: TestLabelsDrawerProps) {
  const { pageBatches } = useSheetPage();

  const batches = useMemo(
    () => [...pageBatches].sort((a, b) => a.batchNumber.localeCompare(b.batchNumber)),
    [pageBatches],
  );

  if (!open) return null;

  return (
    <>
      <button type="button" className="drawer-scrim" aria-label="Close test labels" onClick={onClose} />
      <aside className="drawer test-labels-drawer">
        <div className="drawer-header">
          <div>
            <h2>Test labels</h2>
            <p className="test-labels-sub">
              Synthetic LBL QRs from imported data — scan with the Zebra like printed labels. Open an
              order and scan its on-screen REF first.
            </p>
          </div>
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="drawer-body test-labels-body">
          {batches.length === 0 ? (
            <div className="drawer-empty">Import a D365 CSV to generate test label QRs.</div>
          ) : (
            batches.map((batch) => (
              <TestLabelCard key={batch.id} batch={batch} />
            ))
          )}
        </div>
      </aside>
    </>
  );
}
