import type { SideData } from '../domain/matching';
import { sideComplete } from '../domain/matching';

export type SlotVisualPhase = 'active' | 'complete' | 'locked';

function PrintedLabelIcon() {
  return (
    <svg viewBox="0 0 120 76" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect
        x="1"
        y="1"
        width="118"
        height="74"
        rx="3"
        fill="#fff"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M1 1 V75 H62 L1 28 Z" fill="#b45728" />
      <path d="M1 1 V75 H58 L1 24 Z" fill="#c8642a" opacity="0.55" />

      <rect x="5" y="5" width="15" height="15" fill="#fff" stroke="#2a2118" strokeWidth="0.8" />
      <rect x="6.5" y="6.5" width="4.5" height="4.5" fill="#2a2118" />
      <rect x="13" y="6.5" width="4.5" height="4.5" fill="#2a2118" />
      <rect x="6.5" y="13" width="4.5" height="4.5" fill="#2a2118" />
      <rect x="11.5" y="11.5" width="2" height="2" fill="#2a2118" />
      <rect x="14.5" y="14.5" width="3.5" height="3.5" fill="#2a2118" />

      <rect x="24" y="7" width="56" height="4.5" rx="1" fill="#1f1f1f" />
      <rect x="24" y="13" width="36" height="2.5" rx="1" fill="#1f1f1f" opacity="0.55" />

      <rect x="24" y="20" width="20" height="1.8" rx="0.9" fill="#4a4a4a" opacity="0.35" />
      <rect x="24" y="24" width="18" height="1.8" rx="0.9" fill="#4a4a4a" opacity="0.3" />
      <rect x="24" y="28" width="21" height="1.8" rx="0.9" fill="#4a4a4a" opacity="0.28" />
      <rect x="24" y="32" width="16" height="1.8" rx="0.9" fill="#4a4a4a" opacity="0.25" />
      <rect x="24" y="38" width="19" height="1.8" rx="0.9" fill="#4a4a4a" opacity="0.22" />
      <rect x="24" y="58" width="22" height="2" rx="1" fill="#1f1f1f" opacity="0.4" />

      <rect x="50" y="20" width="24" height="1.8" rx="0.9" fill="#4a4a4a" opacity="0.35" />
      <rect x="50" y="24" width="22" height="1.8" rx="0.9" fill="#4a4a4a" opacity="0.3" />
      <rect x="50" y="28" width="25" height="1.8" rx="0.9" fill="#4a4a4a" opacity="0.28" />
      <rect x="50" y="32" width="20" height="1.8" rx="0.9" fill="#4a4a4a" opacity="0.25" />
      <rect x="50" y="36" width="23" height="1.8" rx="0.9" fill="#4a4a4a" opacity="0.22" />
      <rect x="50" y="40" width="18" height="1.8" rx="0.9" fill="#4a4a4a" opacity="0.2" />
      <rect x="58" y="58" width="16" height="2.2" rx="1" fill="#b45728" opacity="0.85" />
    </svg>
  );
}

function BarcodeIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="4" y="10" width="2" height="28" fill="currentColor" />
      <rect x="9" y="10" width="1" height="28" fill="currentColor" />
      <rect x="13" y="10" width="3" height="28" fill="currentColor" />
      <rect x="19" y="10" width="1" height="28" fill="currentColor" />
      <rect x="23" y="10" width="2" height="28" fill="currentColor" />
      <rect x="28" y="10" width="1" height="28" fill="currentColor" />
      <rect x="32" y="10" width="3" height="28" fill="currentColor" />
      <rect x="38" y="10" width="1" height="28" fill="currentColor" />
      <rect x="42" y="10" width="2" height="28" fill="currentColor" />
      <path d="M4 38h40" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

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
  hideStepBadge?: boolean;
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
  hideStepBadge = false,
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
        {!hideStepBadge && (
          <span className={stepClass}>
            {visualPhase === 'complete' ? '✓' : step}
          </span>
        )}
        <div>
          <div className="slot-title">{title}</div>
          {subtitle ? <div className="slot-subtitle">{subtitle}</div> : null}
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
                <div className="slot-need-code">Scan the QR code on the printed label</div>
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
              <div className="slot-need-code">Scan the QR code on the printed label</div>
            )}
          </>
        ) : visualPhase === 'active' ? (
          <div className="slot-scan-prompt">
            <div
              className={`slot-scan-icon${step === 1 ? ' slot-scan-icon-label' : ''}`}
              aria-hidden
            >
              {step === 1 ? <PrintedLabelIcon /> : <BarcodeIcon />}
            </div>
            {inlinePrimary && <p className="slot-instruction-primary">{inlinePrimary}</p>}
            {inlineSub ? <p className="slot-instruction-sub">{inlineSub}</p> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
