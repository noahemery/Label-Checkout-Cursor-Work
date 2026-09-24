import { useCallback, useEffect, useRef, useState } from 'react';
import { playError } from './audio/sounds';
import { useWedgeCapture } from './capture/useWedgeCapture';
import type { CaptureCommit } from './capture/useWedgeCapture';
import { ActivityDrawer } from './components/ActivityDrawer';
import { AdminModal } from './components/AdminModal';
import { BadgeGate } from './components/BadgeGate';
import { BatchQueue } from './components/BatchQueue';
import { RecheckOverlay } from './components/RecheckOverlay';
import { SheetCompleteOverlay } from './components/SheetCompleteOverlay';
import { TestLabelsDrawer } from './components/TestLabelsDrawer';
import { TopBar } from './components/TopBar';
import { VerificationPanel } from './components/VerificationPanel';
import { useSettings } from './config/SettingsContext';
import { useSheetPage } from './data/SheetPageContext';
import { cleanPayload } from './domain/normalize';
import { parsePayload } from './domain/payloads';
import type { BatchFamilyGroup } from './domain/batchFamily';
import { findBatchByValue, looksLikeGtin, matchesProductCode } from './domain/resolve';
import { useSession } from './session/SessionContext';
import { useVerification } from './verification/useVerification';

