import { useState } from 'react';
import { useAppData } from '../data/AppDataContext';
import { useSheetPage } from '../data/SheetPageContext';
import type { AuditType } from '../domain/types';
import { downloadCheckoutCsv, openPrintableCheckoutSummary } from '../utils/exportCheckout';

interface ActivityDrawerProps {
  open: boolean;
  onClose: () => void;
}

const TYPE_META: Record<AuditType, { label: string; tone: string }> = {
  scan: { label: 'Scan', tone: 'neutral' },
  verify: { label: 'Verified', tone: 'good' },
  mismatch: { label: 'Mismatch', tone: 'bad' },
  reopen: { label: 'Re-opened', tone: 'warn' },
  flag: { label: 'Flagged', tone: 'bad' },
  sign_in: { label: 'Sign in', tone: 'neutral' },
  sign_out: { label: 'Sign out', tone: 'neutral' },
  enroll: { label: 'Badge enrolled', tone: 'neutral' },
  operator_removed: { label: 'Operator removed', tone: 'warn' },
  batch_add: { label: 'Batch added', tone: 'neutral' },
  batch_delete: { label: 'Batch deleted', tone: 'warn' },
  csv_import: { label: 'CSV import', tone: 'neutral' },
  page_select: { label: 'Page selected', tone: 'neutral' },
  sheet_photo: { label: 'Sheet photo', tone: 'neutral' },
  sheet_reset: { label: 'Sheet reset', tone: 'warn' },
};

export function ActivityDrawer({ open, onClose }: ActivityDrawerProps) {
  const { audit, store, batches } = useAppData();
  const { activePage } = useSheetPage();
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  if (!open) return null;

  const showExportMsg = (msg: string) => {
    setExportMsg(msg);
    window.setTimeout(() => setExportMsg(null), 5000);
  };

  const loadAndExport = async (mode: 'csv' | 'print') => {
    const all = await store.getAuditEvents(50_000);
    if (mode === 'csv') {
      const count = downloadCheckoutCsv(all, batches);
      showExportMsg(
        count > 0
          ? `Downloaded ${count} checkout event${count === 1 ? '' : 's'}.`
          : 'No checkout events yet — verify a batch first.',
      );
    } else {
      const count = openPrintableCheckoutSummary(all, batches, activePage.referenceNumber);
      showExportMsg(
        count > 0
          ? `Print summary opened (${count} events).`
          : 'No checkout events to print yet.',
      );
    }
  };

  return (
    <>
      <button type="button" className="drawer-scrim" aria-label="Close activity log" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-header">
          <h2>Activity log</h2>
          <div className="drawer-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => void loadAndExport('csv')}>
              Export CSV
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => void loadAndExport('print')}>
              Print summary
            </button>
            <button className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        {exportMsg && <div className="drawer-export-msg">{exportMsg}</div>}
        <div className="drawer-body">
          {audit.length === 0 && <div className="drawer-empty">No activity yet.</div>}
          {audit.map((e) => {
            const meta = TYPE_META[e.type];
            return (
              <div key={e.id} className={`audit-row audit-${meta.tone}`}>
                <div className="audit-top">
                  <span className="audit-type">{meta.label}</span>
                  <span className="audit-ts">{new Date(e.ts).toLocaleString()}</span>
                </div>
                <div className="audit-detail">{e.detail}</div>
                <div className="audit-meta">
                  {e.operatorName && <span>{e.operatorName}</span>}
                  {e.batchNumber && <span>Batch {e.batchNumber}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </aside>
    </>
  );
}
