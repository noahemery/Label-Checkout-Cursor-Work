import { useCallback, useEffect, useRef, useState } from 'react';
import { playBlip, playError, playSuccess } from '../audio/sounds';
import { useSettings } from '../config/SettingsContext';
import { useAppData } from '../data/AppDataContext';
import { catalogLabelCodes } from '../data/logSheetPages';
import { compareSides, emptySide, sideComplete } from '../domain/matching';
import type { MatchResult, SideData } from '../domain/matching';
import { normalizeId } from '../domain/normalize';
import type { LabelPayload, RawPayload, SheetPayload } from '../domain/payloads';
import {
  looksLikeGtin,
  looksLikeLabelCode,
  matchesKnownLabelCode,
  matchesProductCode,
} from '../domain/resolve';
import type { Batch, Operator } from '../domain/types';

export interface RecheckPrompt {
  batch: Batch;
  payload: SheetPayload | LabelPayload | RawPayload;
  isScanner: boolean;
}

/**
 * The two-scan handshake state machine.
 *
 * Side 1 (label) = the physical printed label.
 * Side 2 (sheet) = the FMI B001 log sheet row.
 *
 * Scanning a batch that is already verified at the start of a new handshake
 * prompts the operator to confirm a re-check (re-open is logged).
 */

export type SlotNeed =
  | { side: 'label' | 'sheet'; need: 'batch' | 'code' }
  | { side: null; need: null };

export interface VerificationState {
  label: SideData;
  sheet: SideData;
  sheetExtra: { quantity: number | null; dom: string | null; doe: string | null } | null;
  result: MatchResult | null;
  verifiedBatchNumber: string | null;
  notice: string | null;
}

function freshState(): VerificationState {
  return {
    label: emptySide(),
    sheet: emptySide(),
    sheetExtra: null,
    result: null,
    verifiedBatchNumber: null,
    notice: null,
  };
}

export function nextNeed(s: VerificationState): SlotNeed {
  if (!s.label.batchNumber) return { side: 'label', need: 'batch' };
  if (!s.label.labelCode) return { side: 'label', need: 'code' };
  if (!s.sheet.batchNumber) return { side: 'sheet', need: 'batch' };
  if (!s.sheet.labelCode) return { side: 'sheet', need: 'code' };
  return { side: null, need: null };
}

interface UseVerificationResult {
  state: VerificationState;
  need: SlotNeed;
  recheckPrompt: RecheckPrompt | null;
  handleScanPayload: (
    payload: SheetPayload | LabelPayload | RawPayload,
    isScanner: boolean,
  ) => Promise<void>;
  confirmRecheck: () => Promise<void>;
  dismissRecheck: () => void;
  reset: () => void;
  flagMismatch: () => Promise<void>;
}

