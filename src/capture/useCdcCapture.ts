import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useEffect, useRef, useState } from 'react';
import { isTauriRuntime } from '../data/createStore';

/**
 * USB CDC scanner capture.
 *
 * HID keyboard mode types each character. The printed-roll QR is long enough
 * that Windows drops keys, so the station never sees a complete payload. CDC
 * delivers the decode as one serial read. The badge reader is still a wedge —
 * this hook does not replace useWedgeCapture.
 */

export const CDC_SCAN_EVENT = 'cdc-scan';
export const CDC_STATUS_EVENT = 'cdc-status';

export interface ScannerPort {
  name: string;
  label: string;
}

export async function listScannerPorts(): Promise<ScannerPort[]> {
  if (!isTauriRuntime()) return [];
  return invoke<ScannerPort[]>('list_scanner_ports');
}

export async function startScanner(port: string, baud: number): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke('start_scanner', { port, baud });
}

export async function stopScanner(): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke('stop_scanner');
}

interface CdcCaptureOptions {
  enabled: boolean;
  port: string;
  baud: number;
  onScan: (text: string) => void;
}

export function useCdcCapture(options: CdcCaptureOptions): string | null {
  const { enabled, port, baud, onScan } = options;
  const [status, setStatus] = useState<string | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled || !port.trim() || !isTauriRuntime()) {
      setStatus(null);
      return;
    }

    let cancelled = false;
    let unlistenScan: UnlistenFn | undefined;
    let unlistenStatus: UnlistenFn | undefined;

    void (async () => {
      try {
        unlistenScan = await listen<string>(CDC_SCAN_EVENT, (event) => {
          const text = typeof event.payload === 'string' ? event.payload.trim() : '';
          if (text) onScanRef.current(text);
        });
        unlistenStatus = await listen<string>(CDC_STATUS_EVENT, (event) => {
          if (typeof event.payload === 'string') setStatus(event.payload);
        });
        if (cancelled) return;
        await startScanner(port.trim(), baud);
        if (cancelled) await stopScanner();
      } catch (err) {
        if (!cancelled) {
          setStatus(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
      unlistenScan?.();
      unlistenStatus?.();
      void stopScanner();
    };
  }, [enabled, port, baud]);

  return status;
}
