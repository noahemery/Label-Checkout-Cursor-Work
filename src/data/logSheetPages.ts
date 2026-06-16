/**
 * Log sheet pages and the label rows printed on each one.
 * Parent (P) and split (-02, -03…) batches are separate queue entries.
 *
 * Future row QR: FMIB001|1|{batch}|{item}|{labelCode}|{qty}|{DOM}|{DOE}
 */

import { familyBatchNumbers } from '../domain/batchFamily';

export interface SheetLabelRef {
  id: string;
  productName: string;
  itemNumber: string;
  labelCode: string;
  upc: string;
  batchNumber: string;
  quantity: number | null;
  dom: string | null;
  doe: string | null;
  netWeight: string | null;
  entries: string | null;
  qrPayload: string | null;
  imageUrl: string | null;
}

export interface LogSheetPageDef {
  id: string;
  referenceNumber: string;
  title: string;
  wiReference: string | null;
  defaultSheetPhotoUrl: string | null;
  labels: SheetLabelRef[];
}

interface ProductRow {
  id: string;
  baseBatch: string;
  itemNumber: string;
  productName: string;
  labelCode: string;
  quantity: number | null;
  dom: string | null;
  doe: string | null;
  entries: string | null;
}

function row(
  id: string,
  batchNumber: string,
  product: Omit<ProductRow, 'id' | 'baseBatch'>,
  entries: string | null,
): SheetLabelRef {
  return {
    id: `${id}-${batchNumber}`,
    batchNumber,
    itemNumber: product.itemNumber,
    productName: product.productName,
    labelCode: product.labelCode,
    quantity: product.quantity,
    dom: product.dom,
    doe: product.doe,
    entries,
    upc: '',
    netWeight: null,
    qrPayload: null,
    imageUrl: null,
  };
}

/** One product line on the sheet → parent + split batch rows. */
function expandProduct(p: ProductRow): SheetLabelRef[] {
  return familyBatchNumbers(p.baseBatch, p.entries).map((batchNumber) =>
    row(p.id, batchNumber, p, p.entries),
  );
}

const FMLB003_PRODUCTS: ProductRow[] = [
  {
    id: 'integral-m',
    baseBatch: 'BO123456',
    itemNumber: '24.4767.067.022',
    productName: 'INTEGRAL M 25 KG BAG',
    labelCode: 'US0',
    quantity: 5000,
    dom: '1-Jun-26',
    doe: '1/6/2029',
    entries: 'P, 2-3',
  },
  {
    id: 'select-pxp-oa',
    baseBatch: 'BO789101',
    itemNumber: '08.4973.067.022',
    productName: 'SELECT PXP OA 25 KG BAG',
    labelCode: 'US0',
    quantity: 3000,
    dom: '1-Jun-26',
    doe: '1/12/2027',
    entries: 'P, 2',
  },
  {
    id: 'yea-sacc-1026',
    baseBatch: 'BO112131',
    itemNumber: '06.0540.067.095',
    productName: 'YEA-SACC 1026 25 KG POLY BAG TAN',
    labelCode: 'US0',
    quantity: 6000,
    dom: '1-Jun-26',
    doe: '1/12/2027',
    entries: 'P, 2-3',
  },
  {
    id: 'lacto-mos-oa',
    baseBatch: 'BO415161',
    itemNumber: '07.2314.067.022',
    productName: 'LACTO-MOS OA 25 KG BAG',
    labelCode: 'US0',
    quantity: 2000,
    dom: '1-Jun-26',
    doe: '1/12/2027',
    entries: 'P, 2',
  },
  {
    id: 'bio-mos-ws',
    baseBatch: 'BO718192',
    itemNumber: '07.0217.067.022',
    productName: 'BIO-MOS WATER SOLUBLE MR 25KG BAG',
    labelCode: 'US0',
    quantity: 1000,
    dom: '1-Jun-26',
    doe: '12-Jun-26',
    entries: 'P',
  },
  {
    id: 'integral-oa',
    baseBatch: 'BO122232',
    itemNumber: '08.2330.067.022',
    productName: 'INTEGRAL OA 25 KG BAG',
    labelCode: 'US0',
    quantity: 4000,
    dom: '1-Jun-26',
    doe: '1/6/2029',
    entries: 'P, 2',
  },
  {
    id: 'natustat',
    baseBatch: 'BO728293',
    itemNumber: '24.2120.067.011',
    productName: 'NATUSTAT 25.0 KG BAG',
    labelCode: 'TYSFEE',
    quantity: 5000,
    dom: '1-Jun-26',
    doe: '1/6/2027',
    entries: 'P, 2, 3, 4',
  },
  {
    id: 'mycosorb',
    baseBatch: 'BO031323',
    itemNumber: '08.0623.067.078',
    productName: 'MYCOSORB 25 KG SUPER BAG KELLY GREEN',
    labelCode: 'ID0',
    quantity: 9000,
    dom: '1-Jun-26',
    doe: '1/6/2029',
    entries: 'P, 2-4, 5',
  },
];

export const LOG_SHEET_PAGES: LogSheetPageDef[] = [
  {
    id: 'fmlb003-production',
    referenceNumber: 'FMLB003',
    title: 'Form Production Label Printing',
    wiReference: 'WI L.B001',
    defaultSheetPhotoUrl: '/labels/fmlb003-sheet.jpg',
    labels: FMLB003_PRODUCTS.flatMap(expandProduct),
  },
  {
    id: 'fmi-b001-demo',
    referenceNumber: 'FMI B001',
    title: 'Label Log Out',
    wiReference: 'WI B001',
    defaultSheetPhotoUrl: null,
    labels: [
      {
        id: 'good-4-life-pak-cat-without-cobalt',
        productName: 'Good 4 Life Pak - Cat without Cobalt',
        itemNumber: '100194',
        labelCode: '24.4788.067.022.US0.18.V2',
        upc: '00747301042567',
        batchNumber: 'BO622739-04',
        quantity: 240,
        dom: '10/06/26',
        doe: '01/03/27',
        netWeight: '55.1 lbs (25 kg)',
        entries: null,
        qrPayload: '24.4788.067.022.US0.18  V2',
        imageUrl: '/labels/good-4-life-pak-cat-without-cobalt.png',
      },
    ],
  },
];

export function getPageById(id: string): LogSheetPageDef | undefined {
  return LOG_SHEET_PAGES.find((p) => p.id === id);
}

export function catalogLabelCodes(): string[] {
  return LOG_SHEET_PAGES.flatMap((p) => p.labels.map((l) => l.labelCode));
}

export function allCatalogLabels(): SheetLabelRef[] {
  return LOG_SHEET_PAGES.flatMap((p) => p.labels);
}
