/**
 * Identifier normalization. All matching is done on the alphanumeric-only
 * uppercase form, so `US0.18.V2` matches `US0.18  V2` and `us018v2`.
 */
export function normalizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

/**
 * Strip an AIM symbology identifier prefix if the scanner is configured to
 * send one (e.g. `]Q1` for QR, `]C0` for Code 128, `]E0` for UPC).
 */
export function stripAimPrefix(raw: string): string {
  return raw.replace(/^\][A-Za-z][0-9]/, '');
}

/** Clean a raw wedge payload: trim whitespace and drop the AIM prefix. */
export function cleanPayload(raw: string): string {
  return stripAimPrefix(raw.trim()).trim();
}
