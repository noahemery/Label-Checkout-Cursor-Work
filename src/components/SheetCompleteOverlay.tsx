import { useEffect } from 'react';
import { playSuccess } from '../audio/sounds';
import { useSettings } from '../config/SettingsContext';

interface SheetCompleteOverlayProps {
  referenceNumber: string;
  batchCount: number;
  onDismiss: () => void;
}

export function SheetCompleteOverlay({
  referenceNumber,
  batchCount,
  onDismiss,
}: SheetCompleteOverlayProps) {
  const { settings } = useSettings();

  useEffect(() => {
    if (settings.soundEnabled) playSuccess();
  }, [settings.soundEnabled]);

  return (
    <div className="sheet-complete-overlay">
      <div className="sheet-complete-icon">✓</div>
      <div className="sheet-complete-title">ALL LABELS CHECKED OUT</div>
      <div className="sheet-complete-ref">{referenceNumber}</div>
      <div className="sheet-complete-sub">
        Every batch on this sheet ({batchCount}) is verified.
        <br />
        Saved on this device — status is remembered after refresh.
      </div>
      <button className="btn btn-big btn-rescan" onClick={onDismiss}>
        OK
      </button>
    </div>
  );
}
