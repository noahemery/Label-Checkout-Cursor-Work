/**
 * Single print-run session — batches come from D365 CSV import only.
 */

export interface LogSheetPageDef {
  id: string;
  referenceNumber: string;
  title: string;
  wiReference: string | null;
}

export const PRINT_RUN_PAGE_ID = 'print-run';

/** Demo / legacy sheet page ids — cleared on DB migration v7. */
export const LEGACY_SHEET_PAGE_IDS = ['fmlb003-production', 'fmi-b001-demo'] as const;

export const PRINT_RUN_PAGE: LogSheetPageDef = {
  id: PRINT_RUN_PAGE_ID,
  referenceNumber: 'Print run',
  title: "Today's orders",
  wiReference: null,
};
