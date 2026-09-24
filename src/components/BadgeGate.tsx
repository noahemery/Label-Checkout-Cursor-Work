import { useEffect, useState } from 'react';
import { useAppData } from '../data/AppDataContext';
import { useSession } from '../session/SessionContext';
import type { Operator } from '../domain/types';

interface BadgeGateProps {
  notice: string | null;
  onOpenAdmin: () => void;
}

function userRole(op: Operator): 'admin' | 'operator' {
  return op.role ?? 'operator';
}

export function BadgeGate({ notice, onOpenAdmin }: BadgeGateProps) {
  const { unknownBadge, signInManual } = useSession();
  const { operators } = useAppData();
  const [manualOpen, setManualOpen] = useState(false);

  // One flat list — admins are ordinary profiles with a quiet side tag, sorted
  // below the operators so the floor sees its own names first.
  const profiles = [...operators].sort((a, b) => {
    const roleRank = (op: Operator) => (userRole(op) === 'admin' ? 1 : 0);
    return roleRank(a) - roleRank(b) || a.name.localeCompare(b.name);
  });

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

      <div className="badge-gate-manual">
        {manualOpen ? (
          <div className="manual-signin">
            <div className="manual-signin-hint">
              Choose your profile — recorded in the audit trail as a manual sign-in
            </div>
            {operators.length === 0 ? (
              <div className="manual-signin-empty">
                No users enrolled yet.
                <button className="btn btn-ghost" onClick={onOpenAdmin}>
                  Open Admin to enroll
                </button>
              </div>
            ) : (
              <div className="profile-list">
                {profiles.map((op) => (
                  <button
                    key={op.id}
                    className="profile-row"
                    onClick={() => void signInManual(op)}
                  >
                    <span className="profile-row-name">{op.name}</span>
                    {userRole(op) === 'admin' && (
                      <span className="profile-row-tag">admin</span>
                    )}
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
