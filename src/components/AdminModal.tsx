import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useSettings } from '../config/SettingsContext';
import {
  minutesToSessionTimeout,
  SESSION_TIMEOUT_MAX_MINUTES,
  SESSION_TIMEOUT_MIN_MINUTES,
  sessionTimeoutToMinutes,
} from '../config/settings';
import { useAppData } from '../data/AppDataContext';
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
  onOpenTestLabels?: () => void;
}

type Tab = 'batches' | 'operators' | 'settings';

export function AdminModal({ open, onClose, onOpenTestLabels }: AdminModalProps) {
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
    <div className="modal-backdrop modal-backdrop-admin" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-admin" role="dialog" aria-labelledby="admin-modal-title">
        <div className="modal-header modal-header-admin">
          <div className="modal-header-top">
            <h2 id="admin-modal-title">Admin</h2>
            <button className="btn btn-ghost modal-close" onClick={onClose}>
              Close
            </button>
          </div>
          <nav className="tabs tabs-admin" aria-label="Admin sections">
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
              People
            </button>
            <button
              className={tab === 'settings' ? 'tab tab-active' : 'tab'}
              onClick={() => setTab('settings')}
            >
              Settings
            </button>
          </nav>
        </div>
        <div className="modal-body modal-body-admin" ref={bodyRef}>
          {tab === 'batches' && <BatchesTab onOpenTestLabels={onOpenTestLabels} />}
          {tab === 'operators' && <PeopleTab />}
          {tab === 'settings' && <SettingsTab />}
        </div>
      </div>
    </div>
  );
}

// ---- Batches ---------------------------------------------------------

