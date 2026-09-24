import { familyOrderTotal, formatOrderTotal, formatRunQty } from '../domain/batchDisplay';
import type { FamilyCheckoutPhase, FamilyMemberPair } from '../domain/familyCheckout';
import type { Batch } from '../domain/types';

interface OrderStepsPanelProps {
  phase: FamilyCheckoutPhase | null;
  parentBatch: Batch | null;
  orderMembers: Batch[];
  /** Index of the member awaiting its label scan. */
  currentMemberIndex: number;
  completedPairs: FamilyMemberPair[];
  mismatches: FamilyMemberPair[];
  operatorName: string | null;
}

type StepState = 'done' | 'mismatch' | 'current' | 'pending';

/**
 * What the operator is asked to do, one line per label, in run order.
 *
 * The whole order is visible from the start so the operator knows how many
 * labels this run needs before they begin — the parent, then each split run,
 * then the badge tap that checks the order out.
 */
function stepTitle(index: number, total: number): string {
  if (total === 1) return 'Scan the label';
  if (index === 0) return 'Scan the parent';
  return `Scan child batch ${index}`;
}

function stepIcon(state: StepState, position: number): string {
  if (state === 'done') return '✓';
  if (state === 'mismatch') return '✕';
  return String(position);
}

export function OrderStepsPanel({
  phase,
  parentBatch,
  orderMembers,
  currentMemberIndex,
  completedPairs,
  mismatches,
  operatorName,
}: OrderStepsPanelProps) {
  if (!phase || !parentBatch) {
    return (
      <div className="order-steps order-steps-idle">
        <p className="order-steps-idle-text">
          Click an order in the batch log to start a checkout.
        </p>
      </div>
    );
  }

  const total = orderMembers.length;
  const pairByBatchId = new Map(completedPairs.map((p) => [p.batchId, p]));
  const allScanned = phase === 'complete';

  const stateFor = (member: Batch, index: number): StepState => {
    const pair = pairByBatchId.get(member.id);
    if (pair) return pair.result.ok ? 'done' : 'mismatch';
    if (index === currentMemberIndex && phase === 'scanning') return 'current';
    return 'pending';
  };

  return (
    <div className={`order-steps order-steps-${phase}`}>
      <div className="order-steps-head">
        <span className="order-steps-order">Order {parentBatch.batchNumber}</span>
        <span className="order-steps-count">
          {total} label{total === 1 ? '' : 's'}
          {formatOrderTotal(familyOrderTotal(orderMembers))
            ? ` · ${formatOrderTotal(familyOrderTotal(orderMembers))} total`
            : ''}
        </span>
      </div>

      <ol className="order-steps-list">
        {orderMembers.map((member, i) => {
          const state = stateFor(member, i);
          const pair = pairByBatchId.get(member.id);
          return (
            <li key={member.id} className={`order-step order-step-${state}`}>
              <span className="order-step-icon" aria-hidden>
                {stepIcon(state, i + 1)}
              </span>
              <span className="order-step-body">
                <span className="order-step-title">{stepTitle(i, total)}</span>
                <span className="order-step-batch">{member.batchNumber}</span>
                <span className="order-step-meta">
                  Label {member.labelCode ?? '—'}
                  {formatRunQty(member) ? ` · ${formatRunQty(member)}` : ''}
                </span>
                {state === 'mismatch' && pair && (
                  <span className="order-step-problem">
                    {pair.result.comparisons
                      .filter((c) => !c.ok)
                      .map((c) => `${c.field}: scanned ${c.labelValue}, expected ${c.sheetValue}`)
                      .join(' · ')}
                  </span>
                )}
              </span>
            </li>
          );
        })}

        <li
          className={`order-step order-step-badge ${
            allScanned ? 'order-step-current' : 'order-step-pending'
          }`}
        >
          <span className="order-step-icon" aria-hidden>
            🪪
          </span>
          <span className="order-step-body">
            <span className="order-step-title">
              {mismatches.length > 0
                ? 'Tap your badge to close this order'
                : 'Tap your badge to check out'}
            </span>
            <span className="order-step-meta">
              {allScanned
                ? operatorName
                  ? `${operatorName} — the badge must match who is signed in`
                  : 'The badge must match who is signed in'
                : 'After every label above is scanned'}
            </span>
          </span>
        </li>
      </ol>
    </div>
  );
}
