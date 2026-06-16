import { useEffect, useState } from 'react';
import { useAppData } from '../data/AppDataContext';
import { useSession } from '../session/SessionContext';

interface BadgeGateProps {
  /** Set when a non-badge scan happened while signed out. */
  notice: string | null;
  onOpenAdmin: () => void;
}

export function BadgeGate({ notice, onOpenAdmin }: BadgeGateProps) {
  const { unknownBadge, signInManual } = useSession();
  const { operators } = useAppData();
  const [manualOpen, setManualOpen] = useState(false);

  // Stop the verification slots from scrolling into view behind the gate.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div className="badge-gate">
      <div className="badge-gate-icon">🪪</div>
      <div className="badge-gate-title">SCAN YOUR BADGE TO START</div>
      <div className="badge-gate-sub">Tap your door badge on the reader</div>
      {notice && <div className="badge-gate-notice">{notice}</div>}
      {unknownBadge && (
        <div className="badge-gate-unknown">
          Badge <code>{unknownBadge}</code> is not enrolled.
          <button className="btn btn-ghost" onClick={onOpenAdmin}>
            Enroll badge (supervisor)
          </button>
        </div>
      )}

      {/* Discreet fallback for demos / no reader connected. Audited as manual. */}
      <div className="badge-gate-manual">
        {manualOpen ? (
          <div className="manual-signin">
            <div className="manual-signin-hint">
              Manual sign-in (logged in the audit trail as badge-less):
            </div>
            {operators.length === 0 ? (
              <div className="manual-signin-empty">
                No operators enrolled yet.
                <button className="btn btn-ghost" onClick={onOpenAdmin}>
                  Open Admin to enroll
                </button>
              </div>
            ) : (
              <div className="manual-signin-list">
                {operators.map((op) => (
                  <button key={op.id} className="btn" onClick={() => void signInManual(op)}>
                    {op.name}
                  </button>
                ))}
              </div>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => setManualOpen(false)}>
              Hide
            </button>
          </div>
        ) : (
          <button className="manual-signin-toggle" onClick={() => setManualOpen(true)}>
            No reader? Sign in manually
          </button>
        )}
      </div>
    </div>
  );
}
