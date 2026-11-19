import type { ReactNode } from 'react';
import type { FamilyCheckoutState, FamilyMemberPair } from '../domain/familyCheckout';
import type { Batch } from '../domain/types';
import type { SlotNeed, VerificationState } from '../verification/useVerification';
import { Es } from './Es';
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

interface Headline {
  title: string;
  titleEs: string | null;
  desc: string;
  descEs: string;
}

function headline(
  fam: FamilyCheckoutState | null,
  current: Batch | null,
  mismatchCount: number,
): Headline {
  if (!fam) {
    return {
      title: 'Select an order to start checkout',
      titleEs: 'Seleccione una orden para empezar',
      desc: 'Click an order in the batch log on the left.',
      descEs: 'Haga clic en una orden de la lista a la izquierda.',
    };
  }
  if (fam.phase === 'scanning') {
    return {
      title: `Order ${fam.parentBatchNumber}`,
      titleEs: null,
      desc: current
        ? `Scan the printed label for ${current.batchNumber}.`
        : 'Scan the next printed label.',
      descEs: current
        ? `Escanee la etiqueta impresa de ${current.batchNumber}.`
        : 'Escanee la siguiente etiqueta impresa.',
    };
  }
  if (mismatchCount > 0) {
    return {
      title: `Order ${fam.parentBatchNumber} — ${mismatchCount} problem${mismatchCount === 1 ? '' : 's'}`,
      titleEs: `Orden ${fam.parentBatchNumber} — ${mismatchCount} problema${mismatchCount === 1 ? '' : 's'}`,
      desc: 'Badge to close it out. The problem labels are flagged, not checked out.',
      descEs:
        'Pase su tarjeta para cerrarla. Las etiquetas con problema quedan marcadas, no se les da salida.',
    };
  }
  return {
    title: `Order ${fam.parentBatchNumber} complete`,
    titleEs: `Orden ${fam.parentBatchNumber} completa`,
    desc: 'Every label matched. Badge to check the order out.',
    descEs: 'Todas las etiquetas coinciden. Pase su tarjeta para dar salida a la orden.',
  };
}

function labelSlotPhase(fam: FamilyCheckoutState | null): SlotVisualPhase {
  if (!fam) return 'locked';
  if (fam.phase === 'scanning') return 'active';
  return 'complete';
}

function lockedHint(fam: FamilyCheckoutState | null): ReactNode {
  if (!fam) {
    return (
      <>
        Pick an order first
        <Es>Primero elija una orden</Es>
      </>
    );
  }
  return (
    <>
      Order finished — badge to close it out
      <Es>Orden terminada — pase su tarjeta para cerrarla</Es>
    </>
  );
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
        <span className="zone-tag">Checkout · Salida</span>
        <ol className="checkout-guide">
          <li className={!fam ? 'is-current' : 'is-done'}>
            1. Pick the order
            <Es>Elija la orden</Es>
          </li>
          <li className={isScanning ? 'is-current' : isComplete ? 'is-done' : ''}>
            2. Scan each label
            <Es>Escanee cada etiqueta</Es>
          </li>
          <li className={isComplete ? 'is-current' : ''}>
            3. Badge to finish
            <Es>Pase su tarjeta para terminar</Es>
          </li>
        </ol>
        <h2 className="zone-title">
          {head.title}
          {head.titleEs && <Es>{head.titleEs}</Es>}
        </h2>
        <p className="zone-desc">
          {head.desc}
          <Es>{head.descEs}</Es>
        </p>
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
          subtitle={
            <>
              from the roll <Es>etiqueta impresa del rollo</Es>
            </>
          }
          side={state.label}
          activeNeed={need.side === 'label' && isScanning ? need.need : null}
          typedBuffer={isScanning ? typedBuffer : ''}
          visualPhase={slotPhase}
          inlinePrimary={
            isScanning ? (
              <>
                Scan the QR code on the printed label
                <Es>Escanee el código QR de la etiqueta impresa</Es>
              </>
            ) : undefined
          }
          inlineSub={
            isScanning && currentMemberBatch ? (
              <>
                Expecting {currentMemberBatch.batchNumber}
                <Es>Se espera {currentMemberBatch.batchNumber}</Es>
              </>
            ) : undefined
          }
          lockedHint={lockedHint(fam)}
          hideStepBadge={embedded}
        />
      </div>

      {isComplete ? (
        <>
          <div className={`verdict ${hasMismatch ? 'verdict-warn' : 'verdict-ok'}`}>
            <span className="verdict-icon">{hasMismatch ? '!' : '✓'}</span>
            <span className="verdict-lines">
              {hasMismatch
                ? `${mismatches.length} OF ${memberTotal} DID NOT MATCH`
                : `ORDER COMPLETE — ${state.verifiedBatchNumber}`}
              <Es>
                {hasMismatch
                  ? `${mismatches.length} DE ${memberTotal} NO COINCIDEN`
                  : `ORDEN COMPLETA — ${state.verifiedBatchNumber}`}
              </Es>
            </span>
            <span className="verdict-sub">
              {state.notice ??
                (hasMismatch ? (
                  <>
                    Matched labels will be checked out. Problem labels go to a supervisor.
                    <Es>
                      Las etiquetas que coinciden salen. Las etiquetas con problema van a un
                      supervisor.
                    </Es>
                  </>
                ) : (
                  <>
                    All {memberTotal} label{memberTotal === 1 ? '' : 's'} matched
                    <Es>
                      {memberTotal === 1
                        ? 'La etiqueta coincide'
                        : `Las ${memberTotal} etiquetas coinciden`}
                    </Es>
                  </>
                ))}
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
                <Es>Pase su tarjeta para terminar.</Es>
              </strong>
              <span className="badge-prompt-sub">
                Nothing is recorded until you do, and the badge must match who is signed in.
                <Es>
                  No se registra nada hasta que lo haga, y la tarjeta debe ser de quien inició
                  sesión.
                </Es>
              </span>
            </span>
          </div>
        </>
      ) : state.notice ? (
        <div className="verdict verdict-waiting verdict-notice">{state.notice}</div>
      ) : showNextUp ? (
        <div className="verdict verdict-waiting verdict-nextup">
          <span className="verdict-lines">
            Recorded {fam?.lastRecordedBatchNumber} — next {currentMemberBatch?.batchNumber}
            <Es>
              Registrada {fam?.lastRecordedBatchNumber} — sigue {currentMemberBatch?.batchNumber}
            </Es>
          </span>
        </div>
      ) : null}

      {fam && (
        <div className="verdict verdict-actions">
          <button className="btn btn-ghost verdict-reset" onClick={onStartOver}>
            {isComplete ? 'Start over' : 'Cancel order'}
            <Es>{isComplete ? 'Empezar de nuevo' : 'Cancelar orden'}</Es>
          </button>
        </div>
      )}
    </div>
  );
}
