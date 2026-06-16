import { getShiftSession } from '../utils/shiftSession';
import { useSession } from '../session/SessionContext';
import { useSheetPage } from '../data/SheetPageContext';

interface TopBarProps {
  onOpenAdmin: () => void;
  onOpenActivity: () => void;
  activityOpen: boolean;
  adminOpen: boolean;
}

export function TopBar({ onOpenAdmin, onOpenActivity, activityOpen, adminOpen }: TopBarProps) {
  const { operator, signOut } = useSession();
  const { activePage } = useSheetPage();
  const session = getShiftSession();

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <img
          src="/alltech-logo.png"
          alt="Alltech"
          className="topbar-logo-img"
        />
        <div className="topbar-product">
          Label Verification
          <span className="topbar-sub">FMI B001 · {activePage.referenceNumber}</span>
        </div>
      </div>

      <div className="topbar-meta">
        <div className="meta-chip">
          <span className="meta-label">Session</span>
          <span className="meta-value">{session.id}</span>
        </div>
        <div className="meta-chip">
          <span className="meta-label">Shift</span>
          <span className="meta-value">{session.shift}</span>
        </div>
      </div>

      <div className="topbar-right">
        {operator ? (
          <div className="operator-chip" title="Scan your badge again to sign out">
            <span className="operator-dot" aria-hidden />
            <span className="operator-label">Operator</span>
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
      </div>
    </header>
  );
}
