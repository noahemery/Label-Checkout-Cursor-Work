# Label Verification System

A machine double-check and digital audit trail for the FMI B001 "Label Log Out"
paper process. The paper binder stays — this app supplements it with a
two-scan handshake per batch:

1. **Scan 1 — printed label** from the roll.
2. **Scan 2 — log sheet row** (QR on the FMI B001 sheet, or hand-typed batch).
3. **Match → verified**, stamped with timestamp + operator. Mismatch → loud
   red screen explaining exactly what differed.

## Running it

Double-click **`Start Label Verification.bat`** — it starts the local server
(if it isn't already running) and opens the app in your browser. The server
does not survive a reboot, so run it again each morning; a minimized window
named "Label Verification Server" keeps the app alive.

Or from a terminal:

```bash
npm install
npm run dev
```

No backend, no hardware drivers — the Zebra scanner and the RFID badge reader
are both USB keyboard wedges and just "type" into the app.

### Demo / no hardware connected

- **Sign in:** the badge gate has a discreet "No reader? Sign in manually"
  link that lists enrolled operators — sign-ins are audited as badge-less.
  (Typing a badge number + Enter also works anywhere.)
- **Scans:** type any payload + Enter to simulate a scan, e.g. the batch
  number `B0622739-04`, or a full sheet QR
  `FMIB001|1|B0622739-04|100194|24.4788.067.022.US0.18.V2|240|10/06/26|01/03/27`.

## Daily flow

1. **Badge in.** Tap your RFID badge anywhere on the app. Tap again to sign
   out. Unknown badges get an enroll prompt (Admin → Operators).
2. **Load the day's batches.** Admin → Batches → CSV import (or add manually).
   Scanning a sheet QR for an unknown batch also auto-adds it.
3. **Trigger–trigger–green.** Scan the printed label, scan the sheet row,
   watch for green. The app auto-advances to the next batch.

### Strict matching rule

A verdict requires **batch number AND label code from both physical
artifacts**. Nothing is auto-filled from the database. If a scan only
provides a batch (raw 1D barcode, hand-typed entry), the slot asks for the
label code as a follow-up scan or typed entry. Identifiers are compared
alphanumeric-only, so `US0.18.V2` matches `US0.18  V2`.

### Hand-typing fallback

Typing works everywhere a scan works: type the batch number (or label code
when asked) and press Enter. No time limit. Backspace edits, Escape clears.
The batch number is the only hand-typed key — never a full item code.

## Payload spec (versioned, pipe-delimited)

| Source | Format |
| --- | --- |
| Sheet row QR | `FMIB001\|1\|{batch}\|{item}\|{labelCode}\|{qty}\|{DOM}\|{DOE}` |
| Future label QR | `LBL\|1\|{batch}\|{item}\|{labelCode}` |
| Raw 1D / hand-typed | resolved against known batches by normalized batch number |
| Badge | matched by configurable regex (default `^\d{6,10}$`) |

Product-only codes are detected and rejected with guidance: the item-code QR,
and the UPC barcode (12-16 digit GTIN payloads, or a match against a batch's
stored UPC). Badge-shaped numeric payloads that resolve to a known batch,
item or UPC are routed to verification instead of being treated as an
unknown badge.

Example sheet QR:
`FMIB001|1|B0622739-04|100194|24.4788.067.022.US0.18.V2|240|10/06/26|01/03/27`

AIM symbology prefixes (`]Q1`, `]C0`, `]E0`...) are stripped automatically.
Today's item-only label QR is detected and rejected with guidance to scan the
batch barcode instead — it cannot distinguish batches of the same product.

## Keyboard-wedge capture

A hidden input stays focused at all times (refocus on blur/click/interval).
Scanner input is detected by keystroke burst speed (default: gaps < 40 ms)
and auto-commits after a short pause even without an Enter suffix. Human
typing has no time limit and commits on Enter. Both thresholds and the badge
pattern are tunable in **Admin → Settings**.

## Architecture

```
src/
  domain/        types, normalization, payload parsing, match rules (pure)
  capture/       useWedgeCapture — global keyboard-wedge capture hook
  verification/  useVerification — the two-scan handshake state machine
  data/          DataStore interface, IndexedDbStore, CSV import, context
  session/       operator badge session
  config/        settings (localStorage) + context
  audio/         WebAudio success/error/blip tones
  components/    screens: slots, verdict, mismatch overlay, queue, admin...
```

### Data layer — built for the Azure swap

All persistence goes through the `DataStore` interface
(`src/data/DataStore.ts`): `getBatches`, `addBatch`, `importBatches`,
`verifyRow`, `reopenRow`, `flagRow`, `getOperatorByBadge`, `enrollOperator`,
`saveScanEvent`, `getAuditEvents`...

Today it's implemented by `IndexedDbStore` (local, offline-capable). When
Azure SQL / Dataverse is ready, implement the same interface against the API
and swap one line in `AppDataContext`. The schema is deliberately flat:

```sql
CREATE TABLE batches (
  id              UNIQUEIDENTIFIER PRIMARY KEY,
  batch_number    NVARCHAR(50) NOT NULL,
  batch_number_norm NVARCHAR(50) NOT NULL,  -- alphanumeric-only, uppercase
  item_number     NVARCHAR(50) NULL,
  product_name    NVARCHAR(200) NULL,
  label_code      NVARCHAR(100) NULL,
  upc             NVARCHAR(20) NULL,
  quantity        INT NULL,
  dom             NVARCHAR(20) NULL,
  doe             NVARCHAR(20) NULL,
  status          NVARCHAR(10) NOT NULL,    -- pending | verified | flagged
  verified_at     DATETIME2 NULL,
  verified_by_id  UNIQUEIDENTIFIER NULL,
  verified_by_name NVARCHAR(100) NULL,
  created_at      DATETIME2 NOT NULL,
  source          NVARCHAR(12) NOT NULL     -- manual | csv | sheet-scan | auto-verify
);

CREATE TABLE operators (
  id            UNIQUEIDENTIFIER PRIMARY KEY,
  badge_id_norm NVARCHAR(50) NOT NULL UNIQUE,
  name          NVARCHAR(100) NOT NULL,
  created_at    DATETIME2 NOT NULL
);

CREATE TABLE audit_events (
  id            UNIQUEIDENTIFIER PRIMARY KEY,
  ts            DATETIME2 NOT NULL,
  type          NVARCHAR(20) NOT NULL,
  operator_id   UNIQUEIDENTIFIER NULL,
  operator_name NVARCHAR(100) NULL,
  batch_number  NVARCHAR(50) NULL,
  detail        NVARCHAR(500) NOT NULL
);
```

## Audit trail

Every scan, verification, mismatch, flag, re-open, sign-in/out, enrollment,
batch add/delete and CSV import is appended to the audit log (Activity button,
top right). Verified rows can be re-opened from the queue, but the re-open is
itself an audit event — history is never silently erased.

## CSV import

Headers are matched loosely (case/punctuation-insensitive). Recognized
columns: batch (required — also `lot`), item, product/description, label code,
UPC (`gtin`, `barcode`), qty, DOM (`mfg date`...), DOE (`exp date`,
`expiry`...). Duplicate batch numbers are skipped. Including the UPC column
lets the app recognize a scanned product barcode and steer the operator to
the batch barcode instead.

## Hardware notes

- **Zebra scanner:** any keyboard-wedge config works. Enter suffix optional.
  AIM ID prefixes are tolerated.
- **RFID badge reader:** a keyboard-wedge HID reader such as the RFIdeas
  WAVE ID Plus (pcProx Plus, RDR-80581AKU) reads both 125 kHz prox and
  13.56 MHz cards — it will read the existing door badges. Adjust the badge
  regex in Admin → Settings to match what it emits.

## Roadmap (out of scope for now)

- Phase 2: D365 live integration; Azure-backed `DataStore` adapter + Entra ID.
- Phase 3: BarTender automation printing the sheet-row QR (`FMIB001|1|...`)
  on FMI B001 at print time.
