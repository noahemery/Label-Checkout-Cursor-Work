import type { SideData } from '../domain/matching';
import { sideComplete } from '../domain/matching';

interface ScanSlotProps {
  step: 1 | 2;
  title: string;
  subtitle: string;
  side: SideData;
  /** What this slot is currently waiting for, if it's the listening slot. */
  activeNeed: 'batch' | 'code' | null;
  /** Uncommitted hand-typed text, echoed live while this slot is listening. */
  typedBuffer: string;
  verified: boolean;
}

export function ScanSlot({
  step,
  title,
  subtitle,
  side,
  activeNeed,
  typedBuffer,
  verified,
}: ScanSlotProps) {
  const complete = sideComplete(side);
  const className = [
    'slot',
    activeNeed ? 'slot-active' : '',
    complete ? 'slot-filled' : '',
    verified ? 'slot-verified' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={className}>
      <div className="slot-header">
        <span className="slot-step">{step}</span>
        <div>
          <div className="slot-title">{title}</div>
          <div className="slot-subtitle">{subtitle}</div>
        </div>
        <div className="slot-status">
          <span
            className={`status-lamp ${
              verified
                ? 'status-lamp-green'
                : complete
                  ? 'status-lamp-blue'
                  : activeNeed
                    ? 'status-lamp-amber pulse'
                    : 'status-lamp-off'
            }`}
            aria-hidden
          />
          {verified ? 'VERIFIED' : complete ? 'CAPTURED' : activeNeed ? 'SCAN NOW' : 'STANDBY'}
        </div>
      </div>

      <div className="slot-body">
        {activeNeed && typedBuffer ? (
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
              <div className="slot-need-code">NOW SCAN THE QR (LABEL CODE)</div>
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
            <div className="slot-need-code">NOW SCAN THE BATCH NUMBER</div>
          </>
        ) : (
          <div className="slot-waiting">
            {activeNeed ? (
              <>
                <div className="slot-pulse" />
                <div className="slot-waiting-text">SCAN OR TYPE</div>
              </>
            ) : (
              <div className="slot-waiting-text slot-waiting-dim">— waiting —</div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
