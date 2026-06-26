import type { SideData } from '../domain/matching';
import { sideComplete } from '../domain/matching';

export type SlotVisualPhase = 'active' | 'complete' | 'locked';

interface ScanSlotProps {
  step: 1 | 2;
  title: string;
  subtitle: string;
  side: SideData;
  activeNeed: 'batch' | 'code' | null;
  typedBuffer: string;
  visualPhase: SlotVisualPhase;
  inlinePrimary?: string;
  inlineSub?: string;
  lockedHint?: string;
}

export function ScanSlot({
  step,
  title,
  subtitle,
  side,
  activeNeed,
  typedBuffer,
  visualPhase,
  inlinePrimary,
  inlineSub,
  lockedHint,
}: ScanSlotProps) {
  const complete = sideComplete(side);
  const className = [
    'slot',
    visualPhase === 'active' ? 'slot-active' : '',
    visualPhase === 'complete' ? 'slot-complete' : '',
    visualPhase === 'locked' ? 'slot-locked' : '',
    complete && visualPhase !== 'locked' ? 'slot-filled' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const stepClass =
    visualPhase === 'complete'
      ? 'slot-step slot-step-done'
      : visualPhase === 'active'
        ? 'slot-step slot-step-active'
        : 'slot-step';

  return (
    <section className={className} aria-disabled={visualPhase === 'locked'}>
      <div className="slot-header">
        <span className={stepClass}>
          {visualPhase === 'complete' ? '✓' : step}
        </span>
        <div>
          <div className="slot-title">{title}</div>
          <div className="slot-subtitle">{subtitle}</div>
        </div>
        {visualPhase === 'active' && (
          <span className="status-lamp status-lamp-amber pulse" aria-hidden />
        )}
      </div>

      <div className="slot-body">
        {visualPhase === 'locked' ? (
          <div className="slot-locked-body">
            <p className="slot-locked-hint">{lockedHint ?? 'Waiting for previous step'}</p>
          </div>
        ) : activeNeed && typedBuffer ? (
          <div className="slot-typing">
            {typedBuffer}
            <span className="slot-caret" />
            <div className="slot-typing-hint">press ENTER when done</div>
          </div>
        ) : side.batchNumber ? (
          <>
            <div className="slot-batch">{side.batchNumber}</div>
            {side.labelCode ? (
              <div className="slot-labelcode">{side.labelCode}</div>
            ) : (
              visualPhase === 'active' && (
                <div className="slot-need-code">Scan the label code (QR)</div>
              )
            )}
            <div className="slot-meta">
              {side.itemNumber && <span>Item {side.itemNumber}</span>}
              <span className={side.knownBatch ? 'tag tag-known' : 'tag tag-unknown'}>
                {side.knownBatch ? 'in today\u2019s list' : 'NOT in today\u2019s list'}
              </span>
            </div>
          </>
        ) : side.labelCode ? (
          <>
            <div className="slot-labelcode">{side.labelCode}</div>
            {visualPhase === 'active' && (
              <div className="slot-need-code">Scan the batch number barcode</div>
            )}
          </>
        ) : visualPhase === 'active' ? (
          <div className="slot-scan-prompt">
            <div className="slot-scan-icon" aria-hidden>
              <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="4" y="10" width="2" height="28" fill="currentColor" />
                <rect x="9" y="10" width="1" height="28" fill="currentColor" />
                <rect x="13" y="10" width="3" height="28" fill="currentColor" />
                <rect x="19" y="10" width="1" height="28" fill="currentColor" />
                <rect x="23" y="10" width="2" height="28" fill="currentColor" />
                <rect x="28" y="10" width="1" height="28" fill="currentColor" />
                <rect x="32" y="10" width="3" height="28" fill="currentColor" />
                <rect x="38" y="10" width="1" height="28" fill="currentColor" />
                <rect x="42" y="10" width="2" height="28" fill="currentColor" />
                <path
                  d="M4 38h40"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            {inlinePrimary && <p className="slot-instruction-primary">{inlinePrimary}</p>}
            {inlineSub && <p className="slot-instruction-sub">{inlineSub}</p>}
          </div>
        ) : null}
      </div>
    </section>
  );
}
