import { normalizeId } from './normalize';
import type { Batch } from './types';

/**
 * Resolution of raw scanned/typed values against known batches.
 *
 * Real labels carry several numeric codes that are NOT batch numbers (the
 * product UPC, the item-only QR). These helpers let the router tell badge
 * scans, product codes and batch numbers apart.
 */

const digitsOnly = (value: string): string => value.replace(/\D/g, '');

export function findBatchByValue(value: string, batches: Batch[]): Batch | undefined {
  const norm = normalizeId(value);
  if (!norm) return undefined;
  return batches.find((b) => b.batchNumberNorm === norm);
}

/**
 * GTIN/UPC/EAN payloads are 12-16 digits (with AI prefixes like (02) or
 * check digits attached by the symbology). Batch numbers and badge IDs at
 * this site are shorter, so a long all-digit payload is a product barcode.
 */
export function looksLikeGtin(value: string): boolean {
  const norm = normalizeId(value);
  if (!/^\d+$/.test(norm)) return false;
  const d = digitsOnly(value);
  return d.length >= 12 && d.length <= 16;
}

function validMonthDay(mm: string, dd: string): boolean {
  const m = Number(mm);
  const d = Number(dd);
  return m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

/**
 * The expiration date barcode on the bottom of a label. It is all digits, so
 * without this it matches the badge pattern and reads as an unknown badge.
 * Accepts YYYYMMDD, MMDDYYYY, YYMMDD and GS1 AI 17 (`(17)YYMMDD`), with or
 * without separators.
 */
export function looksLikeDate(value: string): boolean {
  if (!/^[\d\s()./-]+$/.test(value.trim())) return false;
  const d = digitsOnly(value);
  if (d.length === 8) {
    if (/^20\d{2}/.test(d) && validMonthDay(d.slice(4, 6), d.slice(6, 8))) return true;
    if (/20\d{2}$/.test(d) && validMonthDay(d.slice(0, 2), d.slice(2, 4))) return true;
    if (d.startsWith('17') && validMonthDay(d.slice(4, 6), d.slice(6, 8))) return true;
    return false;
  }
  if (d.length === 6) return validMonthDay(d.slice(2, 4), d.slice(4, 6));
  return false;
}

/**
 * True when the value matches a label code on a batch in the current print
 * run. Legacy labels carry a bare label code in the QR (e.g.
 * `24.4788.067.022.US0.18  V2`), so this is how those scans are told apart
 * from batch numbers. Labels re-coded to the `LBL|` form never reach here.
 */
export function matchesKnownLabelCode(value: string, batches: Batch[]): boolean {
  const norm = normalizeId(value);
  if (!norm) return false;
  return batches.some((b) => b.labelCode && normalizeId(b.labelCode) === norm);
}

/**
 * Shape heuristic for label codes: several dot-separated groups
 * (`24.4788.067.022.US0.18.V2`). Batch numbers here never look like this.
 */
export function looksLikeLabelCode(value: string): boolean {
  return (value.match(/\./g)?.length ?? 0) >= 3;
}

/**
 * True when the value matches a known product identifier (item number or
 * UPC) rather than a batch. UPCs are compared by digit containment, since
 * scanners may add AI prefixes / check digits around the stored value.
 */
export function matchesProductCode(value: string, batches: Batch[]): boolean {
  const norm = normalizeId(value);
  const digits = digitsOnly(value);
  return batches.some((b) => {
    if (b.itemNumber && normalizeId(b.itemNumber) === norm) return true;
    if (b.upc && digits) {
      const stored = digitsOnly(b.upc);
      const shorter = Math.min(stored.length, digits.length);
      if (stored && shorter >= 8 && (digits.includes(stored) || stored.includes(digits))) {
        return true;
      }
    }
    return false;
  });
}
