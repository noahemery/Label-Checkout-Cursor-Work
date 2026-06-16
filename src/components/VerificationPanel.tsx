import type { SlotNeed, VerificationState } from '../verification/useVerification';
import { ScanSlot } from './ScanSlot';

interface VerificationPanelProps {
  state: VerificationState;
  need: SlotNeed;
  typedBuffer: string;
  onStartOver: () => void;
}

function instruction(need: SlotNeed): { main: string; sub: string } {
  if (need.side === 'label' && need.need === 'batch')
    return {
      main: 'Scan the PRINTED LABEL',
      sub: 'the BATCH NUMBER barcode at the bottom of the label',
    };
  if (need.side === 'label' && need.need === 'code')
    return {
      main: 'Now the LABEL CODE',
      sub: 'scan the QR code on the label, or type the code',
    };
  if (need.side === 'sheet' && need.need === 'batch')
    return {
      main: 'Now the LOG SHEET row',
      sub: 'no QR on the sheet yet — scan the label\u2019s batch barcode again to simulate it, or type the batch number from the sheet',
    };
  if (need.side === 'sheet' && need.need === 'code')
    return {
      main: 'Confirm the LABEL CODE',
      sub: 'scan the label QR again, or type the code written on the sheet row',
    };
  return { main: '', sub: '' };
}

export function VerificationPanel({ state, need, typedBuffer, onStartOver }: VerificationPanelProps) {
  const verified = !!state.result?.ok;
  const inProgress =
    !state.result && (!!state.label.batchNumber || !!state.sheet.batchNumber || !!typedBuffer);

  return (
    <div className="verification zone-panel">
      <header className="scan-zone-head">
        <span className="zone-tag">Scan zone</span>
        <h2 className="zone-title">Two-scan check-out</h2>
        <p className="zone-desc">Printed label first, then log sheet row — both must match.</p>
      </header>
      <div className="slots">
        <ScanSlot
          step={1}
          title="PRINTED LABEL"
          subtitle="from the roll"
          side={state.label}
          activeNeed={need.side === 'label' ? need.need : null}
          typedBuffer={need.side === 'label' ? typedBuffer : ''}
          verified={verified}
        />
        <div className={`slots-link ${verified ? 'slots-link-ok' : ''}`}>
          {verified ? '=' : '→'}
        </div>
        <ScanSlot
          step={2}
          title="LOG SHEET"
          subtitle="FMI B001 row"
          side={state.sheet}
          activeNeed={need.side === 'sheet' ? need.need : null}
          typedBuffer={need.side === 'sheet' ? typedBuffer : ''}
          verified={verified}
        />
      </div>

      {verified ? (
        <div className="verdict verdict-ok">
          <span className="verdict-icon">✓</span>
          VERIFIED — {state.verifiedBatchNumber}
          <span className="verdict-sub">ready for next batch…</span>
        </div>
      ) : state.notice ? (
        <div className="verdict verdict-waiting verdict-notice">{state.notice}</div>
      ) : (
        <div className="verdict verdict-waiting">
          <div className="verdict-lines">
            <div>{instruction(need).main}</div>
            <div className="verdict-subline">{instruction(need).sub}</div>
          </div>
          {inProgress && (
            <button className="btn btn-ghost verdict-reset" onClick={onStartOver}>
              Start over
            </button>
          )}
        </div>
      )}
    </div>
  );
}
