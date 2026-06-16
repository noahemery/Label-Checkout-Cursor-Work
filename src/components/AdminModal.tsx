import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useSettings } from '../config/SettingsContext';
import { useAppData } from '../data/AppDataContext';
import { parseCsvFile } from '../data/csv';
import { useSheetPage } from '../data/SheetPageContext';
import { useSession } from '../session/SessionContext';

/**
 * Admin panel: batch add / CSV import, badge enrollment, and settings.
 * While this modal is open the global wedge capture is suspended, so the
 * scanner and badge reader type directly into whichever field has focus
 * (that's how badge enrollment captures the badge ID).
 */

interface AdminModalProps {
  open: boolean;
  onClose: () => void;
}

type Tab = 'batches' | 'operators' | 'settings';

export function AdminModal({ open, onClose }: AdminModalProps) {
  const [tab, setTab] = useState<Tab>('batches');
  const { unknownBadge } = useSession();
  const bodyRef = useRef<HTMLDivElement>(null);

  // If admin was opened to enroll an unknown badge, jump to that tab.
  useEffect(() => {
    if (open && unknownBadge) setTab('operators');
  }, [open, unknownBadge]);

  useEffect(() => {
    if (open) bodyRef.current?.scrollTo(0, 0);
  }, [open, tab]);

  if (!open) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <h2>Admin</h2>
          <nav className="tabs">
            <button
              className={tab === 'batches' ? 'tab tab-active' : 'tab'}
              onClick={() => setTab('batches')}
            >
              Batches
            </button>
            <button
              className={tab === 'operators' ? 'tab tab-active' : 'tab'}
              onClick={() => setTab('operators')}
            >
              Operators
            </button>
            <button
              className={tab === 'settings' ? 'tab tab-active' : 'tab'}
              onClick={() => setTab('settings')}
            >
              Settings
            </button>
          </nav>
          <button className="btn btn-ghost modal-close" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body" ref={bodyRef}>
          {tab === 'batches' && <BatchesTab />}
          {tab === 'operators' && <OperatorsTab />}
          {tab === 'settings' && <SettingsTab />}
        </div>
      </div>
    </div>
  );
}

// ---- Batches ---------------------------------------------------------

