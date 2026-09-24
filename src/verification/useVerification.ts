import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { playBlip, playError, playSuccess } from '../audio/sounds';
import { useSettings } from '../config/SettingsContext';
import { useAppData } from '../data/AppDataContext';
import type { BatchFamilyGroup } from '../domain/batchFamily';
import {
  batchIsCheckable,
  compareFamily,
  memberPairFromLabelScan,
  mismatchedPairs,
  type FamilyCheckoutState,
  type FamilyMemberPair,
} from '../domain/familyCheckout';
import { emptySide, sideComplete } from '../domain/matching';
import type { MatchResult, SideData } from '../domain/matching';
import { normalizeId } from '../domain/normalize';
import type { ScanPayload } from '../domain/payloads';
import { PAYLOAD_KIND_LABEL } from '../domain/payloads';
import {
  looksLikeGtin,
  looksLikeLabelCode,
  matchesKnownLabelCode,
  matchesProductCode,
} from '../domain/resolve';
import type { Batch, Operator } from '../domain/types';

export interface RecheckPrompt {
  batch: Batch;
  payload: ScanPayload;
  isScanner: boolean;
}

/** What a finished order is waiting for a badge to do. */
export type OrderBadgeNeed = 'confirm' | null;

export type OrderBadgeResult =
  | 'confirmed'
  | 'unknown'
  | 'wrong_operator'
  | 'not_waiting';

/**
 * Order checkout state machine.
 *
 * 1. Operator clicks an order in the batch log — it opens immediately
 *    (`scanning`) on its first member.
 * 2. Each member is checked by its printed `LBL|` QR alone, compared against
 *    the D365 record for that member. A mismatch is recorded and the order
 *    still advances, so the operator can get the rest of the run out.
 * 3. When every member has been scanned the order holds at `complete`.
 * 4. The signed-in operator's badge resolves it: matched members are written
 *    verified, mismatched members are written flagged for a supervisor.
 *
 * Scanning labels never writes batch status — only `confirmOrderWithBadge`
 * does. See the core control section in AGENTS.md.
 */

export type SlotNeed = { side: 'label'; need: 'batch' | 'code' } | { side: null; need: null };

export interface VerificationState {
  label: SideData;
  result: MatchResult | null;
  verifiedBatchNumber: string | null;
  notice: string | null;
}

function freshState(): VerificationState {
  return {
    label: emptySide(),
    result: null,
    verifiedBatchNumber: null,
    notice: null,
  };
}

export function nextNeed(s: VerificationState): SlotNeed {
  if (!s.label.batchNumber) return { side: 'label', need: 'batch' };
  if (!s.label.labelCode) return { side: 'label', need: 'code' };
  return { side: null, need: null };
}

const NOT_IN_RUN_MSG = 'This batch is NOT in today\u2019s print run — you can\u2019t check it out.';

/**
 * How far back a badge tap reaches when corroborating who was at the station.
 *
 * A session started by picking a profile off the list names someone without
 * proving it. When that same profile badges out an order a minute or two
 * later, the badge is real evidence that the person named on the earlier
 * events was in fact standing there. Anything older than this is a different
 * stretch of the shift and gets no such benefit of the doubt.
 */
const ATTRIBUTION_WINDOW_MS = 2 * 60 * 1000;

/** Marks a mismatch whose operator was named by a profile pick, not a badge. */
const UNPROVEN_SUFFIX = ' [profile sign-in — identity not badge-proven]';

function wrongMemberMessage(fam: FamilyCheckoutState, expected: Batch): string {
  const n = fam.memberBatchIds.length;
  const i = fam.currentMemberIndex + 1;
  return `This order expects ${expected.batchNumber} (label ${i} of ${n}). Scan that label, not a different run.`;
}

