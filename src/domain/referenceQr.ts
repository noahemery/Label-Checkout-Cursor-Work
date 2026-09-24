import { PAYLOAD_VERSION, LABEL_FORM_ID, REFERENCE_FORM_ID } from './payloads';

/** Fields needed to build a scannable REF| reference QR payload. */
export interface ReferenceQrFields {
  batchNumber: string;
  itemNumber?: string | null;
  labelCode?: string | null;
  quantity?: number | null;
  dom?: string | null;
  doe?: string | null;
}

/** Fields needed to build a scannable LBL| label QR payload. */
export type LabelQrFields = Pick<ReferenceQrFields, 'batchNumber' | 'itemNumber' | 'labelCode'>;
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
 * Build the printed-label QR string: LBL|1|batch|item|labelCode
 * Returns null when batch or label code is missing.
 */
export function buildLabelQrPayload(fields: LabelQrFields): string | null {
  const batchNumber = fields.batchNumber?.trim();
  const labelCode = fields.labelCode?.trim();
  if (!batchNumber || !labelCode) return null;

  const parts = [
    LABEL_FORM_ID,
    PAYLOAD_VERSION,
    batchNumber,
    fields.itemNumber?.trim() ?? '',
    labelCode,
  ];
  return parts.join('|');
}

/** Deliberately wrong label code for mismatch testing. */
export function buildWrongLabelQrPayload(fields: LabelQrFields): string | null {
  const batchNumber = fields.batchNumber?.trim();
  const labelCode = fields.labelCode?.trim();
  if (!batchNumber || !labelCode) return null;

  const parts = [LABEL_FORM_ID, PAYLOAD_VERSION, batchNumber, fields.itemNumber?.trim() ?? '', 'WRONG'];
  return parts.join('|');
}

/** Derive payload from a stored batch record (or import input). */
export function referenceQrPayloadFromBatch(
  batch: ReferenceQrFields & { referenceQrPayload?: string | null },
): string | null {
  if (batch.referenceQrPayload) return batch.referenceQrPayload;
  return buildReferenceQrPayload(batch);
}
