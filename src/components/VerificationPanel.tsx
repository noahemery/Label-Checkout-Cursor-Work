import { sideComplete } from '../domain/matching';
import type { SlotNeed, VerificationState } from '../verification/useVerification';
import { ScanSlot, type SlotVisualPhase } from './ScanSlot';

interface VerificationPanelProps {
  state: VerificationState;
  need: SlotNeed;
  typedBuffer: string;
  onStartOver: () => void;
}

function instruction(need: SlotNeed): { primary: string; sub: string } {
  if (need.side === 'label' && need.need === 'batch')
    return {
      primary: 'Scan the batch number on the printed label',
      sub: 'Use the batch barcode at the bottom of the label',
    };
  if (need.side === 'label' && need.need === 'code')
    return {
      primary: 'Scan the label code (QR)',
      sub: 'Or type the code and press Enter',
    };
  if (need.side === 'sheet' && need.need === 'batch')
    return {
      primary: 'Now scan the matching row on the log sheet',
      sub: 'Scan the sheet row barcode, or type the batch number from the sheet',
    };
  if (need.side === 'sheet' && need.need === 'code')
    return {
      primary: 'Confirm the label code on the sheet row',
      sub: 'Scan the label QR again, or type the code written on the sheet',
    };
  return { primary: '', sub: '' };
}

function labelPhase(
  labelDone: boolean,
  need: SlotNeed,
  verified: boolean,
): SlotVisualPhase {
  if (verified && labelDone) return 'complete';
  if (need.side === 'label') return 'active';
  if (labelDone) return 'complete';
  return 'active';
}

function sheetPhase(
  labelDone: boolean,
  sheetDone: boolean,
  need: SlotNeed,
  verified: boolean,
): SlotVisualPhase {
  if (!labelDone) return 'locked';
  if (verified && sheetDone) return 'complete';
  if (need.side === 'sheet') return 'active';
  if (sheetDone) return 'complete';
  return 'locked';
}

export function VerificationPanel({ state, need, typedBuffer, onStartOver }: VerificationPanelProps) {
  const verified = !!state.result?.ok;
  const labelDone = sideComplete(state.label);
  const sheetDone = sideComplete(state.sheet);
  const inProgress =
    !state.result && (!!state.label.batchNumber || !!state.sheet.batchNumber || !!typedBuffer);

  const labelVisual = labelPhase(labelDone, need, verified);
  const sheetVisual = sheetPhase(labelDone, sheetDone, need, verified);
  const hint = instruction(need);

  const labelHint =
    labelVisual === 'active'
      ? { primary: hint.primary, sub: hint.sub }
      : { primary: undefined, sub: undefined };

  const sheetHint =
    sheetVisual === 'active'
      ? {
          primary:
            need.side === 'sheet' && need.need === 'batch' && !state.sheet.batchNumber
              ? 'Now scan the matching row on the log sheet'
              : hint.primary,
          sub: hint.sub,
        }
      : { primary: undefined, sub: undefined };

  const showStartOver = inProgress && !verified && !state.notice;

  return (
    <div className="verification zone-panel">
      <header className="scan-zone-head">
        <span className="zone-tag">Scan zone</span>
        <h2 className="zone-title">Scan two barcodes to verify a label</h2>
        <p className="zone-desc">
          Scan the printed label first, then the matching row on the log sheet.
        </p>
      </header>
      <div className="slots">
        <ScanSlot
          step={1}
          title="PRINTED LABEL"
          subtitle="from the roll"
          side={state.label}
          activeNeed={need.side === 'label' ? need.need : null}
          typedBuffer={need.side === 'label' ? typedBuffer : ''}
          visualPhase={labelVisual}
          inlinePrimary={labelHint.primary}
          inlineSub={labelHint.sub}
        />
        <div className={`slots-link ${verified ? 'slots-link-ok' : ''}`}>
          {verified ? '✓' : '→'}
        </div>
        <ScanSlot
          step={2}
          title="LOG SHEET"
          subtitle="FMI B001 row"
          side={state.sheet}
          activeNeed={need.side === 'sheet' ? need.need : null}
          typedBuffer={need.side === 'sheet' ? typedBuffer : ''}
          visualPhase={sheetVisual}
          inlinePrimary={sheetHint.primary}
          inlineSub={sheetHint.sub}
          lockedHint="Step 2 — after label scan"
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
      ) : showStartOver ? (
        <div className="verdict verdict-actions">
          <button className="btn btn-ghost verdict-reset" onClick={onStartOver}>
            Start over
          </button>
        </div>
      ) : null}
    </div>
  );
}
