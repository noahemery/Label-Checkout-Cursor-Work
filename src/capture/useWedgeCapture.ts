import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';

/**
 * Global keyboard-wedge capture.
 *
 * Both the Zebra scanner and the RFID badge reader act as USB keyboards that
 * "type" their payload. This hook owns a hidden input that stays focused at
 * all times (refocusing on blur / click / interval) and distinguishes device
 * input from human typing by keystroke burst speed:
 *
 *   - Scanner/reader: gaps between characters < burstGapMs. Commits on Enter,
 *     or automatically after commitPauseMs of silence (some configs omit the
 *     Enter suffix).
 *   - Human typing: no time limit; commits only on Enter. Backspace edits,
 *     Escape clears.
 *
 * Other form fields (admin panel etc.) are respected: capture never steals
 * focus from an INPUT/TEXTAREA/SELECT, and can be disabled entirely.
 */

export interface CaptureCommit {
  text: string;
  isScanner: boolean;
}

interface WedgeCaptureOptions {
  enabled: boolean;
  burstGapMs: number;
  commitPauseMs: number;
  onCommit: (commit: CaptureCommit) => void;
}

interface WedgeCapture {
  inputRef: RefObject<HTMLInputElement | null>;
  /** Current uncommitted buffer — echo this in the UI so hand-typing is visible. */
  buffer: string;
  onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
}

function isTextEntryElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function useWedgeCapture(options: WedgeCaptureOptions): WedgeCapture {
  const { enabled, burstGapMs, commitPauseMs, onCommit } = options;

  const inputRef = useRef<HTMLInputElement>(null);
  const bufferRef = useRef('');
  const timesRef = useRef<number[]>([]);
  const timerRef = useRef<number | null>(null);
  const [buffer, setBuffer] = useState('');

  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const isBurst = useCallback(() => {
    const t = timesRef.current;
    if (t.length < 3) return false;
    for (let i = 1; i < t.length; i++) {
      if (t[i] - t[i - 1] > burstGapMs) return false;
    }
    return true;
  }, [burstGapMs]);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const resetBuffer = useCallback(() => {
    bufferRef.current = '';
    timesRef.current = [];
    clearTimer();
    setBuffer('');
  }, []);

  const commit = useCallback(
    (isScanner: boolean) => {
      const text = bufferRef.current.trim();
      resetBuffer();
      if (text) onCommitRef.current({ text, isScanner });
    },
    [resetBuffer],
  );

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (!enabled) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        commit(isBurst());
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        // Manual edit means this is a human; drop burst history.
        timesRef.current = [];
        clearTimer();
        bufferRef.current = bufferRef.current.slice(0, -1);
        setBuffer(bufferRef.current);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        resetBuffer();
        return;
      }
      if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) return;

      e.preventDefault();
      bufferRef.current += e.key;
      setBuffer(bufferRef.current);
      timesRef.current.push(performance.now());

      clearTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        // Auto-commit only for scanner-speed bursts (handles missing Enter
        // suffix). Human typing waits for Enter with no time limit.
        if (isBurst()) commit(true);
      }, commitPauseMs);
    },
    [enabled, commit, isBurst, resetBuffer, commitPauseMs],
  );

  // Keep the capture input focused whenever capture is enabled.
  useEffect(() => {
    if (!enabled) {
      resetBuffer();
      return;
    }

    const focusCapture = () => {
      if (!isTextEntryElement(document.activeElement) && document.activeElement !== inputRef.current) {
        inputRef.current?.focus({ preventScroll: true });
      }
    };

    inputRef.current?.focus({ preventScroll: true });

    const captureEl = inputRef.current;
    const onBlur = () => {
      // Refocus unless focus moved to a real form field (admin inputs etc.).
      window.setTimeout(focusCapture, 60);
    };
    captureEl?.addEventListener('blur', onBlur);

    const onDocClick = (e: MouseEvent) => {
      if (!isTextEntryElement(e.target as Element)) {
        // Let the click's default behavior finish first (button handlers).
        window.setTimeout(focusCapture, 0);
      }
    };
    const onVisibility = () => focusCapture();
    const interval = window.setInterval(focusCapture, 1000);

    document.addEventListener('click', onDocClick);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onVisibility);

    return () => {
      captureEl?.removeEventListener('blur', onBlur);
      window.clearInterval(interval);
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onVisibility);
    };
  }, [enabled, resetBuffer]);

  return { inputRef, buffer, onKeyDown };
}
