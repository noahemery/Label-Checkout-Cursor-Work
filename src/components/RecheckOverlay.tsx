import type { RecheckPrompt } from '../verification/useVerification';

interface RecheckOverlayProps {
  prompt: RecheckPrompt;
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

export function RecheckOverlay({ prompt, onConfirm, onCancel }: RecheckOverlayProps) {
  const { batch } = prompt;

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
      </div>
      <div className="recheck-question">Check this label back in?</div>
      <div className="recheck-actions">
        <button className="btn btn-big btn-rescan" onClick={onConfirm}>
          CHECK BACK IN
        </button>
        <button className="btn btn-big btn-flag" onClick={onCancel}>
          CANCEL
        </button>
      </div>
    </div>
  );
}