export function useVerification(
  operator: Operator | null,
  pageBatches: Batch[],
): UseVerificationResult {
  const { store, refreshBatches, logAudit } = useAppData();
  const { settings } = useSettings();

  const [state, setState] = useState<VerificationState>(freshState);
  const [recheckPrompt, setRecheckPrompt] = useState<RecheckPrompt | null>(null);
  const stateRef = useRef(state);
  const advanceTimerRef = useRef<number | null>(null);
  const skipRecheckRef = useRef(false);

  const batchesRef = useRef(pageBatches);
  batchesRef.current = pageBatches;
  const operatorRef = useRef(operator);
  operatorRef.current = operator;

  const update = useCallback((next: VerificationState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const clearAdvanceTimer = () => {
    if (advanceTimerRef.current !== null) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
  };

  const reset = useCallback(() => {
    clearAdvanceTimer();
    update(freshState());
  }, [update]);

  useEffect(() => () => clearAdvanceTimer(), []);

  const sound = useCallback(
    (kind: 'success' | 'error' | 'blip') => {
      if (!settings.soundEnabled) return;
      if (kind === 'success') playSuccess();
      else if (kind === 'error') playError();
      else playBlip();
    },
    [settings.soundEnabled],
  );

  const findBatch = (batchNumber: string): Batch | undefined =>
    batchesRef.current.find((b) => b.batchNumberNorm === normalizeId(batchNumber));

  const NOT_ON_SHEET_MSG =
    'This batch is NOT on today\u2019s log sheet — you can\u2019t check it out.';

  const rejectNotOnSheet = async (
    s: VerificationState,
    batchNumber: string,
  ): Promise<VerificationState> => {
    s.notice = NOT_ON_SHEET_MSG;
    sound('error');
    await logAudit({
      type: 'scan',
      operatorId: operatorRef.current?.id ?? null,
      operatorName: operatorRef.current?.name ?? null,
      batchNumber,
      detail: `REJECTED — batch not on today\u2019s log sheet: ${batchNumber}`,
    });
    return s;
  };

  const isNewHandshakeBatchScan = (s: VerificationState): boolean => {
    const need = nextNeed(s);
    return need.side === 'label' && need.need === 'batch';
  };

  const maybePromptRecheck = (
    batch: Batch | undefined,
    s: VerificationState,
    payload: SheetPayload | LabelPayload | RawPayload,
    isScanner: boolean,
  ): boolean => {
    if (!batch || batch.status !== 'verified' || skipRecheckRef.current) return false;
    if (!isNewHandshakeBatchScan(s)) return false;
    setRecheckPrompt({ batch, payload, isScanner });
    sound('blip');
    return true;
  };

  const evaluate = useCallback(
    async (s: VerificationState): Promise<VerificationState> => {
      const batchNumber = s.sheet.batchNumber ?? s.label.batchNumber ?? null;
      const onSheet = batchNumber ? findBatch(batchNumber) : undefined;
      if (!onSheet) {
        return rejectNotOnSheet(s, batchNumber ?? '?');
      }

      const result = compareSides(s.label, s.sheet);
      const next = { ...s, result };

      const op = operatorRef.current;

      if (result.ok && op) {
        await store.verifyRow(onSheet.id, op);
        await refreshBatches();
        await logAudit({
          type: 'verify',
          operatorId: op.id,
          operatorName: op.name,
          batchNumber: onSheet.batchNumber,
          detail: `Two-scan match confirmed. Label code ${s.label.labelCode}.`,
        });
        next.verifiedBatchNumber = onSheet.batchNumber;
        sound('success');
        clearAdvanceTimer();
        advanceTimerRef.current = window.setTimeout(() => {
          advanceTimerRef.current = null;
          update(freshState());
        }, settings.autoAdvanceMs);
      } else if (!result.ok) {
        const differences = result.comparisons
          .filter((c) => !c.ok)
          .map((c) => `${c.field}: label "${c.labelValue}" vs sheet "${c.sheetValue}"`)
          .join('; ');
        await logAudit({
          type: 'mismatch',
          operatorId: op?.id ?? null,
          operatorName: op?.name ?? null,
          batchNumber,
          detail: `MISMATCH — ${differences}`,
        });
        sound('error');
      }
      return next;
    },
    [store, refreshBatches, logAudit, sound, settings.autoAdvanceMs, update],
  );

  const applyPayload = useCallback(
    async (
      payload: SheetPayload | LabelPayload | RawPayload,
      isScanner: boolean,
      s: VerificationState,
    ): Promise<VerificationState> => {
      if (payload.kind === 'sheet') {
        if (!payload.batchNumber) {
          s.notice = 'Sheet code is missing a batch number — re-scan or type the batch.';
          sound('error');
          return s;
        }
        const known = findBatch(payload.batchNumber);
        if (!known) {
          return rejectNotOnSheet(s, payload.batchNumber);
        }
        s.sheet = {
          batchNumber: payload.batchNumber,
          itemNumber: payload.itemNumber,
          labelCode: payload.labelCode,
          knownBatch: true,
        };
        s.sheetExtra = { quantity: payload.quantity, dom: payload.dom, doe: payload.doe };
      } else if (payload.kind === 'label') {
        if (!payload.batchNumber) {
          s.notice = 'Label code is missing a batch number — scan the batch barcode instead.';
          sound('error');
          return s;
        }
        const known = findBatch(payload.batchNumber);
        if (!known) {
          return rejectNotOnSheet(s, payload.batchNumber);
        }
        if (maybePromptRecheck(known, s, payload, isScanner)) return s;
        s.label = {
          batchNumber: payload.batchNumber,
          itemNumber: payload.itemNumber,
          labelCode: payload.labelCode,
          knownBatch: true,
        };
      } else {
        const target = nextNeed(s);
        if (!target.side) return s;

        const side = target.side === 'label' ? { ...s.label } : { ...s.sheet };
        const isLabelCode =
          matchesKnownLabelCode(payload.value, batchesRef.current, catalogLabelCodes()) ||
          looksLikeLabelCode(payload.value);

        if (target.need === 'code') {
          if (side.batchNumber && normalizeId(payload.value) === normalizeId(side.batchNumber)) {
            s.notice =
              'That\u2019s the batch number again — now scan the QR code on the label (the label code), or type it.';
            sound('error');
            return s;
          }
          side.labelCode = payload.value;
        } else if (isLabelCode && !findBatch(payload.value)) {
          side.labelCode = payload.value;
        } else {
          const batch = findBatch(payload.value);
          if (
            target.side === 'label' &&
            maybePromptRecheck(batch, s, payload, isScanner)
          ) {
            return s;
          }
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
            return rejectNotOnSheet(s, payload.value);
          }
          side.batchNumber = batch.batchNumber;
          side.knownBatch = true;
          if (!side.itemNumber) side.itemNumber = batch.itemNumber;
        }

        if (target.side === 'label') s.label = side;
        else s.sheet = side;
      }

      await logAudit({
        type: 'scan',
        operatorId: operatorRef.current?.id ?? null,
        operatorName: operatorRef.current?.name ?? null,
        batchNumber: s.label.batchNumber ?? s.sheet.batchNumber,
        detail: `${payload.kind === 'raw' ? 'Raw/typed entry' : payload.kind === 'sheet' ? 'Sheet QR' : 'Label QR'}: ${payload.raw.slice(0, 120)}`,
      });

      if (sideComplete(s.label) && sideComplete(s.sheet)) {
        return evaluate(s);
      }
      sound('blip');
      return s;
    },
    [logAudit, evaluate, sound],
  );

  const handleScanPayload = useCallback(
    async (payload: SheetPayload | LabelPayload | RawPayload, isScanner: boolean) => {
      if (recheckPrompt) return;

      let s: VerificationState = { ...stateRef.current, notice: null };

      if (s.result) {
        clearAdvanceTimer();
        s = freshState();
      }

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
    clearAdvanceTimer();
    update(freshState());
    skipRecheckRef.current = true;
    update(await applyPayload(prompt.payload, prompt.isScanner, freshState()));
    skipRecheckRef.current = false;
  }, [recheckPrompt, store, refreshBatches, logAudit, applyPayload, update]);

  const dismissRecheck = useCallback(() => setRecheckPrompt(null), []);

  const flagMismatch = useCallback(async () => {
    const s = stateRef.current;
    if (!s.result || s.result.ok) return;
    const batchNumber = s.sheet.batchNumber ?? s.label.batchNumber ?? '';
    const batch = findBatch(batchNumber);
    if (!batch) {
      update(await rejectNotOnSheet(s, batchNumber));
      return;
    }
    await store.flagRow(batch.id);
    await refreshBatches();
    const differences = s.result.comparisons
      .filter((c) => !c.ok)
      .map((c) => `${c.field}: label "${c.labelValue}" vs sheet "${c.sheetValue}"`)
      .join('; ');
    await logAudit({
      type: 'flag',
      operatorId: operatorRef.current?.id ?? null,
      operatorName: operatorRef.current?.name ?? null,
      batchNumber: batch.batchNumber,
      detail: `Flagged for supervisor — ${differences}`,
    });
    reset();
  }, [store, refreshBatches, logAudit, reset, update]);

  return {
    state,
    need: nextNeed(state),
    recheckPrompt,
    handleScanPayload,
    confirmRecheck,
    dismissRecheck,
    reset,
    flagMismatch,
  };
}
