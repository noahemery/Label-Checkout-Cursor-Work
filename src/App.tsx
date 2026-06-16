import { useCallback, useEffect, useRef, useState } from 'react';
import { playError } from './audio/sounds';
import { useWedgeCapture } from './capture/useWedgeCapture';
import type { CaptureCommit } from './capture/useWedgeCapture';
import { ActivityDrawer } from './components/ActivityDrawer';
import { AdminModal } from './components/AdminModal';
import { BadgeGate } from './components/BadgeGate';
import { BatchQueue } from './components/BatchQueue';
import { MismatchOverlay } from './components/MismatchOverlay';
import { RecheckOverlay } from './components/RecheckOverlay';
import { SheetCompleteOverlay } from './components/SheetCompleteOverlay';
import { TopBar } from './components/TopBar';
import { VerificationPanel } from './components/VerificationPanel';
import { useSettings } from './config/SettingsContext';
import { useSheetPage } from './data/SheetPageContext';
import { cleanPayload } from './domain/normalize';
import { parsePayload } from './domain/payloads';
import { findBatchByValue, looksLikeGtin, matchesProductCode } from './domain/resolve';
import { useSession } from './session/SessionContext';
import { useVerification } from './verification/useVerification';

export default function App() {
  const { settings } = useSettings();
  const { activePage, pageBatches } = useSheetPage();
  const session = useSession();
  const verification = useVerification(session.operator, pageBatches);

  const [adminOpen, setAdminOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [gateNotice, setGateNotice] = useState<string | null>(null);
  const [sheetCompleteOpen, setSheetCompleteOpen] = useState(false);
  const prevVerifiedRef = useRef(-1);

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

  const handleCommit = useCallback(
    async ({ text, isScanner }: CaptureCommit) => {
      const parsed = parsePayload(text, settings.badgePattern);

      if (parsed.kind === 'badge') {
        setGateNotice(null);
        const result = await session.handleBadge(parsed.badgeId);
        if (result !== 'unknown') return;

        // Not an enrolled badge. Numeric codes on real labels (product UPC,
        // item-only QR, all-digit batch numbers) can look badge-shaped, so
        // re-route to verification when the value resolves to something we
        // know — only a true stranger is reported as an unknown badge.
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

  // Global wedge capture is suspended while Admin is open so its form
  // fields (badge enrollment, batch entry) receive keystrokes directly.
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

  const mismatch = verification.state.result && !verification.state.result.ok;

  return (
    <div className={`app${!session.operator && !adminOpen ? ' app-gated' : ''}`}>
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

      <main className="main">
        <VerificationPanel
          state={verification.state}
          need={verification.need}
          typedBuffer={capture.buffer}
          onStartOver={verification.reset}
        />
        <BatchQueue />
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

      {mismatch && verification.state.result && (
        <MismatchOverlay
          result={verification.state.result}
          onRescan={verification.reset}
          onFlag={() => void verification.flagMismatch()}
        />
      )}

      {sheetCompleteOpen && pageBatches.length > 0 && (
        <SheetCompleteOverlay
          referenceNumber={activePage.referenceNumber}
          batchCount={pageBatches.length}
          onDismiss={() => setSheetCompleteOpen(false)}
        />
      )}

      <ActivityDrawer open={activityOpen} onClose={() => setActivityOpen(false)} />
      <AdminModal open={adminOpen} onClose={() => setAdminOpen(false)} />
    </div>
  );
}
