import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { playError, playSuccess } from '../audio/sounds';
import { useSettings } from '../config/SettingsContext';
import { useAppData } from '../data/AppDataContext';
import type { Operator } from '../domain/types';

/**
 * Operator session layer. A badge scan signs the operator in; scanning the
 * same badge again signs out; scanning a different badge switches operator.
 * Every session change is written to the audit trail.
 */

export type BadgeResult = 'signed_in' | 'signed_out' | 'unknown';

interface SessionContextValue {
  operator: Operator | null;
  /** Badge that was scanned but isn't enrolled (drives the enroll hint). */
  unknownBadge: string | null;
  /**
   * Try to sign in/out with a badge ID. Returns 'unknown' (silently) when
   * the badge isn't enrolled — the caller decides whether the payload was
   * really a badge or some other numeric code (UPC, item number...), and
   * calls reportUnknownBadge if it was.
   */
  handleBadge: (badgeId: string) => Promise<BadgeResult>;
  reportUnknownBadge: (badgeId: string) => void;
  /** Badge-less sign-in for demos/testing — audited as manual. */
  signInManual: (operator: Operator) => Promise<void>;
  signOut: () => Promise<void>;
  clearUnknownBadge: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { store, logAudit } = useAppData();
  const { settings } = useSettings();
  const [operator, setOperator] = useState<Operator | null>(null);
  const [unknownBadge, setUnknownBadge] = useState<string | null>(null);

  const signOut = useCallback(async () => {
    if (!operator) return;
    setOperator(null);
    await logAudit({
      type: 'sign_out',
      operatorId: operator.id,
      operatorName: operator.name,
      batchNumber: null,
      detail: 'Operator signed out',
    });
  }, [operator, logAudit]);

  const reportUnknownBadge = useCallback(
    (badgeId: string) => {
      setUnknownBadge(badgeId);
      if (settings.soundEnabled) playError();
    },
    [settings.soundEnabled],
  );

  const handleBadge = useCallback(
    async (badgeId: string): Promise<BadgeResult> => {
      setUnknownBadge(null);
      const found = await store.getOperatorByBadge(badgeId);

      if (!found) return 'unknown';

      if (operator && operator.id === found.id) {
        // Same badge tapped again = sign out.
        await signOut();
        return 'signed_out';
      }

      if (operator) {
        await logAudit({
          type: 'sign_out',
          operatorId: operator.id,
          operatorName: operator.name,
          batchNumber: null,
          detail: 'Signed out (operator switch)',
        });
      }

      setOperator(found);
      if (settings.soundEnabled) playSuccess();
      await logAudit({
        type: 'sign_in',
        operatorId: found.id,
        operatorName: found.name,
        batchNumber: null,
        detail: 'Operator signed in via badge',
      });
      return 'signed_in';
    },
    [store, operator, signOut, logAudit, settings.soundEnabled],
  );

  const signInManual = useCallback(
    async (found: Operator) => {
      setUnknownBadge(null);
      if (operator && operator.id !== found.id) {
        await logAudit({
          type: 'sign_out',
          operatorId: operator.id,
          operatorName: operator.name,
          batchNumber: null,
          detail: 'Signed out (operator switch)',
        });
      }
      setOperator(found);
      if (settings.soundEnabled) playSuccess();
      await logAudit({
        type: 'sign_in',
        operatorId: found.id,
        operatorName: found.name,
        batchNumber: null,
        detail: 'Manual sign-in (no badge) — demo/testing',
      });
    },
    [operator, logAudit, settings.soundEnabled],
  );

  const clearUnknownBadge = useCallback(() => setUnknownBadge(null), []);

  const value = useMemo(
    () => ({
      operator,
      unknownBadge,
      handleBadge,
      reportUnknownBadge,
      signInManual,
      signOut,
      clearUnknownBadge,
    }),
    [operator, unknownBadge, handleBadge, reportUnknownBadge, signInManual, signOut, clearUnknownBadge],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
