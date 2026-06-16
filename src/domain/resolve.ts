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

/**
 * True when the value matches a known label code (from the batch queue or
 * the sheet-label catalog). Today's label QR scans as the label code
 * (e.g. `24.4788.067.022.US0.18  V2`), so this is how QR scans are told
 * apart from batch numbers.
 */
export function matchesKnownLabelCode(
  value: string,
  batches: Batch[],
  extraCodes: string[] = [],
): boolean {
  const norm = normalizeId(value);
  if (!norm) return false;
  return (
    batches.some((b) => b.labelCode && normalizeId(b.labelCode) === norm) ||
    extraCodes.some((c) => normalizeId(c) === norm)
  );
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
