import type { RecheckPrompt } from '../verification/useVerification';

interface RecheckOverlayProps {
  prompt: RecheckPrompt;
  typedBuffer: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function formatVerifiedAt(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function RecheckOverlay({ prompt, typedBuffer, onConfirm, onCancel }: RecheckOverlayProps) {
  const { batch } = prompt;
  const familyMode = prompt.scope === 'family';
  const canConfirm = !familyMode || prompt.parentConfirmed;

  return (
    <div className="recheck-overlay">
      <div className="recheck-icon">↻</div>
      <div className="recheck-title">ALREADY CHECKED OUT</div>
      <div className="recheck-batch">{batch.batchNumber}</div>
      <div className="recheck-sub">
        {batch.productName ?? 'This label'}
        {batch.verifiedByName && (
          <>
            {' '}
            — verified by <strong>{batch.verifiedByName}</strong>
          </>
        )}
        {batch.verifiedAt && <> at {formatVerifiedAt(batch.verifiedAt)}</>}.
        {familyMode && prompt.familySize > 1 && (
          <>
            {' '}
            Checking back in will return all {prompt.familySize} labels in this order to waiting.
          </>
        )}
      </div>

      {familyMode && !prompt.parentConfirmed && (
        <>
          <div className="recheck-question">
            Scan parent {prompt.parentBatchNumber} to check this order back in
          </div>
          <p className="recheck-wait">
            {typedBuffer ? (
              <>Reading {typedBuffer}</>
            ) : (
              <>Waiting for the parent label QR.</>
            )}
          </p>
        </>
      )}

      {familyMode && prompt.parentConfirmed && (
        <div className="recheck-question">
          Parent {prompt.parentBatchNumber} scanned. Check this order back in?
        </div>
      )}

      {!familyMode && <div className="recheck-question">Check this label back in?</div>}

      {prompt.notice && <p className="recheck-notice">{prompt.notice}</p>}

      <div className="recheck-actions">
        <button className="btn btn-big btn-rescan" disabled={!canConfirm} onClick={onConfirm}>
          CHECK BACK IN
        </button>
        <button className="btn btn-big btn-flag" onClick={onCancel}>
          CANCEL
        </button>
      </div>
    </div>
  );
}