function BatchesTab({ onOpenTestLabels }: { onOpenTestLabels?: () => void }) {
  const { store, refreshBatches, logAudit } = useAppData();
  const { activePage, activePageId, pageBatches } = useSheetPage();
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
  const [pendingDelete, setPendingDelete] = useState<{ id: string; batchNumber: string } | null>(
    null,
  );
  const [confirmText, setConfirmText] = useState('');

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

  const deleteBatch = async () => {
    if (!pendingDelete) return;
    const { id, batchNumber } = pendingDelete;
    await store.deleteBatch(id);
    await refreshBatches();
    await logAudit({
      type: 'batch_delete',
      operatorId: operator?.id ?? null,
      operatorName: operator?.name ?? null,
      batchNumber,
      detail: 'Batch removed in Admin (confirmed)',
    });
    setPendingDelete(null);
    setConfirmText('');
    setMessage(`Removed batch ${batchNumber}. Re-import the D365 export to restore it.`);
  };

  const startDelete = (id: string, batchNumber: string) => {
    setPendingDelete({ id, batchNumber });
    setConfirmText('');
    setMessage(null);
  };

  const cancelDelete = () => {
    setPendingDelete(null);
    setConfirmText('');
  };

  const deleteConfirmOk =
    pendingDelete !== null &&
    confirmText.trim().toUpperCase() === pendingDelete.batchNumber.trim().toUpperCase();

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

      <p className="admin-hint">
        To load batches, use <strong>Load sample export</strong> or <strong>Choose your file</strong>{' '}
        in the D365 panel on the batch log — that walks through column mapping and preview before
        import.
        {pageBatches.length > 0 && onOpenTestLabels && (
          <>
            {' '}
            <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenTestLabels}>
              Test labels
            </button>
          </>
        )}
      </p>

      {message && <div className="admin-message">{message}</div>}

      {pendingDelete && (
        <div className="admin-delete-confirm">
          <p className="admin-delete-warn">
            Remove batch <strong>{pendingDelete.batchNumber}</strong>? Check-out memory for this row
            will be lost. Type the batch number below to confirm.
          </p>
          <input
            className="admin-delete-input"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={pendingDelete.batchNumber}
            autoComplete="off"
          />
          <div className="admin-delete-actions">
            <button type="button" className="btn btn-ghost" onClick={cancelDelete}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={!deleteConfirmOk}
              onClick={() => void deleteBatch()}
            >
              Remove batch
            </button>
          </div>
        </div>
      )}

      <h3>
        Batches on {activePage.referenceNumber} ({pageBatches.length})
      </h3>
      <p className="admin-hint">
        Only batches in the current print run are listed. To wipe the whole run, use{' '}
        <strong>Clear run</strong> in the import panel.
      </p>
      <div className="admin-list">
        {pageBatches.map((b) => (
          <div key={b.id} className="admin-list-row">
            <span className={`status-pill status-${b.status}`}>{b.status}</span>
            <span className="admin-list-main">{b.batchNumber}</span>
            <span className="admin-list-dim">{b.labelCode ?? ''}</span>
            {pendingDelete?.id === b.id ? (
              <span className="admin-list-pending">Confirming…</span>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-sm admin-remove-btn"
                disabled={!!pendingDelete}
                onClick={() => startDelete(b.id, b.batchNumber)}
              >
                Remove…
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- People (admins + operators) -------------------------------------

function PeopleTab() {
  const { store, operators, refreshOperators, logAudit } = useAppData();
  const { operator, unknownBadge, clearUnknownBadge } = useSession();
  const [name, setName] = useState('');
  const [badgeId, setBadgeId] = useState(unknownBadge ?? '');
  const [enrollRole, setEnrollRole] = useState<'admin' | 'operator'>('operator');
  const [message, setMessage] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<{ id: string; name: string } | null>(null);

  const admins = operators.filter((op) => (op.role ?? 'operator') === 'admin');
  const floorOps = operators.filter((op) => (op.role ?? 'operator') === 'operator');

  const enroll = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !badgeId.trim()) return;
    try {
      const op = await store.enrollOperator(badgeId, name, enrollRole);
      await refreshOperators();
      await logAudit({
        type: 'enroll',
        operatorId: operator?.id ?? null,
        operatorName: operator?.name ?? null,
        batchNumber: null,
        detail: `Enrolled ${op.name} as ${enrollRole}`,
      });
      setName('');
      setBadgeId('');
      clearUnknownBadge();
      setMessage(`Enrolled ${op.name} as ${enrollRole}. They can badge in now.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Enrollment failed.');
    }
  };

  const remove = async () => {
    if (!pendingRemove) return;
    await store.removeOperator(pendingRemove.id);
    await refreshOperators();
    await logAudit({
      type: 'operator_removed',
      operatorId: operator?.id ?? null,
      operatorName: operator?.name ?? null,
      batchNumber: null,
      detail: `User removed: ${pendingRemove.name}`,
    });
    setPendingRemove(null);
    setMessage(`Removed ${pendingRemove.name}.`);
  };

  const toggleRole = async (userId: string, name: string, current: 'admin' | 'operator') => {
    const next = current === 'admin' ? 'operator' : 'admin';
    try {
      await store.updateUserRole(userId, next);
      await refreshOperators();
      setMessage(`${name} is now ${next === 'admin' ? 'an admin' : 'an operator'}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not change role.');
    }
  };

  const renderList = (
    list: typeof operators,
    emptyLabel: string,
    roleLabel: 'admin' | 'operator',
  ) => (
    <div className="admin-list">
      {list.length === 0 ? (
        <p className="admin-hint">{emptyLabel}</p>
      ) : (
        list.map((op) => (
          <div key={op.id} className="admin-list-row">
            <span className={`role-pill role-pill-${roleLabel}`}>{roleLabel}</span>
            <span className="admin-list-main">{op.name}</span>
            <span className="admin-list-dim">badge {op.badgeIdNorm}</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!!pendingRemove}
              onClick={() => void toggleRole(op.id, op.name, roleLabel)}
            >
              Make {roleLabel === 'admin' ? 'operator' : 'admin'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm admin-remove-btn"
              disabled={!!pendingRemove}
              onClick={() => setPendingRemove({ id: op.id, name: op.name })}
            >
              Remove…
            </button>
          </div>
        ))
      )}
    </div>
  );

  return (
    <div className="admin-section">
      <h3>Enroll a badge</h3>
      <p className="admin-hint">
        Click into the badge field, then tap the badge on the reader. Choose whether this person
        gets the <strong>admin</strong> profile (full tools) or <strong>operator</strong> profile
        (checkout only).
      </p>
      <form className="admin-form" onSubmit={(e) => void enroll(e)}>
        <label>
          Name *
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
        <fieldset className="admin-role-pick">
          <legend>Profile at badge-in</legend>
          <label className="admin-check">
            <input
              type="radio"
              name="enrollRole"
              checked={enrollRole === 'operator'}
              onChange={() => setEnrollRole('operator')}
            />
            Operator — minimal checkout screen
          </label>
          <label className="admin-check">
            <input
              type="radio"
              name="enrollRole"
              checked={enrollRole === 'admin'}
              onChange={() => setEnrollRole('admin')}
            />
            Admin — full tools + data
          </label>
        </fieldset>
        <button className="btn btn-primary" type="submit">
          Enroll
        </button>
      </form>

      {message && <div className="admin-message">{message}</div>}

      {pendingRemove && (
        <div className="admin-delete-confirm">
          <p className="admin-delete-warn">
            Remove <strong>{pendingRemove.name}</strong>? They will no longer be able to badge in.
          </p>
          <div className="admin-delete-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setPendingRemove(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => void remove()}>
              Remove
            </button>
          </div>
        </div>
      )}

      <h3>Admins ({admins.length})</h3>
      <p className="admin-hint">Badge in opens the admin profile with CSV upload, activity, and settings.</p>
      {renderList(admins, 'No admins enrolled yet.', 'admin')}

      <h3>Operators ({floorOps.length})</h3>
      <p className="admin-hint">Badge in opens the minimal checkout screen only.</p>
      {renderList(floorOps, 'No operators enrolled yet.', 'operator')}
    </div>
  );
}

// ---- Settings --------------------------------------------------------

function SettingsTab() {
  const { settings, updateSettings } = useSettings();
  const { storeKind } = useAppData();
  const timeoutMinutes = sessionTimeoutToMinutes(settings.sessionTimeoutMs);

  return (
    <div className="admin-section">
      <h3>This station</h3>
      <p className="admin-hint">
        {storeKind === 'sqlite' ? (
          <>
            Running on SQLite. The database file is{' '}
            <code>label-verification.db</code> under{' '}
            <code>%APPDATA%\com.alltech.labelverification</code>. Copy that file to
            back up this station.
          </>
        ) : (
          <>
            Running in a browser on IndexedDB. Floor testing needs the desktop app
            so checkout data is a file you can copy.
          </>
        )}
      </p>

      <h3>Session</h3>
      <div className="admin-form">
        <label className="admin-slider-label">
          Idle sign-out timeout
          <div className="admin-slider-row">
            <input
              type="range"
              className="admin-slider"
              min={SESSION_TIMEOUT_MIN_MINUTES}
              max={SESSION_TIMEOUT_MAX_MINUTES}
              step={1}
              value={timeoutMinutes}
              onChange={(e) =>
                updateSettings({
                  sessionTimeoutMs: minutesToSessionTimeout(Number(e.target.value)),
                })
              }
            />
            <span className="admin-slider-value">{timeoutMinutes} min</span>
          </div>
          <span className="admin-hint">
            Signed-in users are auto-signed out after this long with no scans or screen
            interaction. Adjust while watching floor timing — start generous (e.g. 20 min).
          </span>
        </label>
      </div>

      <h3>Capture &amp; behavior</h3>
      <div className="admin-form">
        <label>
          Badge ID pattern (regex)
          <input
            value={settings.badgePattern}
            onChange={(e) => updateSettings({ badgePattern: e.target.value })}
          />
          <span className="admin-hint">
            Payloads matching this are treated as badge scans. Default: 5–14 digits (e.g. 13925).
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
