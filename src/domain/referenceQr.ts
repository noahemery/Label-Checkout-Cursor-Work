import { PAYLOAD_VERSION, REFERENCE_FORM_ID } from './payloads';

export interface ReferenceQrFields {
  batchNumber: string;
  itemNumber?: string | null;
  productName?: string | null;
  labelCode?: string | null;
  quantity?: number | null;
  dom?: string | null;
  doe?: string | null;
}

/** Fields needed to build a scannable printed-label QR payload. */
export type LabelQrFields = Pick<
  ReferenceQrFields,
  'batchNumber' | 'itemNumber' | 'labelCode' | 'productName' | 'doe' | 'dom'
>;

function compactName(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * Build the on-screen reference QR string: REF|1|batch|item|labelCode|qty|DOM|DOE
 * Returns null when batch or label code is missing — QR cannot be generated.
 */
export function buildReferenceQrPayload(fields: ReferenceQrFields): string | null {
  const batchNumber = fields.batchNumber?.trim();
  const labelCode = fields.labelCode?.trim();
  if (!batchNumber || !labelCode) return null;

  const parts = [
    REFERENCE_FORM_ID,
    PAYLOAD_VERSION,
    batchNumber,
    fields.itemNumber?.trim() ?? '',
    labelCode,
    fields.quantity != null ? String(fields.quantity) : '',
    fields.dom?.trim() ?? '',
    fields.doe?.trim() ?? '',
  ];
  return parts.join('|');
}

/**
 * Printed-roll QR: batch|item|product name|label code|date
 * Returns null when batch or label code is missing.
 */
export function buildLabelQrPayload(fields: LabelQrFields): string | null {
  const batchNumber = fields.batchNumber?.trim();
  const labelCode = fields.labelCode?.trim();
  if (!batchNumber || !labelCode) return null;

  const date = fields.doe?.trim() || fields.dom?.trim() || '';
  return [batchNumber, fields.itemNumber?.trim() ?? '', compactName(fields.productName), labelCode, date].join('|');
}

/** Deliberately wrong label code for mismatch testing. */
export function buildWrongLabelQrPayload(fields: LabelQrFields): string | null {
  const batchNumber = fields.batchNumber?.trim();
  const labelCode = fields.labelCode?.trim();
  if (!batchNumber || !labelCode) return null;

  const date = fields.doe?.trim() || fields.dom?.trim() || '';
  return [batchNumber, fields.itemNumber?.trim() ?? '', compactName(fields.productName), 'WRONG', date].join('|');
}

/** Derive payload from a stored batch record (or import input). */
export function referenceQrPayloadFromBatch(
  batch: ReferenceQrFields & { referenceQrPayload?: string | null },
): string | null {
  if (batch.referenceQrPayload) return batch.referenceQrPayload;
  return buildReferenceQrPayload(batch);
}
