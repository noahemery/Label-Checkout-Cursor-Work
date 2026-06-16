import { useState } from 'react';
import type { LogSheetPageDef } from '../data/logSheetPages';

interface ResetSheetModalProps {
  page: LogSheetPageDef;
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

type Step = 1 | 2 | 3 | 4;

export function ResetSheetModal({ page, open, onClose, onConfirm }: ResetSheetModalProps) {
  const [step, setStep] = useState<Step>(1);
  const [typedRef, setTypedRef] = useState('');
  const [typedReset, setTypedReset] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const close = () => {
    setStep(1);
    setTypedRef('');
    setTypedReset('');
    setError(null);
    onClose();
  };

  const refOk =
    typedRef.trim().replace(/\s/g, '').toUpperCase() ===
    page.referenceNumber.replace(/\s/g, '').toUpperCase();
  const resetOk = typedReset.trim().toUpperCase() === 'RESET';

  const runReset = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal reset-sheet-modal">
        <div className="modal-header">
          <h2>Reset sheet — step {step} of 4</h2>
          <button className="btn btn-ghost" onClick={close} disabled={busy}>
            Cancel
          </button>
        </div>
        <div className="modal-body">
          {step === 1 && (
            <>
              <p className="reset-warn">
                This permanently clears <strong>all check-out memory</strong> and the{' '}
                <strong>uploaded photo</strong> for:
              </p>
              <p className="reset-ref">{page.referenceNumber}</p>
              <p className="reset-detail">
                {page.labels.length} batch rows will go back to WAITING. The built-in label list
                stays — you can upload a new sheet photo and test again.
              </p>
              <button className="btn btn-primary" onClick={() => setStep(2)}>
                I understand — continue
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <p>Type the sheet reference number exactly:</p>
              <p className="reset-hint">
                Expected: <strong>{page.referenceNumber}</strong>
              </p>
              <input
                className="reset-input"
                value={typedRef}
                onChange={(e) => setTypedRef(e.target.value)}
                placeholder={page.referenceNumber}
                autoComplete="off"
              />
              <button className="btn btn-primary" disabled={!refOk} onClick={() => setStep(3)}>
                Next
              </button>
            </>
          )}

          {step === 3 && (
            <>
              <p>Type <strong>RESET</strong> to confirm:</p>
              <input
                className="reset-input"
                value={typedReset}
                onChange={(e) => setTypedReset(e.target.value)}
                placeholder="RESET"
                autoComplete="off"
              />
              <button className="btn btn-primary" disabled={!resetOk} onClick={() => setStep(4)}>
                Next
              </button>
            </>
          )}

          {step === 4 && (
            <>
              <p className="reset-warn">Last chance. This cannot be undone.</p>
              <button
                className="btn btn-danger btn-big"
                disabled={busy}
                onClick={() => void runReset()}
              >
                {busy ? 'Resetting…' : 'Permanently reset this sheet'}
              </button>
            </>
          )}

          {error && <div className="upload-error">{error}</div>}
        </div>
      </div>
    </div>
  );
}