interface UseVerificationResult {
  state: VerificationState;
  need: SlotNeed;
  familyCheckout: FamilyCheckoutState | null;
  /** Parent of the active order. */
  parentBatch: Batch | null;
  /** All members of the active order, in run order. */
  orderMembers: Batch[];
  /** Member awaiting its printed label scan (only while scanning). */
  currentMemberBatch: Batch | null;
  /** Members of the finished order that did not match. */
  orderMismatches: FamilyMemberPair[];
  /** Non-null when a finished order needs a badge tap to resolve. */
  awaitingBadge: OrderBadgeNeed;
  confirmOrderWithBadge: (badgeId: string) => Promise<OrderBadgeResult>;
  recheckPrompt: RecheckPrompt | null;
  handleScanPayload: (payload: ScanPayload, isScanner: boolean) => Promise<void>;
  confirmRecheck: () => Promise<void>;
  dismissRecheck: () => void;
  startFamilyCheckout: (family: BatchFamilyGroup) => void;
  reset: () => void;
}

export interface VerificationSessionHooks {
  /** True when the signed-in operator badged in rather than picking a profile. */
  badgeProven: boolean;
  /** Called when a badge tap proves a session that began as a profile pick. */
  onBadgeProven?: () => void;
}

export function useVerification(
  operator: Operator | null,
  pageBatches: Batch[],
  session: VerificationSessionHooks,
): UseVerificationResult {
  const { store, refreshBatches, logAudit } = useAppData();
  const { settings } = useSettings();

  const [state, setState] = useState<VerificationState>(freshState);
  const [familyCheckout, setFamilyCheckout] = useState<FamilyCheckoutState | null>(null);
  const [recheckPrompt, setRecheckPrompt] = useState<RecheckPrompt | null>(null);
  const stateRef = useRef(state);
  const skipRecheckRef = useRef(false);

  const batchesRef = useRef(pageBatches);
  batchesRef.current = pageBatches;
  const operatorRef = useRef(operator);
  operatorRef.current = operator;
  const familyRef = useRef(familyCheckout);
  familyRef.current = familyCheckout;
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const update = useCallback((next: VerificationState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const reset = useCallback(() => {
    setFamilyCheckout(null);
    setRecheckPrompt(null);
    update(freshState());
  }, [update]);

  const sound = useCallback(
    (kind: 'success' | 'error' | 'blip') => {
      if (!settings.soundEnabled) return;
      if (kind === 'success') playSuccess();
      else if (kind === 'error') playError();
      else playBlip();
    },
    [settings.soundEnabled],
  );

  const findBatch = useCallback(
    (batchNumber: string): Batch | undefined =>
      batchesRef.current.find((b) => b.batchNumberNorm === normalizeId(batchNumber)),
    [],
  );

  const findBatchById = useCallback(
    (id: string): Batch | undefined => batchesRef.current.find((b) => b.id === id),
    [],
  );

  const parentBatch = useMemo(
    () =>
      familyCheckout
        ? (pageBatches.find((b) => b.id === familyCheckout.parentBatchId) ?? null)
        : null,
    [familyCheckout, pageBatches],
  );

  const orderMembers = useMemo(() => {
    if (!familyCheckout) return [];
    return familyCheckout.memberBatchIds
      .map((id) => pageBatches.find((b) => b.id === id))
      .filter((b): b is Batch => !!b);
  }, [familyCheckout, pageBatches]);

  const currentMemberBatch = useMemo(() => {
    if (!familyCheckout || familyCheckout.phase !== 'scanning') return null;
    const id = familyCheckout.memberBatchIds[familyCheckout.currentMemberIndex];
    return pageBatches.find((b) => b.id === id) ?? null;
  }, [familyCheckout, pageBatches]);

  const orderMismatches = useMemo(
    () => (familyCheckout ? mismatchedPairs(familyCheckout.completedPairs) : []),
    [familyCheckout],
  );

  const rejectScan = useCallback(
    async (
      s: VerificationState,
      message: string,
      batchNumber: string | null,
      detail: string,
    ): Promise<VerificationState> => {
      s.notice = message;
      sound('error');
      await logAudit({
        type: 'scan',
        operatorId: operatorRef.current?.id ?? null,
        operatorName: operatorRef.current?.name ?? null,
        batchNumber,
        detail,
      });
      return s;
    },
    [logAudit, sound],
  );

  const rejectNotInRun = useCallback(
    (s: VerificationState, batchNumber: string) =>
      rejectScan(
        s,
        NOT_IN_RUN_MSG,
        batchNumber,
        `REJECTED — batch not in today\u2019s print run: ${batchNumber}`,
      ),
    [rejectScan],
  );

  const expectedMemberBatch = useCallback(
    (fam: FamilyCheckoutState): Batch | undefined =>
      findBatchById(fam.memberBatchIds[fam.currentMemberIndex]),
    [findBatchById],
  );

  const maybePromptRecheck = useCallback(
    (batch: Batch | undefined, payload: ScanPayload, isScanner: boolean): boolean => {
      if (!batch || batch.status !== 'verified' || skipRecheckRef.current) return false;
      setRecheckPrompt({ batch, payload, isScanner });
      sound('blip');
      return true;
    },
    [sound],
  );

  /**
   * Record the member just scanned and move on.
   *
   * A mismatch is logged immediately — it is real information even if the
   * order is later abandoned — but it does not end the order. The operator
   * keeps going so the rest of the run's labels can still be checked out.
   */
  const finishFamilyMember = useCallback(
    async (
      fam: FamilyCheckoutState,
      pair: FamilyMemberPair,
    ): Promise<VerificationState> => {
      const op = operatorRef.current;

      if (!pair.result.ok) {
        const differences = pair.result.comparisons
          .filter((c) => !c.ok)
          .map((c) => `${c.field}: label "${c.labelValue}" vs expected "${c.sheetValue}"`)
          .join('; ');
        await logAudit({
          type: 'mismatch',
          operatorId: op?.id ?? null,
          operatorName: op?.name ?? null,
          batchNumber: pair.batchNumber,
          detail:
            `ORDER MISMATCH at ${pair.batchNumber} — ${differences}` +
            (sessionRef.current.badgeProven ? '' : UNPROVEN_SUFFIX),
        });
        sound('error');
      }

      const completedPairs = [...fam.completedPairs, pair];
      const nextIndex = fam.currentMemberIndex + 1;

      if (nextIndex >= fam.memberBatchIds.length) {
        const bad = mismatchedPairs(completedPairs);
        await logAudit({
          type: 'scan',
          operatorId: op?.id ?? null,
          operatorName: op?.name ?? null,
          batchNumber: fam.parentBatchNumber,
          detail:
            bad.length === 0
              ? `Order scanned clean — ${completedPairs.length} label${completedPairs.length === 1 ? '' : 's'} matched (awaiting badge confirm)`
              : `Order scanned with ${bad.length} mismatch${bad.length === 1 ? '' : 'es'} of ${completedPairs.length} (awaiting badge confirm)`,
        });
        if (bad.length === 0) sound('success');
        setFamilyCheckout({
          ...fam,
          phase: 'complete',
          completedPairs,
          currentMemberIndex: nextIndex,
          lastRecordedBatchNumber: pair.batchNumber,
        });
        return {
          ...freshState(),
          result: compareFamily(completedPairs),
          verifiedBatchNumber: fam.parentBatchNumber,
        };
      }

      if (pair.result.ok) sound('blip');
      setFamilyCheckout({
        ...fam,
        completedPairs,
        currentMemberIndex: nextIndex,
        lastRecordedBatchNumber: pair.batchNumber,
      });
      return freshState();
    },
    [logAudit, sound],
  );

  /** The scanned label is complete — check it against the expected member. */
  const evaluateMember = useCallback(
    async (s: VerificationState): Promise<VerificationState> => {
      const fam = familyRef.current;
      if (!fam || fam.phase !== 'scanning') return s;

      const expected = expectedMemberBatch(fam);
      if (!expected) {
        return rejectScan(
          s,
          'This order is out of sync with the batch log — press Start over.',
          s.label.batchNumber,
          `REJECTED — expected member index ${fam.currentMemberIndex} missing from the page`,
        );
      }

      if (normalizeId(s.label.batchNumber ?? '') !== expected.batchNumberNorm) {
        return rejectScan(
          s,
          wrongMemberMessage(fam, expected),
          s.label.batchNumber,
          `REJECTED — wrong order member: expected ${expected.batchNumber}, got ${s.label.batchNumber}`,
        );
      }

      if (!batchIsCheckable(expected)) {
        return rejectScan(
          s,
          `${expected.batchNumber} has no label code in the import — an admin must fix it before this order can be checked out.`,
          expected.batchNumber,
          `REJECTED — member ${expected.batchNumber} has no label code in the D365 import`,
        );
      }

      return finishFamilyMember(fam, memberPairFromLabelScan(expected, s.label));
    },
    [finishFamilyMember, rejectScan, expectedMemberBatch],
  );

  const applyPayload = useCallback(
    async (
      payload: ScanPayload,
      isScanner: boolean,
      s: VerificationState,
    ): Promise<VerificationState> => {
      const fam = familyRef.current;

      if (!fam) {
        s.notice = 'Click an order in the batch log to start a checkout.';
        sound('error');
        return s;
      }
      if (fam.phase === 'complete') {
        s.notice = 'Order finished — badge to check it out, or press Start over.';
        sound('error');
        return s;
      }

      if (payload.kind === 'unsupported') {
        return rejectScan(
          s,
          payload.reason,
          null,
          `REJECTED — ${payload.formId} payload version ${payload.version} not supported: ${payload.raw.slice(0, 120)}`,
        );
      }

      if (payload.kind === 'sheet') {
        return rejectScan(
          s,
          'That\u2019s the old paper log sheet QR. Pick the order on screen, then scan the printed labels.',
          payload.batchNumber || null,
          `REJECTED — legacy sheet QR is not accepted: ${payload.raw.slice(0, 120)}`,
        );
      }

      if (payload.kind === 'reference') {
        return rejectScan(
          s,
          'That\u2019s a reference QR, not a printed label. Scan the QR on the label roll.',
          payload.batchNumber || null,
          `REJECTED — reference QR scanned during order ${fam.parentBatchNumber}`,
        );
      }

      if (payload.kind === 'label') {
        if (sideComplete(s.label)) {
          return rejectScan(
            s,
            'That label is already recorded — press Start over to redo this order.',
            s.label.batchNumber,
            `REJECTED — printed label QR re-scanned before the order advanced: ${payload.raw.slice(0, 120)}`,
          );
        }
        if (!payload.batchNumber) {
          s.notice = 'That label QR has no batch number — type the batch number instead.';
          sound('error');
          return s;
        }
        const known = findBatch(payload.batchNumber);
        if (!known) return rejectNotInRun(s, payload.batchNumber);
        if (maybePromptRecheck(known, payload, isScanner)) return s;
        s.label = {
          batchNumber: payload.batchNumber,
          itemNumber: payload.itemNumber,
          labelCode: payload.labelCode,
          knownBatch: true,
        };
      } else {
        // Typed or 1D fallback when a label QR will not read.
        const target = nextNeed(s);
        if (!target.side) return s;

        const side = { ...s.label };
        const isLabelCode =
          matchesKnownLabelCode(payload.value, batchesRef.current) ||
          looksLikeLabelCode(payload.value);

        if (target.need === 'code') {
          if (side.batchNumber && normalizeId(payload.value) === normalizeId(side.batchNumber)) {
            s.notice =
              'That\u2019s the batch number again — now scan or type the label code from the printed label.';
            sound('error');
            return s;
          }
          side.labelCode = payload.value;
        } else if (isLabelCode && !findBatch(payload.value)) {
          side.labelCode = payload.value;
        } else {
          const batch = findBatch(payload.value);
          if (!batch) {
            if (
              matchesProductCode(payload.value, batchesRef.current) ||
              looksLikeGtin(payload.value)
            ) {
              s.notice =
                'That code identifies the PRODUCT, not the batch. Scan the BATCH NUMBER barcode (bottom of the label) or type the batch number.';
              sound('error');
              return s;
            }
            return rejectNotInRun(s, payload.value);
          }
          if (maybePromptRecheck(batch, payload, isScanner)) return s;
          side.batchNumber = batch.batchNumber;
          side.knownBatch = true;
        }

        s.label = side;
      }

      await logAudit({
        type: 'scan',
        operatorId: operatorRef.current?.id ?? null,
        operatorName: operatorRef.current?.name ?? null,
        batchNumber: s.label.batchNumber,
        detail: `${PAYLOAD_KIND_LABEL[payload.kind]}: ${payload.raw.slice(0, 120)}`,
      });

      if (sideComplete(s.label)) return evaluateMember(s);

      sound('blip');
      return s;
    },
    [
      logAudit,
      evaluateMember,
      sound,
      rejectScan,
      rejectNotInRun,
      maybePromptRecheck,
      findBatch,
    ],
  );

  /**
   * Clicking an order opens it. The operator has declared which order they are
   * standing in front of by picking it; the machine still checks every label.
   */
  const startFamilyCheckout = useCallback(
    (family: BatchFamilyGroup) => {
      setRecheckPrompt(null);
      const op = operatorRef.current;
      const memberCount = family.members.length;
      setFamilyCheckout({
        phase: 'scanning',
        parentBatchId: family.parent.id,
        parentBatchNumber: family.parent.batchNumber,
        memberBatchIds: family.members.map((m) => m.id),
        currentMemberIndex: 0,
        completedPairs: [],
        lastRecordedBatchNumber: null,
      });
      update(freshState());
      void logAudit({
        type: 'order_open',
        operatorId: op?.id ?? null,
        operatorName: op?.name ?? null,
        batchNumber: family.parent.batchNumber,
        detail: `Order opened at station — ${memberCount} label${memberCount === 1 ? '' : 's'} to check`,
      });
    },
    [update, logAudit],
  );

  const handleScanPayload = useCallback(
    async (payload: ScanPayload, isScanner: boolean) => {
      if (recheckPrompt) return;
      const s: VerificationState = { ...stateRef.current, notice: null };
      update(await applyPayload(payload, isScanner, s));
    },
    [recheckPrompt, applyPayload, update],
  );

  const confirmRecheck = useCallback(async () => {
    const prompt = recheckPrompt;
    if (!prompt) return;
    const op = operatorRef.current;
    await store.reopenRow(prompt.batch.id);
    await refreshBatches();
    await logAudit({
      type: 'reopen',
      operatorId: op?.id ?? null,
      operatorName: op?.name ?? null,
      batchNumber: prompt.batch.batchNumber,
      detail: `Check back in started (was verified by ${prompt.batch.verifiedByName ?? '?'} at ${prompt.batch.verifiedAt ?? '?'})`,
    });
    setRecheckPrompt(null);
    skipRecheckRef.current = true;
    update(await applyPayload(prompt.payload, prompt.isScanner, freshState()));
    skipRecheckRef.current = false;
  }, [recheckPrompt, store, refreshBatches, logAudit, applyPayload, update]);

  const dismissRecheck = useCallback(() => setRecheckPrompt(null), []);

  const awaitingBadge: OrderBadgeNeed = familyCheckout?.phase === 'complete' ? 'confirm' : null;

  /**
   * Tie recent unproven mismatches to the badge that just tapped.
   *
   * Nothing is rewritten — audit rows are append-only by design. This adds a
   * dated note saying the same profile checked an order out with a real badge
   * shortly afterwards, which is what makes "they just didn't badge in" a
   * defensible reading of the earlier mismatch rather than a guess.
   */
  const corroborateRecentEvents = useCallback(
    async (confirmer: Operator, parentBatchNumber: string) => {
      const cutoff = Date.now() - ATTRIBUTION_WINDOW_MS;
      const recent = await store.getAuditEvents(200);
      const orphaned = recent.filter(
        (e) =>
          e.type === 'mismatch' &&
          e.operatorId === confirmer.id &&
          e.detail.includes(UNPROVEN_SUFFIX) &&
          Date.parse(e.ts) >= cutoff,
      );
      if (orphaned.length === 0) return;

      const batches = [...new Set(orphaned.map((e) => e.batchNumber ?? '?'))].join(', ');
      await logAudit({
        type: 'badge_attribution',
        operatorId: confirmer.id,
        operatorName: confirmer.name,
        batchNumber: parentBatchNumber,
        detail:
          `${confirmer.name} badged out order ${parentBatchNumber} within ` +
          `${Math.round(ATTRIBUTION_WINDOW_MS / 60000)} minutes of ${orphaned.length} ` +
          `unproven mismatch${orphaned.length === 1 ? '' : 'es'} (${batches}) logged under the ` +
          `same profile — same person at the station, badge confirmed here.`,
      });
    },
    [store, logAudit],
  );

  /**
   * The badge tap that checks out a finished order.
   *
   * The badge must belong to whoever is signed in: the person who did the
   * scanning is the person who signs for it. Tapping also proves a session
   * that was started by picking a profile off the list, which is what
   * `onBadgeProven` records.
   *
   * Matched members are written verified. Mismatched members are written
   * flagged so a supervisor sees them, and are never counted as checked out.
   * This is the only place batch status is written.
   */
  const confirmOrderWithBadge = useCallback(
    async (badgeId: string): Promise<OrderBadgeResult> => {
      const fam = familyRef.current;
      if (!fam || fam.phase !== 'complete') return 'not_waiting';

      const confirmer = await store.getOperatorByBadge(badgeId);
      if (!confirmer) {
        update(
          await rejectScan(
            { ...stateRef.current },
            'That badge is not enrolled — it cannot check out this order. A supervisor must enroll it first.',
            fam.parentBatchNumber,
            `REJECTED — unenrolled badge tried to check out order ${fam.parentBatchNumber}`,
          ),
        );
        return 'unknown';
      }

      const sessionOp = operatorRef.current;
      if (sessionOp && confirmer.id !== sessionOp.id) {
        update(
          await rejectScan(
            { ...stateRef.current },
            `This station is signed in as ${sessionOp.name}. ${confirmer.name} cannot check out their order — ${sessionOp.name} must badge, or sign out and start over.`,
            fam.parentBatchNumber,
            `REJECTED — ${confirmer.name} tried to check out order ${fam.parentBatchNumber} while signed in as ${sessionOp.name}`,
          ),
        );
        return 'wrong_operator';
      }

      // The badge just proved who is at the station, even if the session began
      // as a profile pick — and that evidence reaches backwards a little way.
      const wasProven = sessionRef.current.badgeProven;
      sessionRef.current.onBadgeProven?.();
      if (!wasProven) await corroborateRecentEvents(confirmer, fam.parentBatchNumber);

      const good = fam.completedPairs.filter((p) => p.result.ok);
      const bad = mismatchedPairs(fam.completedPairs);

      for (const pair of good) {
        await store.verifyRow(pair.batchId, confirmer);
        await logAudit({
          type: 'verify',
          operatorId: confirmer.id,
          operatorName: confirmer.name,
          batchNumber: pair.batchNumber,
          detail: `Checked out with order ${fam.parentBatchNumber} — label code ${pair.label.labelCode}`,
        });
      }

      for (const pair of bad) {
        await store.flagRow(pair.batchId);
        const differences = pair.result.comparisons
          .filter((c) => !c.ok)
          .map((c) => `${c.field}: label "${c.labelValue}" vs expected "${c.sheetValue}"`)
          .join('; ');
        await logAudit({
          type: 'flag',
          operatorId: confirmer.id,
          operatorName: confirmer.name,
          batchNumber: pair.batchNumber,
          detail: `Flagged for supervisor at checkout of order ${fam.parentBatchNumber} — ${differences}`,
        });
      }

      await refreshBatches();
      sound(bad.length === 0 ? 'success' : 'blip');
      setFamilyCheckout(null);
      update({
        ...freshState(),
        notice:
          bad.length === 0
            ? `Order ${fam.parentBatchNumber} checked out by ${confirmer.name} — ${good.length} label${good.length === 1 ? '' : 's'} verified.`
            : `Order ${fam.parentBatchNumber} closed by ${confirmer.name} — ${good.length} verified, ${bad.length} flagged for a supervisor.`,
      });
      return 'confirmed';
    },
    [store, refreshBatches, logAudit, sound, update, rejectScan, corroborateRecentEvents],
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  return {
    state,
    need: nextNeed(state),
    familyCheckout,
    parentBatch,
    orderMembers,
    currentMemberBatch,
    orderMismatches,
    awaitingBadge,
    confirmOrderWithBadge,
    recheckPrompt,
    handleScanPayload,
    confirmRecheck,
    dismissRecheck,
    startFamilyCheckout,
    reset,
  };
}
