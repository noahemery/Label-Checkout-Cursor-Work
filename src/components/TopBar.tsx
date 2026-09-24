import { useState } from 'react';
import { useAppData } from '../data/AppDataContext';
import { getShiftSession } from '../utils/shiftSession';
import { useSession } from '../session/SessionContext';

interface TopBarProps {
  onOpenAdmin: () => void;
  onOpenActivity: () => void;
  activityOpen: boolean;
  adminOpen: boolean;
}

export function TopBar({ onOpenAdmin, onOpenActivity, activityOpen, adminOpen }: TopBarProps) {
  const { operator, isAdmin, isRealAdmin, viewAsOperator, setViewAsOperator, signOut } =
    useSession();
  const { storeKind } = useAppData();
  const session = getShiftSession();
  const [logoOk, setLogoOk] = useState(true);

  return (
    <header className="topbar">
      <div className="topbar-brand">
        {logoOk && (
          <img
            src="/alltech-logo.png"
            alt="Alltech"
            className="topbar-logo-img"
            onError={() => setLogoOk(false)}
          />
        )}
        <div className="topbar-product">
          Label Verification
          <span className="topbar-sub">Print run</span>
        </div>
      </div>

      {isAdmin && (
        <div className="topbar-meta">
          <div className="meta-chip">
            <span className="meta-label">Session</span>
            <span className="meta-value">{session.id}</span>
          </div>
          <div className="meta-chip">
            <span className="meta-label">Shift</span>
            <span className="meta-value">{session.shift}</span>
          </div>
          <div className="meta-chip">
            <span className="meta-label">Store</span>
            <span className="meta-value">{storeKind === 'sqlite' ? 'SQLite' : 'IndexedDB'}</span>
          </div>
        </div>
      )}

      {(isAdmin || (isRealAdmin && viewAsOperator)) && (
        <div className="topbar-tools">
          {isAdmin && (
            <>
              <button
                className="btn btn-ghost"
                onClick={() => setViewAsOperator(true)}
                title="See exactly what an operator sees"
              >
                Operator view
              </button>
              <button
                className={`btn btn-ghost${activityOpen ? ' btn-active' : ''}`}
                aria-pressed={activityOpen}
                onClick={onOpenActivity}
              >
                Activity
              </button>
              <button
                className={`btn btn-ghost${adminOpen ? ' btn-active' : ''}`}
                aria-pressed={adminOpen}
                onClick={onOpenAdmin}
              >
                Admin
              </button>
            </>
          )}

          {/* Keyed on the real role, never the effective one — otherwise the
              admin has no way back out of the preview. */}
          {isRealAdmin && viewAsOperator && (
            <button className="btn view-as-exit" onClick={() => setViewAsOperator(false)}>
              Previewing as operator — exit
            </button>
          )}
        </div>
      )}

      <div className="topbar-right">
        {operator ? (
          <div className="operator-chip" title="Scan your badge again to sign out">
            <span className="operator-dot" aria-hidden />
            {isAdmin && <span className="role-pill role-pill-admin">Admin</span>}
            <strong>{operator.name}</strong>
            <button className="btn btn-ghost btn-sm" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        ) : (
          <div className="operator-chip operator-chip-off">
            <span className="status-lamp status-lamp-off" aria-hidden />
            Awaiting badge sign-in
          </div>
        )}
      </div>
    </header>
  );
}
