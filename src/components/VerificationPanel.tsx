import type { FamilyCheckoutState, FamilyMemberPair } from '../domain/familyCheckout';
import type { Batch } from '../domain/types';
import type { SlotNeed, VerificationState } from '../verification/useVerification';
import { OrderStepsPanel } from './OrderStepsPanel';
import { ScanSlot, type SlotVisualPhase } from './ScanSlot';

interface VerificationPanelProps {
  state: VerificationState;
  need: SlotNeed;
  typedBuffer: string;
  onStartOver: () => void;
  embedded?: boolean;
  familyCheckout: FamilyCheckoutState | null;
  parentBatch: Batch | null;
  orderMembers: Batch[];
  currentMemberBatch: Batch | null;
  mismatches: FamilyMemberPair[];
  operatorName: string | null;
}

function headline(
  fam: FamilyCheckoutState | null,
  current: Batch | null,
  mismatchCount: number,
): { title: string; desc: string } {
  if (!fam) {
    return {
      title: 'Select an order to start checkout',
      desc: 'Click an order in the batch log on the left.',
    };
  }
  if (fam.phase === 'scanning') {
    return {
      title: `Order ${fam.parentBatchNumber}`,
      desc: current
        ? `Scan the printed label for ${current.batchNumber}.`
        : 'Scan the next printed label.',
    };
  }
  if (mismatchCount > 0) {
    return {
      title: `Order ${fam.parentBatchNumber} — ${mismatchCount} problem${mismatchCount === 1 ? '' : 's'}`,
      desc: 'Badge to close it out. The problem labels are flagged, not checked out.',
    };
  }
  return {
    title: `Order ${fam.parentBatchNumber} complete`,
    desc: 'Every label matched. Badge to check the order out.',
  };
}

function labelSlotPhase(fam: FamilyCheckoutState | null): SlotVisualPhase {
  if (!fam) return 'locked';
  if (fam.phase === 'scanning') return 'active';
  return 'complete';
}

function lockedHint(fam: FamilyCheckoutState | null): string {
  if (!fam) return 'Pick an order first';
  return 'Order finished — badge to close it out';
}

export function VerificationPanel({
  state,
  need,
  typedBuffer,
  onStartOver,
  embedded = false,
  familyCheckout: fam,
  parentBatch,
  orderMembers,
  currentMemberBatch,
  mismatches,
  operatorName,
}: VerificationPanelProps) {
  const isComplete = fam?.phase === 'complete';
  const isScanning = fam?.phase === 'scanning';
  const hasMismatch = mismatches.length > 0;

  const memberTotal = fam?.memberBatchIds.length ?? 0;
  const head = headline(fam, currentMemberBatch, mismatches.length);
  const slotPhase = labelSlotPhase(fam);

  const showNextUp =
    isScanning && !!fam?.lastRecordedBatchNumber && !!currentMemberBatch && !state.notice;

  return (
    <div
      className={`verification${embedded ? ' verification-embedded' : ' zone-panel main-floor-scan'}${fam ? ` verification-${fam.phase}` : ''}${hasMismatch ? ' verification-has-mismatch' : ''}`}
    >
      <header className="scan-zone-head">
        <span className="zone-tag">Checkout</span>
        <h2 className="zone-title">{head.title}</h2>
        <p className="zone-desc">{head.desc}</p>
      </header>

      {embedded && (
        <div className="scan-zone-steps-wrap">
          <OrderStepsPanel
            phase={fam?.phase ?? null}
            parentBatch={parentBatch}
            orderMembers={orderMembers}
            currentMemberIndex={fam?.currentMemberIndex ?? 0}
            completedPairs={fam?.completedPairs ?? []}
            mismatches={mismatches}
            operatorName={operatorName}
          />
        </div>
      )}

      <div className="slots slots-single">
        <ScanSlot
          step={1}
          title="PRINTED LABEL"
          subtitle="from the roll"
          side={state.label}
          activeNeed={need.side === 'label' && isScanning ? need.need : null}
          typedBuffer={isScanning ? typedBuffer : ''}
          visualPhase={slotPhase}
          inlinePrimary={isScanning ? 'Scan the QR code on the printed label' : undefined}
          inlineSub={
            isScanning && currentMemberBatch
              ? `Expecting ${currentMemberBatch.batchNumber}`
              : undefined
          }
          lockedHint={lockedHint(fam)}
          hideStepBadge={embedded}
        />
      </div>

      {isComplete ? (
        <>
          <div className={`verdict ${hasMismatch ? 'verdict-warn' : 'verdict-ok'}`}>
            <span className="verdict-icon">{hasMismatch ? '!' : '✓'}</span>
            {hasMismatch
              ? `${mismatches.length} OF ${memberTotal} DID NOT MATCH`
              : `ORDER COMPLETE — ${state.verifiedBatchNumber}`}
            <span className="verdict-sub">
              {state.notice ??
                (hasMismatch
                  ? 'Matched labels will be checked out. Problem labels go to a supervisor.'
                  : `All ${memberTotal} label${memberTotal === 1 ? '' : 's'} matched`)}
            </span>
          </div>
          <div className={`badge-prompt ${hasMismatch ? 'badge-prompt-bad' : 'badge-prompt-good'}`}>
            <span className="badge-prompt-icon" aria-hidden>
              🪪
            </span>
            <span className="badge-prompt-text">
              <strong>
                {operatorName
                  ? `${operatorName} — tap your badge to finish.`
                  : 'Tap your badge to finish.'}
              </strong>
              <span className="badge-prompt-sub">
                Nothing is recorded until you do, and the badge must match who is signed in.
              </span>
            </span>
          </div>
        </>
      ) : state.notice ? (
        <div className="verdict verdict-waiting verdict-notice">{state.notice}</div>
      ) : showNextUp ? (
        <div className="verdict verdict-waiting verdict-nextup">
          Recorded {fam?.lastRecordedBatchNumber} — next {currentMemberBatch?.batchNumber}
        </div>
      ) : null}

      {fam && (
        <div className="verdict verdict-actions">
          <button className="btn btn-ghost verdict-reset" onClick={onStartOver}>
            {isComplete ? 'Start over' : 'Cancel order'}
          </button>
        </div>
      )}
    </div>
  );
}
