import { cleanPayload, normalizeId } from './normalize';

/**
 * Versioned, pipe-delimited payload spec.
 *
 *   Sheet row QR:   FMIB001|1|{batch}|{item}|{labelCode}|{qty}|{DOM}|{DOE}
 *   Label QR:       LBL|1|{batch}|{item}|{labelCode}
 *   Badge:          matched by configurable pattern (default: 5–14 digits)
 *   Anything else:  raw identifier (1D batch barcode, UPC, hand-typed batch)
 */

export interface SheetPayload {
  kind: 'sheet';
  raw: string;
  version: string;
  batchNumber: string;
  itemNumber: string | null;
  labelCode: string | null;
  quantity: number | null;
  dom: string | null;
  doe: string | null;
}

export interface LabelPayload {
  kind: 'label';
  raw: string;
  version: string;
  batchNumber: string;
  itemNumber: string | null;
  labelCode: string | null;
}

export interface BadgePayload {
  kind: 'badge';
  raw: string;
  badgeId: string;
}

export interface RawPayload {
  kind: 'raw';
  raw: string;
  value: string;
}

export type ParsedPayload = SheetPayload | LabelPayload | BadgePayload | RawPayload;

export const SHEET_FORM_ID = 'FMIB001';
export const LABEL_FORM_ID = 'LBL';

export function parsePayload(input: string, badgePattern: string): ParsedPayload {
  const cleaned = cleanPayload(input);
  const upper = cleaned.toUpperCase();

  if (upper.startsWith(`${SHEET_FORM_ID}|`)) {
    const f = cleaned.split('|');
    return {
      kind: 'sheet',
      raw: input,
      version: f[1]?.trim() || '1',
      batchNumber: f[2]?.trim() ?? '',
      itemNumber: f[3]?.trim() || null,
      labelCode: f[4]?.trim() || null,
      quantity: f[5] && !Number.isNaN(Number(f[5])) ? Number(f[5]) : null,
      dom: f[6]?.trim() || null,
      doe: f[7]?.trim() || null,
    };
  }

  if (upper.startsWith(`${LABEL_FORM_ID}|`)) {
    const f = cleaned.split('|');
    return {
      kind: 'label',
      raw: input,
      version: f[1]?.trim() || '1',
      batchNumber: f[2]?.trim() ?? '',
      itemNumber: f[3]?.trim() || null,
      labelCode: f[4]?.trim() || null,
    };
  }

  let badgeRe: RegExp | null = null;
  try {
    badgeRe = new RegExp(badgePattern);
  } catch {
    badgeRe = null;
  }
  if (badgeRe && badgeRe.test(cleaned)) {
    return { kind: 'badge', raw: input, badgeId: normalizeId(cleaned) };
  }

  return { kind: 'raw', raw: input, value: cleaned };
}