export default function App() {
  const { settings } = useSettings();
  const { activePage, pageBatches } = useSheetPage();
  const session = useSession();
  const verification = useVerification(session.operator, pageBatches, {
    badgeProven: session.signInMethod === 'badge',
    onBadgeProven: session.markBadgeProven,
  });

  const [adminOpen, setAdminOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [testLabelsOpen, setTestLabelsOpen] = useState(false);
  const [gateNotice, setGateNotice] = useState<string | null>(null);
  const [sheetCompleteOpen, setSheetCompleteOpen] = useState(false);
  const prevVerifiedRef = useRef(-1);

  // The batch log follows the checkout session: the member being scanned while
  // the order is open, otherwise the order's parent row.
  const highlightBatchId =
    verification.currentMemberBatch?.id ?? verification.familyCheckout?.parentBatchId ?? null;

  const handleSelectFamily = useCallback(
    (family: BatchFamilyGroup) => {
      verification.startFamilyCheckout(family);
    },
    [verification],
  );

  useEffect(() => {
    const total = pageBatches.length;
    const verified = pageBatches.filter((b) => b.status === 'verified').length;
    if (total > 0 && verified === total && prevVerifiedRef.current < total) {
      setSheetCompleteOpen(true);
    }
    prevVerifiedRef.current = verified;
  }, [pageBatches]);

  useEffect(() => {
    prevVerifiedRef.current = -1;
    setSheetCompleteOpen(false);
    verification.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset scan state when sheet page changes
  }, [activePage.id]);

  // Entering the operator preview must also drop admin chrome that is already
  // open, or the preview is not what an operator would actually see.
  useEffect(() => {
    if (session.viewAsOperator) {
      setActivityOpen(false);
      setAdminOpen(false);
      setTestLabelsOpen(false);
    }
  }, [session.viewAsOperator]);

  const openTestLabels = useCallback(() => {
    setTestLabelsOpen(true);
    setAdminOpen(false);
    setActivityOpen(false);
  }, []);

  const handleCommit = useCallback(
    async ({ text, isScanner }: CaptureCommit) => {
      session.touchSession();
      const parsed = parsePayload(text, settings.badgePattern);

      if (parsed.kind === 'badge') {
        setGateNotice(null);

        // A held order owns the badge: it signs the order off rather than
        // signing the operator out.
        if (verification.awaitingBadge) {
          const outcome = await verification.confirmOrderWithBadge(parsed.badgeId);
          if (outcome !== 'not_waiting') return;
        }

        const result = await session.handleBadge(parsed.badgeId);
        if (result !== 'unknown') return;

        const value = cleanPayload(parsed.raw);
        const isLabelData =
          !!findBatchByValue(value, pageBatches) ||
          matchesProductCode(value, pageBatches) ||
          looksLikeGtin(value);

        if (!isLabelData) {
          session.reportUnknownBadge(parsed.badgeId);
          return;
        }
        if (!session.operator) {
          setGateNotice('Badge in first — then scan labels.');
          if (settings.soundEnabled) playError();
          return;
        }
        await verification.handleScanPayload({ kind: 'raw', raw: parsed.raw, value }, isScanner);
        return;
      }

      if (!session.operator) {
        setGateNotice('Badge in first — then scan labels.');
        if (settings.soundEnabled) playError();
        return;
      }

      await verification.handleScanPayload(parsed, isScanner);
    },
    [settings.badgePattern, settings.soundEnabled, session, verification, pageBatches],
  );

  const capture = useWedgeCapture({
    enabled: !adminOpen && !verification.recheckPrompt && !sheetCompleteOpen,
    burstGapMs: settings.burstGapMs,
    commitPauseMs: settings.commitPauseMs,
    onCommit: handleCommit,
  });

  const toggleActivity = useCallback(() => {
    setActivityOpen((open) => {
      if (!open) setAdminOpen(false);
      return !open;
    });
  }, []);

  const toggleAdmin = useCallback(() => {
    setAdminOpen((open) => {
      if (!open) setActivityOpen(false);
      return !open;
    });
  }, []);

  const profileClass = session.isAdmin ? 'app-profile-admin' : session.operator ? 'app-profile-operator' : '';

  return (
    <div
      className={`app${!session.operator && !adminOpen ? ' app-gated' : ''}${profileClass ? ` ${profileClass}` : ''}`}
    >
      <input
        ref={capture.inputRef}
        onKeyDown={capture.onKeyDown}
        className="wedge-input"
        autoComplete="off"
        aria-label="Scanner capture"
      />

      <TopBar
        onOpenAdmin={toggleAdmin}
        onOpenActivity={toggleActivity}
        activityOpen={activityOpen}
        adminOpen={adminOpen}
      />

      <main className="main main-floor">
        <BatchQueue
          selectedBatchId={highlightBatchId}
          activeFamilyParentId={verification.familyCheckout?.parentBatchId ?? null}
          activeMemberBatchId={verification.currentMemberBatch?.id ?? null}
          orderPhase={verification.familyCheckout?.phase ?? null}
          onSelectFamily={handleSelectFamily}
          onOpenTestLabels={session.isAdmin ? openTestLabels : undefined}
        />
        <aside className="checkout-rail zone-panel" aria-label="Order checkout">
          <VerificationPanel
            embedded
            familyCheckout={verification.familyCheckout}
            parentBatch={verification.parentBatch}
            orderMembers={verification.orderMembers}
            currentMemberBatch={verification.currentMemberBatch}
            state={verification.state}
            need={verification.need}
            mismatches={verification.orderMismatches}
            operatorName={session.operator?.name ?? null}
            typedBuffer={capture.buffer}
            onStartOver={verification.reset}
          />
        </aside>
      </main>

      {!session.operator && !adminOpen && (
        <BadgeGate notice={gateNotice} onOpenAdmin={() => setAdminOpen(true)} />
      )}

      {verification.recheckPrompt && (
        <RecheckOverlay
          prompt={verification.recheckPrompt}
          onConfirm={() => void verification.confirmRecheck()}
          onCancel={verification.dismissRecheck}
        />
      )}

      {sheetCompleteOpen && pageBatches.length > 0 && (
        <SheetCompleteOverlay
          referenceNumber={activePage.referenceNumber}
          batchCount={pageBatches.length}
          onDismiss={() => setSheetCompleteOpen(false)}
        />
      )}

      <ActivityDrawer open={activityOpen && session.isAdmin} onClose={() => setActivityOpen(false)} />
      <TestLabelsDrawer
        open={testLabelsOpen && session.isRealAdmin && !session.viewAsOperator}
        onClose={() => setTestLabelsOpen(false)}
      />
      <AdminModal
        open={adminOpen}
        onClose={() => setAdminOpen(false)}
        onOpenTestLabels={session.isAdmin ? openTestLabels : undefined}
      />
    </div>
  );
}