function BatchesTab() {
  const { store, batches, refreshBatches, logAudit } = useAppData();
  const { activePage, activePageId } = useSheetPage();
  const { operator } = useSession();
  const emptyForm = {
    batchNumber: '',
    itemNumber: '',
    productName: '',
    labelCode: '',
    upc: '',
    quantity: '',
    dom: '',
    doe: '',
  };
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState<string | null>(null);

  const setField = (field: keyof typeof form, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const addBatch = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.batchNumber.trim()) return;
    const existing = await store.findBatchOnPage(activePageId, form.batchNumber);
    if (existing) {
      setMessage(`Batch ${existing.batchNumber} already exists on ${activePage.referenceNumber}.`);
      return;
    }
    const batch = await store.addBatch({
      batchNumber: form.batchNumber,
      itemNumber: form.itemNumber || null,
      productName: form.productName || null,
      labelCode: form.labelCode || null,
      upc: form.upc || null,
      quantity: form.quantity ? Number(form.quantity) || null : null,
      dom: form.dom || null,
      doe: form.doe || null,
      source: 'manual',
      sheetPageId: activePageId,
    });
    await refreshBatches();
    await logAudit({
      type: 'batch_add',
      operatorId: operator?.id ?? null,
      operatorName: operator?.name ?? null,
      batchNumber: batch.batchNumber,
      detail: 'Batch added manually in Admin',
    });
    setForm(emptyForm);
    setMessage(`Added batch ${batch.batchNumber}.`);
  };

  const importCsv = async (file: File) => {
    setMessage('Importing…');
    const { rows, errors } = await parseCsvFile(file);
    if (rows.length === 0) {
      setMessage(errors[0] ?? 'No usable rows found in that file.');
      return;
    }
    const result = await store.importBatches(activePageId, rows);
    await refreshBatches();
    await logAudit({
      type: 'csv_import',
      operatorId: operator?.id ?? null,
      operatorName: operator?.name ?? null,
      batchNumber: null,
      detail: `CSV import "${file.name}": ${result.added} added, ${result.skipped} skipped (duplicates/blank)`,
    });
    setMessage(`Imported ${result.added} batches (${result.skipped} skipped).`);
  };

  const deleteBatch = async (batchId: string, batchNumber: string) => {
    await store.deleteBatch(batchId);
    await refreshBatches();
    await logAudit({
      type: 'batch_delete',
      operatorId: operator?.id ?? null,
      operatorName: operator?.name ?? null,
      batchNumber,
      detail: 'Batch deleted in Admin',
    });
  };

  return (
    <div className="admin-section">
      <h3>Add a batch</h3>
      <form className="admin-form" onSubmit={(e) => void addBatch(e)}>
        <label>
          Batch number *
          <input
            value={form.batchNumber}
            onChange={(e) => setField('batchNumber', e.target.value)}
            placeholder="B0622739-04"
            required
          />
        </label>
        <label>
          Item number
          <input
            value={form.itemNumber}
            onChange={(e) => setField('itemNumber', e.target.value)}
            placeholder="100194"
          />
        </label>
        <label>
          Product name
          <input
            value={form.productName}
            onChange={(e) => setField('productName', e.target.value)}
          />
        </label>
        <label>
          Label code
          <input
            value={form.labelCode}
            onChange={(e) => setField('labelCode', e.target.value)}
            placeholder="24.4788.067.022.US0.18.V2"
          />
        </label>
        <label>
          UPC (product barcode)
          <input
            value={form.upc}
            onChange={(e) => setField('upc', e.target.value)}
            placeholder="click here, then scan the UPC"
            inputMode="numeric"
          />
        </label>
        <label>
          Quantity
          <input
            value={form.quantity}
            onChange={(e) => setField('quantity', e.target.value)}
            inputMode="numeric"
          />
        </label>
        <label>
          Date of manufacture
          <input value={form.dom} onChange={(e) => setField('dom', e.target.value)} placeholder="10/06/26" />
        </label>
        <label>
          Date of expiration
          <input value={form.doe} onChange={(e) => setField('doe', e.target.value)} placeholder="01/03/27" />
        </label>
        <button className="btn btn-primary" type="submit">
          Add batch
        </button>
      </form>

      <h3>Import the day&rsquo;s print run (CSV)</h3>
      <p className="admin-hint">
        Columns are matched loosely — it needs at least a batch column; item, product, label code,
        qty, DOM and DOE are picked up when present.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importCsv(file);
          e.target.value = '';
        }}
      />

      {message && <div className="admin-message">{message}</div>}

      <h3>Batches ({batches.length})</h3>
      <div className="admin-list">
        {batches.map((b) => (
          <div key={b.id} className="admin-list-row">
            <span className={`status-pill status-${b.status}`}>{b.status}</span>
            <span className="admin-list-main">{b.batchNumber}</span>
            <span className="admin-list-dim">{b.labelCode ?? ''}</span>
            <button
              className="btn btn-danger btn-sm"
              onClick={() => void deleteBatch(b.id, b.batchNumber)}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Operators -------------------------------------------------------

function OperatorsTab() {
  const { store, operators, refreshOperators, logAudit } = useAppData();
  const { operator, unknownBadge, clearUnknownBadge } = useSession();
  const [name, setName] = useState('');
  const [badgeId, setBadgeId] = useState(unknownBadge ?? '');
  const [message, setMessage] = useState<string | null>(null);

  const enroll = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !badgeId.trim()) return;
    try {
      const op = await store.enrollOperator(badgeId, name);
      await refreshOperators();
      await logAudit({
        type: 'enroll',
        operatorId: operator?.id ?? null,
        operatorName: operator?.name ?? null,
        batchNumber: null,
        detail: `Badge enrolled for ${op.name}`,
      });
      setName('');
      setBadgeId('');
      clearUnknownBadge();
      setMessage(`Enrolled ${op.name}. They can badge in now.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Enrollment failed.');
    }
  };

  const remove = async (operatorId: string, operatorName: string) => {
    await store.removeOperator(operatorId);
    await refreshOperators();
    await logAudit({
      type: 'operator_removed',
      operatorId: operator?.id ?? null,
      operatorName: operator?.name ?? null,
      batchNumber: null,
      detail: `Operator removed: ${operatorName}`,
    });
  };

  return (
    <div className="admin-section">
      <h3>Enroll a badge</h3>
      <p className="admin-hint">
        Click into the badge field, then tap the badge on the reader — it will type the ID for you.
      </p>
      <form className="admin-form" onSubmit={(e) => void enroll(e)}>
        <label>
          Operator name *
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Badge ID *
          <input
            value={badgeId}
            onChange={(e) => setBadgeId(e.target.value)}
            placeholder="click here, then scan badge"
            required
          />
        </label>
        <button className="btn btn-primary" type="submit">
          Enroll
        </button>
      </form>

      {message && <div className="admin-message">{message}</div>}

      <h3>Enrolled operators ({operators.length})</h3>
      <div className="admin-list">
        {operators.map((op) => (
          <div key={op.id} className="admin-list-row">
            <span className="admin-list-main">{op.name}</span>
            <span className="admin-list-dim">badge {op.badgeIdNorm}</span>
            <button className="btn btn-danger btn-sm" onClick={() => void remove(op.id, op.name)}>
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Settings --------------------------------------------------------

function SettingsTab() {
  const { settings, updateSettings } = useSettings();

  return (
    <div className="admin-section">
      <h3>Capture &amp; behavior</h3>
      <div className="admin-form">
        <label>
          Badge ID pattern (regex)
          <input
            value={settings.badgePattern}
            onChange={(e) => updateSettings({ badgePattern: e.target.value })}
          />
          <span className="admin-hint">
            Payloads matching this are treated as badge scans. Default: 6–14 digits.
          </span>
        </label>
        <label>
          Scanner burst gap (ms)
          <input
            type="number"
            value={settings.burstGapMs}
            onChange={(e) => updateSettings({ burstGapMs: Number(e.target.value) || 40 })}
          />
          <span className="admin-hint">
            Keystrokes closer together than this are treated as scanner input.
          </span>
        </label>
        <label>
          Auto-commit pause (ms)
          <input
            type="number"
            value={settings.commitPauseMs}
            onChange={(e) => updateSettings({ commitPauseMs: Number(e.target.value) || 250 })}
          />
          <span className="admin-hint">
            Silence after a scanner burst before it commits without Enter.
          </span>
        </label>
        <label>
          Verified screen hold (ms)
          <input
            type="number"
            value={settings.autoAdvanceMs}
            onChange={(e) => updateSettings({ autoAdvanceMs: Number(e.target.value) || 2500 })}
          />
        </label>
        <label className="admin-check">
          <input
            type="checkbox"
            checked={settings.soundEnabled}
            onChange={(e) => updateSettings({ soundEnabled: e.target.checked })}
          />
          Sounds on verify / mismatch
        </label>
      </div>
    </div>
  );
}
