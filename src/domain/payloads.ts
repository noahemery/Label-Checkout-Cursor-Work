import { cleanPayload, normalizeId } from './normalize';

/**
 * Versioned, pipe-delimited payload spec.
 *
 *   Label QR (BarTender, printed on the roll):
 *     LBL|1|{batch}|{item}|{labelCode}
 *   Reference QR (rendered on screen from the D365 import):
 *     REF|1|{batch}|{item}|{labelCode}|{qty}|{DOM}|{DOE}
 *   Legacy paper sheet row QR:
 *     FMIB001|1|{batch}|{item}|{labelCode}|{qty}|{DOM}|{DOE}
 *   Badge:          matched by configurable pattern (default: 5–14 digits)
 *   Anything else:  raw identifier (1D batch barcode, UPC, hand-typed batch)
 *
 * The two live forms play different roles: `REF|` opens an order at the
 * station (once), `LBL|` checks a single label inside an open order. Scanning
 * the wrong form for the current phase is always rejected — see the phase
 * guards in useVerification. `FMIB001|` is legacy and no longer accepted.
 */

export const SHEET_FORM_ID = 'FMIB001';
export const LABEL_FORM_ID = 'LBL';
export const REFERENCE_FORM_ID = 'REF';

/** Version written into new payloads. Bump only with a matching parser change. */
export const PAYLOAD_VERSION = '1';

const SUPPORTED_VERSIONS = new Set([PAYLOAD_VERSION]);

const FORM_IDS = [SHEET_FORM_ID, LABEL_FORM_ID, REFERENCE_FORM_ID] as const;

type FormId = (typeof FORM_IDS)[number];

const FORM_DESCRIPTION: Record<FormId, string> = {
  [SHEET_FORM_ID]: 'log sheet QR',
  [LABEL_FORM_ID]: 'printed label QR',
  [REFERENCE_FORM_ID]: 'on-screen reference QR',
};

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

/** The QR printed on the physical label by BarTender. */
export interface LabelPayload {
  kind: 'label';
  raw: string;
  version: string;
  batchNumber: string;
  itemNumber: string | null;
  labelCode: string | null;
}

/** The QR the app renders on screen from imported D365 data. */
export interface ReferencePayload {
  kind: 'reference';
  raw: string;
  version: string;
  batchNumber: string;
  itemNumber: string | null;
  labelCode: string | null;
  quantity: number | null;
  dom: string | null;
  doe: string | null;
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

/** A recognised form prefix carrying a version this build cannot read. */
export interface UnsupportedPayload {
  kind: 'unsupported';
  raw: string;
  formId: string;
  version: string;
  reason: string;
}

/** Everything the verification handshake can consume (i.e. not a badge). */
export type ScanPayload =
  | SheetPayload
  | LabelPayload
  | ReferencePayload
  | RawPayload
  | UnsupportedPayload;

export type ParsedPayload = ScanPayload | BadgePayload;

export const PAYLOAD_KIND_LABEL: Record<ScanPayload['kind'], string> = {
  label: 'Label QR',
  reference: 'Reference QR',
  sheet: 'Sheet QR',
  raw: 'Raw/typed entry',
  unsupported: 'Unsupported QR',
};

function text(fields: string[], index: number): string | null {
  return fields[index]?.trim() || null;
}

function quantity(fields: string[], index: number): number | null {
  const value = text(fields, index);
  if (value === null) return null;
  const n = Number(value.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function parsePayload(input: string, badgePattern: string): ParsedPayload {
  const cleaned = cleanPayload(input);
  const upper = cleaned.toUpperCase();
  const formId = FORM_IDS.find((id) => upper.startsWith(`${id}|`));

  if (formId) {
    const fields = cleaned.split('|');
    const version = text(fields, 1) ?? PAYLOAD_VERSION;

    if (!SUPPORTED_VERSIONS.has(version)) {
      return {
        kind: 'unsupported',
        raw: input,
        formId,
        version,
        reason: `This ${FORM_DESCRIPTION[formId]} is format version ${version}; this station reads version ${PAYLOAD_VERSION}. Tell a supervisor before checking it out.`,
      };
    }

    const batchNumber = fields[2]?.trim() ?? '';
    const itemNumber = text(fields, 3);
    const labelCode = text(fields, 4);

    if (formId === LABEL_FORM_ID) {
      return { kind: 'label', raw: input, version, batchNumber, itemNumber, labelCode };
    }

    const extras = {
      quantity: quantity(fields, 5),
      dom: text(fields, 6),
      doe: text(fields, 7),
    };

    if (formId === REFERENCE_FORM_ID) {
      return {
        kind: 'reference',
        raw: input,
        version,
        batchNumber,
        itemNumber,
        labelCode,
        ...extras,
      };
    }

    return { kind: 'sheet', raw: input, version, batchNumber, itemNumber, labelCode, ...extras };
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

