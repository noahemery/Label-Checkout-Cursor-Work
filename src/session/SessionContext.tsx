import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { playError, playSuccess } from '../audio/sounds';
import { useSettings } from '../config/SettingsContext';
import { useAppData } from '../data/AppDataContext';
import type { Operator, UserRole } from '../domain/types';

/**
 * Operator session layer. Badge at start boots the admin or operator profile.
 * Scanning the same badge again signs out; a different badge switches user.
 * Idle timeout auto-signs out after configurable inactivity (admin settings).
 */

export type BadgeResult = 'signed_in' | 'signed_out' | 'unknown';

/**
 * How the current session was started. A badge tap proves who is standing
 * there; picking a profile off the list does not, so anything recorded during
 * a `manual` session is attributed but not proven.
 */
export type SignInMethod = 'badge' | 'manual';

function effectiveRole(op: Operator): UserRole {
  return op.role ?? 'operator';
}

interface SessionContextValue {
  operator: Operator | null;
  role: UserRole | null;
  /** How this session was started — null when signed out. */
  signInMethod: SignInMethod | null;
  /**
   * Promote the session to badge-proven. Called when the signed-in user taps
   * their own badge to sign off an order, which retroactively confirms that
   * the person at the station really is the profile that was picked.
   */
  markBadgeProven: () => void;
  /**
   * Effective admin: true only when the user is an admin AND is not previewing
   * the operator view. Every role-gated piece of UI should use this.
   */
  isAdmin: boolean;
  /** The enrolled role, ignoring the preview. Only the exit control uses this. */
  isRealAdmin: boolean;
  viewAsOperator: boolean;
  setViewAsOperator: (on: boolean) => void;
  unknownBadge: string | null;
  handleBadge: (badgeId: string) => Promise<BadgeResult>;
  reportUnknownBadge: (badgeId: string) => void;
  signInManual: (operator: Operator) => Promise<void>;
  signOut: () => Promise<void>;
  clearUnknownBadge: () => void;
  /** Reset the idle sign-out timer (called on scans and UI activity). */
  touchSession: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { store, logAudit } = useAppData();
  const { settings } = useSettings();
  const [operator, setOperator] = useState<Operator | null>(null);
  const [signInMethod, setSignInMethod] = useState<SignInMethod | null>(null);
  const [viewAsOperator, setViewAsOperator] = useState(false);
  const [unknownBadge, setUnknownBadge] = useState<string | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const operatorRef = useRef(operator);
  operatorRef.current = operator;

  const role = operator ? effectiveRole(operator) : null;
  const isRealAdmin = role === 'admin';
  const isAdmin = isRealAdmin && !viewAsOperator;

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const endSession = useCallback(
    async (detail: string) => {
      const current = operatorRef.current;
      if (!current) return;
      setOperator(null);
      setSignInMethod(null);
      setViewAsOperator(false);
      await logAudit({
        type: 'sign_out',
        operatorId: current.id,
        operatorName: current.name,
        batchNumber: null,
        detail,
      });
    },
    [logAudit],
  );

  const signOut = useCallback(async () => {
    clearIdleTimer();
    await endSession('Signed out');
  }, [clearIdleTimer, endSession]);

  const touchSession = useCallback(() => {
    if (!operatorRef.current) return;
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      idleTimerRef.current = null;
      void (async () => {
        if (settings.soundEnabled) playError();
        await endSession('Signed out — idle timeout (no activity)');
      })();
    }, settings.sessionTimeoutMs);
  }, [clearIdleTimer, endSession, settings.sessionTimeoutMs, settings.soundEnabled]);

  useEffect(() => {
    if (!operator) {
      clearIdleTimer();
      return;
    }

    touchSession();

    const onActivity = () => touchSession();
    document.addEventListener('pointerdown', onActivity);
    document.addEventListener('keydown', onActivity);

    return () => {
      document.removeEventListener('pointerdown', onActivity);
      document.removeEventListener('keydown', onActivity);
      clearIdleTimer();
    };
  }, [operator, touchSession, clearIdleTimer, settings.sessionTimeoutMs]);

  const reportUnknownBadge = useCallback(
    (badgeId: string) => {
      setUnknownBadge(badgeId);
      if (settings.soundEnabled) playError();
    },
    [settings.soundEnabled],
  );

  const signInUser = useCallback(
    async (found: Operator, via: 'badge' | 'manual') => {
      setUnknownBadge(null);
      const userRole = effectiveRole(found);

      if (operator && operator.id !== found.id) {
        await logAudit({
          type: 'sign_out',
          operatorId: operator.id,
          operatorName: operator.name,
          batchNumber: null,
          detail: 'Signed out (user switch)',
        });
      }

      setOperator({ ...found, role: userRole });
      setSignInMethod(via);
      setViewAsOperator(false);
      if (settings.soundEnabled) playSuccess();
      await logAudit({
        type: 'sign_in',
        operatorId: found.id,
        operatorName: found.name,
        batchNumber: null,
        detail:
          via === 'badge'
            ? `Signed in via badge (${userRole} profile)`
            : `Manual sign-in (${userRole} profile) — demo/testing`,
      });
    },
    [operator, logAudit, settings.soundEnabled],
  );

  const handleBadge = useCallback(
    async (badgeId: string): Promise<BadgeResult> => {
      setUnknownBadge(null);
      const found = await store.getOperatorByBadge(badgeId);

      if (!found) return 'unknown';

      if (operator && operator.id === found.id) {
        await signOut();
        return 'signed_out';
      }

      await signInUser(found, 'badge');
      return 'signed_in';
    },
    [store, operator, signOut, signInUser],
  );

  const signInManual = useCallback(
    async (found: Operator) => {
      await signInUser(found, 'manual');
    },
    [signInUser],
  );

  const clearUnknownBadge = useCallback(() => setUnknownBadge(null), []);

  const markBadgeProven = useCallback(() => setSignInMethod('badge'), []);

  const value = useMemo(
    () => ({
      operator,
      role,
      signInMethod,
      markBadgeProven,
      isAdmin,
      isRealAdmin,
      viewAsOperator,
      setViewAsOperator,
      unknownBadge,
      handleBadge,
      reportUnknownBadge,
      signInManual,
      signOut,
      clearUnknownBadge,
      touchSession,
    }),
    [
      operator,
      role,
      signInMethod,
      markBadgeProven,
      isAdmin,
      isRealAdmin,
      viewAsOperator,
      unknownBadge,
      handleBadge,
      reportUnknownBadge,
      signInManual,
      signOut,
      clearUnknownBadge,
      touchSession,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
