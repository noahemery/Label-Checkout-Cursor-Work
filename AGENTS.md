# AGENTS.md

Project rules for AI coding agents. Cursor reads this file natively; Claude Code loads it via
the `@AGENTS.md` import in `CLAUDE.md`. Keep the content here so both tools stay in sync.

**Label Verification System** — a machine double-check and digital audit trail supplementing the
FMI B001 / FMLB003 paper "Label Log Out" process on the production floor. React 19 + Vite +
TypeScript, no backend. The RFID badge reader is a USB keyboard wedge. The Zebra
scanner can be HID keyboard (legacy, drops keys on long printed QRs) or USB CDC
(COM port — the floor setting). The floor station is a Tauri desktop app with SQLite;
`npm run dev` in a browser is for development only and uses IndexedDB.

## Commands

```
npm run desktop       # Tauri window + SQLite — this is how the station runs
npm run desktop:build # NSIS installer under src-tauri/target/release/bundle
npm run dev           # Vite in a browser (IndexedDB) — development without the desktop shell
npm run build         # tsc -b && vite build
npm run lint          # eslint . — 0 errors required
npm test              # Vitest, once (npm run test:watch while working)

cargo test --manifest-path src-tauri/Cargo.toml --lib   # the Rust commands
```

### The gates

All four must pass locally before you push, and CI runs the same four on every push and PR:
`npm run lint`, `npm test`, `npm run build`, and the cargo tests.

- **Vitest** covers the pure domain rules in `src/domain/*.test.ts`: prefix label-code matching,
  `compareSides`, `memberPairFromLabelScan` refusing to fill a missing label code, payload
  parsing (printed roll, legacy `LBL|`, stray `REF|`, unsupported versions, badges), the
  expiration-date and GTIN heuristics, split runs, and the no-QR audit suffix. Tests sit next to
  the file they cover. **Any change to a rule in `src/domain` comes with a test.**
- **It does not cover** the `useVerification` hook (run order, the badge sign-off, the single
  writer), React components, the stores, or anything that needs the Tauri runtime. Those are
  still verified by running the app — see **Testing without printed labels**.
- **Cargo tests** cover [drop_folder.rs](src-tauri/src/drop_folder.rs),
  [data_location.rs](src-tauri/src/data_location.rs) and [scanner.rs](src-tauri/src/scanner.rs)
  against real files in a temp directory.
- **Lint has 0 errors and 27 known warnings.** Three rule families that arrived with
  `eslint-plugin-react-hooks` v7 after the code was written are set to `warn` in
  [eslint.config.js](eslint.config.js) so lint can gate CI on everything else:
  `react-hooks/refs` (12), `react-hooks/set-state-in-effect` (10),
  `react-refresh/only-export-components` (5 — context files export hooks beside providers).
  None is a behavior defect. A new warning in those families is still worth avoiding; the
  `refs` ones in `useVerification.ts` sit on the core control, so do not "fix" them casually.
  `src-tauri/target` is ignored — it is Rust build output.

## Git workflow

**Short-lived branches, one change each, into `main` by pull request.**

- `main` is protected on GitHub: no direct pushes, a PR is required, the `build-and-test` CI
  check must pass on a branch that is up to date with `main`, history is linear, and `main`
  cannot be force-pushed or deleted. The repo only allows **squash merges** and deletes the
  branch after merge, so each PR lands as one commit.
- Start every change from an up-to-date `main`: `git switch main && git pull`, then
  `git switch -c <type>/<short-name>`. Types: `feat/`, `fix/`, `chore/` (tooling, deps),
  `docs/`, `ci/`. One concern per branch — do not fold an unrelated fix into it.
- Commit at working stopping points with a message that says what changed for the operator or
  supervisor. Push the branch and open a PR into `main`; it fills in
  [the PR template](.github/pull_request_template.md). The PR title becomes the commit on `main`.
- A PR that changes behavior on the floor is tried on a station (`npm run desktop`, or the
  installed build) before it merges, and the PR says what was tried.
- **Releases are cut from `main` only.** Bump `version` in
  [tauri.conf.json](src-tauri/tauri.conf.json) and `Cargo.toml` in a PR, merge it, then tag the
  merge commit: `git switch main && git pull && git tag vX.Y.Z && git push origin vX.Y.Z`.
  [release.yml](.github/workflows/release.yml) refuses a tag that does not equal the version,
  and builds the NSIS installer into a **draft** GitHub Release for a person to publish.
- The long-lived `work` branch is retired once PR #1 merges. Do not recreate it.
- **The GitHub repo is public.** `Test_Data/` (real D365 exports and FMLB forms), `LVS Vault/`
  (internal notes) and `Hardware/` (vendor manuals) are in `.gitignore` and stay out of git.
  Do not force-add them, and check `git status` for anything else internal before pushing.

## The core control — do not break this

**Nothing is written to a batch until a badge that matches the signed-in operator taps at the
end of the order.** The operator attests to the *order context* by picking it off the batch log;
the machine checks *label identity* on every member; the badge signs for the whole thing.

The state machine lives in [useVerification.ts](src/verification/useVerification.ts) with the
phases in [familyCheckout.ts](src/domain/familyCheckout.ts):

- `scanning` — the operator clicked an order, so it is open on its first member. Each member is
  checked by its printed label QR alone, compared against the D365 record via `dbSideFromBatch`.
  A member that does not match is **recorded and the order advances anyway** — the rest of the
  run's labels still need to get out the door.
- `complete` — every member has been scanned. The order holds here until a badge taps.
  `confirmOrderWithBadge` writes matched members with `store.verifyRow` (one `verify` event each)
  and mismatched members with `store.flagRow` (one `flag` event each), then clears the order.

The badge **must belong to whoever is signed in**. A different enrolled badge is rejected by
name, because the person who did the scanning is the person who signs for it.

### Why there is no on-screen unlock QR

There used to be a `REF|` QR rendered on the checkout panel that had to be scanned to open an
order. It was built by the store directly from the imported row, so scanning it compared the
database against itself with extra steps, and picking the order off the list already states
which order the operator is standing in front of. The QR was removed; the parser still
recognizes `REF|` only so a stray one gets a specific rejection instead of a shrug.

What must not regress:

- **Never merge the expected side into the scanned side.** `dbSideFromBatch`
  ([familyCheckout.ts](src/domain/familyCheckout.ts)) is named for its origin. The label side is
  only ever filled from a scan or a typed entry. Copying `labelCode` across would make every
  order pass unconditionally.
- **Never accept a label whose batch number is not the member the order currently expects.**
  Members are checked in run order, not in whatever order they come off the roll.
- **Never commit batch status from the scanning path.** `confirmOrderWithBadge` is the only
  writer, and the only caller of `store.verifyRow` / `store.flagRow` for checkout.

[familyCheckout.test.ts](src/domain/familyCheckout.test.ts) and
[matching.test.ts](src/domain/matching.test.ts) pin the first rule at the domain level. The run
order and single-writer rules live in the `useVerification` hook, which has no test — a
regression there is only caught by running the app. If a refactor appears to need any of them
changed, stop and ask.

### Labels without a QR

A rare label is printed with no QR. Its bottom still carries UPC, batch number and expiration
date as 1D barcodes; the label code is printed text only. It uses the same scanning path, not a
separate mode: scan the **batch number barcode**, then **type the label code** and press Enter.
The comparison, run order and badge sign-off are unchanged.

- `VerificationState.labelEntry` records how each half arrived (`qr` / `barcode` / `typed`),
 and it rides onto `FamilyMemberPair.entry`. `keyedEntrySuffix`
 ([familyCheckout.ts](src/domain/familyCheckout.ts)) appends `[no QR — batch by barcode, label
 code typed]` to that member's `mismatch`, `verify` and `flag` audit details. The operator's own
 badge signs for it, same as a QR label.
- While an order is scanning, the expected label code of every not-yet-recorded member is
 withheld from both the order steps panel and the batch log (`unrecordedMemberIds`). Otherwise a
 typed code could be copied off the monitor and the check would compare D365 with itself. Do not
 put it back on screen.
- `looksLikeDate` ([resolve.ts](src/domain/resolve.ts)) catches the expiration date barcode. It is
 all digits, so it would otherwise match `badgePattern` and read as an unknown badge. The UPC is
 already rejected as a product code.

### Label code matching is prefix-based

The D365 `Label` column holds a short code — `US0`, `CA0`, `JP0`, `GT0`, `SA6`, `PET`, `PURINA`,
`999`. The printed label carries that code plus a year and version suffix (`US0.18 V2`). So
`labelCodeMatches` ([matching.ts](src/domain/matching.ts)) passes when the **scanned code starts
with the D365 code**, not when the two are equal. Batch number and item number still compare for
equality. If a product line ever prints a code that is not a superstring of its D365 code, that
is when the exception list goes in — there is none today.

Corollary: `normalizeId` ([normalize.ts:5-7](src/domain/normalize.ts#L5-L7)) strips all
non-alphanumerics and uppercases, so `US0.18.V2` ≡ `US0.18  V2` ≡ `us018v2`. Matching is lenient
about punctuation, exact about character sequence.  All batch lookups index `batchNumberNorm`.

### Mismatch attribution when nobody badged in

A session can start two ways: a badge tap at the gate, or picking a profile off the dropdown.
`signInMethod` ([SessionContext.tsx](src/session/SessionContext.tsx)) records which. A mismatch
logged during a profile-only session gets `[profile sign-in — identity not badge-proven]`
appended to its audit detail. When that same profile later badges out an order within
`ATTRIBUTION_WINDOW_MS` (2 minutes), a `badge_attribution` event is written naming the earlier
mismatches — evidence that the person named on them really was at the station. Audit rows are
append-only, so this adds a note rather than rewriting history.

## Known gaps — documented, not a fix list

- **Neither `tsconfig.app.json` nor `tsconfig.node.json` sets `"strict"`.** `strictNullChecks`
  and `noImplicitAny` are off, so the `string | null` unions throughout `src/domain/types.ts`
  are unenforced. This deviates from the Vite react-ts template default. Write new code as if
  strict were on.
- Automated tests reach only the pure domain functions and the Rust commands (see **The
  gates**). The verification hook, the stores and every component are untested — behavior
  changes there must be verified by running the app.
- An unknown badge tap writes **no audit event** — `handleBadge`
  ([SessionContext.tsx:184-201](src/session/SessionContext.tsx#L184-L201)) returns `'unknown'`
  and nothing is logged. A real gap for a compliance tool.
- [csv.ts](src/data/csv.ts) is a legacy barrel over [csvMapping.ts](src/data/csvMapping.ts).
  The D365 panel is the only CSV import UI. A saved column layout goes straight to preview;
  mapping is the fallback when that layout does not fit the file.
  Admin no longer has a separate file picker.
- **[AdminModal.tsx](src/components/AdminModal.tsx) is not gated on `isAdmin`.** Anyone can open
  it from the badge gate while signed out via "Enroll badge (supervisor)" or "Open Admin to
  enroll", reaching batch deletion, enrollment, role promotion and settings. Left open
  deliberately during development — first-run needs some way to enroll the first admin. Intended
  end state is requiring a badge for everyone, with a bootstrap exception only when zero users
  are enrolled.
- Vite is pinned to `127.0.0.1:5173` (`strictPort`) so the Tauri `devUrl` and
  `Start Label Verification.bat` stay aligned. If 5173 is taken, the desktop app
  fails to start rather than silently using another port.
- `autoAdvanceMs` is still editable under Admin → Settings but **no longer does anything**. It
  timed the auto-advance after a single-batch verify; an open order advances between members
  immediately and holds at `complete` until a badge taps or the operator cancels.
- `confirmOrderWithBadge` ([useVerification.ts](src/verification/useVerification.ts)) is the
  **only** caller of `store.verifyRow`. Labels scanned during an order write nothing; the badge
  tap commits every member at once. Any new verify path must go through there.
- Batches still carry a `referenceQrPayload` column, now written but never read. It is left in
  place rather than migrated out; nothing renders a `REF|` QR anymore.

## Multi-CSV print run and mixed queue

All batches live on one page id (`print-run` in [logSheetPages.ts](src/data/logSheetPages.ts)).
Each D365 import creates an **import session** (`ImportSession`, SQLite schema v2 /
IndexedDB v11) and stamps every row added that import with `batch.importId`.

- **Additive import:** `importBatches` skips duplicate batch numbers already on the page — the
  first sheet keeps the row; re-importing a corrected CSV does not update existing rows.
- **Active sheets:** each session has an `active` flag. Unchecking a file in the D365 panel
  hides its rows from the live log. The batches, checkouts and audit trail stay in the
  database. Rechecking the file puts them back.
- **Remove a sheet:** **Remove** on that same list deletes the import session and every batch
  it added. Checkouts for those labels go with them. The audit trail is append-only and stays.
  Forgetting the session is what lets the same filename be imported again.
- **Mixed queue:** pending, verified, and flagged labels from every *active* import share one
  batch log.
- **Sheet column:** shows the source CSV filename (truncated; full name in tooltip).
- **Delivery column:** D365 Delivery field, visible to operators; default sort is soonest
  delivery first (`lvs-queue-sort` in localStorage; alternate: sort by sheet / import time).
- Flagged families always sort to the top regardless of the user's sort mode.

## Where the database lives

The desktop database is `C:\ProgramData\LabelVerification\label-verification.db`, **one file
for every Windows account on the machine**. The AIO runs under a shared Label Room login, and
a trial run under someone else's login must carry straight over, so the data cannot live in a
per-account profile.

- [data_location.rs](src-tauri/src/data_location.rs) `shared_data_dir` creates the folder,
  proves this account can write to it, and reports the path. `SqliteStore.open()` loads it by
  absolute path (`tauri-plugin-sql` joins with `PathBuf::push`, so an absolute path replaces
  the app config dir). There is no `preload` in `tauri.conf.json` — that would create an empty
  per-account file.
- ProgramData lets other accounts read a file but not write it by default.
  [windows/hooks.nsh](src-tauri/windows/hooks.nsh) grants the local Users group modify rights
  at install. There is **no uninstall hook on purpose**: uninstalling must never take the audit
  trail with it.
- If the folder is not writable, startup **fails with the folder named**. Do not add a fallback
  to a per-account database — that silently splits the history in two.
- **One-time migration.** Up to 0.4.3 the file lived in each account's
  `%APPDATA%\com.alltech.labelverification`. If the shared file does not exist yet and this
  account has the old one, it is copied with `VACUUM INTO` to `label-verification.db.migrating`
  and only then renamed into place by `promote_migrated_db`, which refuses to replace an
  existing database. A copy that dies part way is deleted on the next launch and never looks
  like real data. The old file is left untouched, and `lvs-db-migrated-from` records where the
  data came from (shown under Admin → Settings). Whichever account launches 0.4.4 first seeds
  the shared file; every later account joins it.

## Getting data off a single station

There is no server yet. Everything a station knows lives in its own SQLite file, so the two
things that have to leave the machine — the audit trail and the badge roster — each have a file
that carries them. Both are designed to retire when a server lands: the roster becomes an API
call, and the backup becomes the server's problem.

### Daily backup — `VACUUM INTO`

[backup.ts](src/data/backup.ts) writes one dated snapshot per day to a folder set under
Admin → Settings (`lvs-backup-folder`; empty means off). `SqliteStore.snapshotTo` issues
`VACUUM INTO $1` and nothing else.

`VACUUM INTO` is the only correct way to copy a live WAL database. Copying the `.db` file while
the app is running gets you a torn read, because recent commits are still in the `-wal` sidecar.
`VACUUM INTO` writes a complete, already-checkpointed database (journal mode `delete`, no
sidecar files) without locking out scanning. Recovery is copying the file back over
`label-verification.db` — no import step.

Three behaviours the code leans on, all verified against real SQLite:

- **A bound parameter works** — `VACUUM INTO $1` accepts the path as a parameter.
- **The output is self-contained** — one file, restorable by itself.
- **It refuses to overwrite an existing target**, raising `output file already exists`. That is
  what makes a daily backup idempotent: the snapshot is attempted on *every* launch and quietly
  does nothing the second time, with no date comparison anywhere. `looksLikeTargetExists` is
  what separates that expected refusal from a real failure, so **do not "fix" it by deleting the
  target first** — that would turn a safe no-op into an overwrite of the day's good backup.

The backup runs from an effect in [AppDataContext.tsx](src/data/AppDataContext.tsx) and never
blocks startup or shows an error on the floor. Every outcome is recorded to
`lvs-backup-last-status` instead, which Admin → Settings renders — in red when it starts with
"Backup failed". `lvs-backup-last-run` separately holds the last time a file was actually
written, so a backup that has been broken for a week is visible as a stale date rather than
hidden behind last week's success.

`snapshotTo` is **optional on `DataStore`** and only `SqliteStore` implements it. A browser has
no filesystem to write to, so the IndexedDB store leaves it undefined and the folder input is
disabled unless `storeKind === 'sqlite'`.

### Roster transfer

[roster.ts](src/data/roster.ts) exports enrolled operators to
`label-verification-roster-YYYY-MM-DD.json` and imports them through `store.upsertOperators`,
matching on `badgeIdNorm`. This exists so a second station does not mean re-scanning every
badge by hand.

It is deliberately **one-directional — export from the station that owns the roster, import
everywhere else.** There is no merge, because there is no correct answer when both sides edited
the same person. Do not add one; add the server instead.

On import, a badge already present **keeps the importing station's operator `id`**, because its
own audit rows already point at that id and rewriting it would orphan them. The file's `id` is
only used when the badge is new, so that audit trails from several stations line up on one
person when they are eventually aggregated.

`parseRosterFile` rejects anything that is not clearly a roster — wrong `kind`, a `version`
newer than this build, no operators list, or no usable entries. A mis-picked file has to fail
loudly rather than import zero operators and look like it worked.

## Getting the D365 export onto the station

The AIO account has no SharePoint license, and the app does not talk to SharePoint. The PC
that runs D365 copies a finished CSV into a folder that lives on the station. The station
polls that local folder and imports a finished file on its own. The folder path is set under
Admin → Settings (`lvs-drop-folder`; empty turns it off and import goes back to the file picker).

Delivery is the window [scripts/d365-inbox/LabelStation.ps1](scripts/d365-inbox/LabelStation.ps1)
on the D365 PC (launch it with `Start Label Station.bat`). It copies through
[Send-D365Export.ps1](scripts/d365-inbox/Send-D365Export.ps1) to the share `\\<aio>\LabelInbox`.
The station watches the same directory locally (`C:\LabelVerification\Inbox`). The copy writes
`*.csv.partial` and renames to `*.csv` only after the byte count matches, and it stamps a
unique name so a repeat save of `print-run.csv` is still a new file. The station writes
`station-status.json` back into that folder so the window can list sheets. Hide, show, and
remove arrive as `hide-<id>.request`, `show-<id>.request`, and `remove-<id>.request`.
Setup and the share ACL are in [scripts/d365-inbox/DESIGN.md](scripts/d365-inbox/DESIGN.md).

**The inbox imports by itself. The file picker does not.** Someone on the D365 PC chose the
file by clicking Send, so the station does not ask again. A file dropped straight into the
folder is treated the same way. Choosing a file in the D365 panel still opens the preview,
because that path has no separate person confirming it. A file that adds zero new batch
numbers does not leave an empty sheet — the session is deleted and the handled ledger
(`lvs-inbox-handled`) stops the next poll from trying it again. A file whose columns do not
match the saved layout is left in the folder and reported in `station-status.json`. Column
mapping is not part of the inbox path.

`mappingForHeaders` uses the saved layout whenever its batch column is still in the file, so
the usual D365 export previews the same way every time. Mapping opens only when the batch
column cannot be found, or when someone presses **Edit column mapping** because the preview
looks wrong. Confirming an import saves that layout.

### Why narrow Rust commands and not the `fs` plugin

The frontend has no filesystem access at all. Every file it touches goes through a named command
registered in [lib.rs](src-tauri/src/lib.rs) that does exactly one thing:

- [drop_folder.rs](src-tauri/src/drop_folder.rs): `list_drop_folder`, `read_drop_file`,
  `write_inbox_status` (only `station-status.json`), `list_inbox_requests` and
  `delete_inbox_request` (only `hide|show|remove-<uuid>.request` names), `station_host_name`.
- [data_location.rs](src-tauri/src/data_location.rs): `shared_data_dir`, `promote_migrated_db`
  (fixed paths, no arguments).
- [scanner.rs](src-tauri/src/scanner.rs): `list_scanner_ports`, `start_scanner`, `stop_scanner`.

The `fs` plugin wants its allowed paths declared in a capability file at build time, but the
folder here is typed in by a supervisor at runtime — which would mean granting a broad static
scope. Narrow commands are less machinery and a smaller hole. Anything that takes a name takes
folder and name **separately** and rejects a separator, `..`, or `:`, so the frontend cannot
ask for a path outside the configured folder. Keep new commands to that shape.

### Label scanner CDC

HID keyboard mode types one character at a time. The printed-roll QR is long enough that
Windows drops keys, so the station never sees a complete payload. USB CDC sends the decode
over a COM port instead.

Admin → Settings → **Scanner connection** → USB serial (CDC), then pick the COM port Windows
assigned. [scanner.rs](src-tauri/src/scanner.rs) lists ports, opens only the one named, and
emits `cdc-scan`. The name must look like `COM4` — same idea as `read_drop_file` refusing a
path. The badge reader stays a keyboard wedge. `npm run dev` in a browser has no COM ports.

Use **USB CDC Host**, not SSI-over-CDC. SSI is a binary protocol this reader does not speak.

### The two Windows failure modes this is built around

- **OneDrive Files On-Demand placeholders.** The filename is on disk while the contents are not.
  Reading one blocks on a download that fails outright when the station is offline. The Rust
  side checks the `OFFLINE` / `RECALL_ON_OPEN` / `RECALL_ON_DATA_ACCESS` attribute bits and
  reports `placeholder: true`, and the UI says the file has not downloaded instead of hanging.
  Tell whoever sets this up to mark the folder "Always keep on this device".
- **A file still being written.** A CSV being copied in, or streamed down by OneDrive, is
  visible and readable while incomplete. `SETTLE_MS` (20s) holds a file until its mtime has
  stopped moving. This matters more than it looks: importing half an export would add part of a
  print run, and because `importBatches` is additive and dedupes by batch number, **re-importing
  the finished file afterwards would not fill in the gap.**

### "Already imported" comes from `import_sessions`

`scanDropFolder` ([dropFolder.ts](src/data/dropFolder.ts)) decides a file is new by comparing
its name against the filenames on `import_sessions` — case- and whitespace-insensitive. There
is no separate list of seen files, because that table is already the record of every CSV this
station took in. Hiding a sheet does **not** forget the filename, so the same file is not
offered again. **Remove** does forget it, which is how you re-import a test file or a
corrected export that kept the same name.

The usual floor rule is unchanged: **a corrected export that you are keeping alongside the
old one has to be saved under a new name.** Re-saving `print-run.csv` with fixed rows looks
like a file that was already handled unless someone removed the earlier import first. That
matches `importBatches` anyway, which skips batch numbers already on the page, so a
same-name re-import would do nothing while those rows still exist.

### Where Graph slots in

`CsvSource` is the seam — `label`, `list()`, `read(name)`. `FolderSource` is the only
implementation today. When Graph access is approved, a `GraphSource` implements the same two
methods against the SharePoint API and nothing above that file changes: the polling, the "is it
new" rule, the settling window, and the banner all work off the interface. Graph calls have to
go through the Rust side (`tauri-plugin-http`) rather than `fetch` — Graph will not serve
app-only credentials to a browser origin, and CORS blocks it.

Polling rather than a filesystem watcher is deliberate, and it is what makes the Graph swap
possible: OneDrive materialises a synced file in several steps and a watcher fires on each one,
while an HTTP source has nothing to watch at all.

## Testing without printed labels

Vitest covers the domain rules, not the checkout flow itself. Floor-style testing uses the real
control flow:

1. Import a D365 CSV (sample: **Load sample export** in the D365 panel, or choose your own file).
2. Enroll a badge in Admin; sign in.
3. Find the order with the **search bar** above the batch log, then click it — that opens it.
4. For each member, scan a synthetic printed-label QR from **Test labels** (Admin or D365 panel;
 admin-only, hidden in operator preview), paste `batch|item|product|labelCode|YYYY-MM-DD` into
 the wedge input, or hand-type batch + label code (two Enter commits). The hand-typed path is
 the no-QR label path: after the badge tap the `verify` audit row must end with the
 `[no QR — …]` suffix, and typing `20280318` must give the expiration-date message.
5. Badge tap to confirm — with the badge of whoever is signed in.
6. To check an order back in: scan a verified label. **Scan parent …** appears; scan the
   parent QR, then **Check back in**. Every run in that family returns to waiting. Uncheck
   **Check the whole order back in** under Admin → Settings to reopen only the scanned label.

`buildLabelQrPayload` ([referenceQr.ts](src/domain/referenceQr.ts)) builds the live roll string
from imported rows (`batch|item|name|labelCode|date`). Happy-path synthetic QRs match the
database by design; mismatch testing uses the "Mismatch test" QR, which sends a label code of
`WRONG` so the prefix check fails. Synthetic labels still require per-member scans in run order
and a badge confirm — never auto-fill the scanned side from `dbSideFromBatch`. The parser still
accepts legacy `LBL|1|batch|item|labelCode` so older test codes do not go silent.

Backup and roster need the **desktop** build — `npm run dev` in a browser has no SQLite and no
filesystem, so `snapshotTo` is undefined there and a backup reports "unsupported" by design.
Under `npm run desktop`: set a folder under Admin → Settings, press **Back up now**, and confirm
a `label-verification-YYYY-MM-DD.db` appears. Press it a second time — the status must read
"Today's backup already exists", not an error. For the roster, export from Admin → People, then
import the same file back; the summary should say every badge already matched.

For the watched folder, point Admin → Settings at any local folder and drop a CSV in. **Save
folder** lists it immediately and reports how many CSVs it can see, so a typo in the path shows
up as "Cannot read that folder" rather than as silence. The banner appears within one poll plus
the settling window — allow about a minute. Import it, and it must stop being offered. Hiding
the sheet takes it off the log; the filename stays recorded, so the same file is not offered
again. **Remove** deletes the session and its labels; the same filename is offered again and a
re-import can replace the log.

## Conventions

- All `localStorage` keys are `lvs-`-prefixed (e.g. `lvs-settings`,
  [settings.ts](src/config/settings.ts)). Browser `npm run dev` keeps batches, operators,
  and audit in IndexedDB (`label-verification`). Desktop stores those plus settings in
  SQLite (see **Where the database lives**). Settings are dual-written
  so a first desktop launch can pick up values already in `localStorage`.
- **Shared station setup goes in the store's settings, not `localStorage`.** `localStorage`
  belongs to one Windows account, so anything the station needs under whichever login is
  running it — settings, folders, the inbox ledger, the CSV column layout
  (`lvs-csv-column-mapping`) — is read and written through `store.getSetting` /
  `setSetting`. Only per-person UI state (queue sort, the shift sign-in session, the last
  import banner) stays in `localStorage`.
- Sounds are gated at each call site — [sounds.ts](src/audio/sounds.ts) has no internal gate.
  Verify and mismatch use `soundEnabled`. Sign-out uses `signOutSoundEnabled`, which defaults
  to off and never plays on launch.
- Tunable thresholds live in [settings.ts](src/config/settings.ts) and are editable
  at runtime under Admin → Settings: `badgePattern` (default `^\d{5,14}$` — 5-digit Alltech prox
  badges), `burstGapMs` (40), `commitPauseMs` (250), `autoAdvanceMs` (2500, now inert),
  `scannerTransport` (`hid` or `cdc`), `cdcPort`, `cdcBaud` (9600),
  `reopenWholeFamily` (default on — parent scan then the whole order returns to waiting).
- Operator-facing copy names the thing to do and the batch it applies to (`This order expects
  BO636845-02 (label 2 of 3). Scan that label, not a different run.`). Rejections are deliberate
  teaching moments in this flow, so keep them specific rather than generic.
- **Role gating uses `isAdmin` from `useSession()`, which is *effective*** — false while an admin
  previews the operator view. `isRealAdmin` ignores the preview and exists only so the "exit
  preview" control cannot hide itself. Never gate normal UI on `isRealAdmin`.
- The palette is a deliberate hybrid: white page canvas, dark panels. `--text` / `--dim` are for
  **dark surfaces**; `--text-on-bg` / `--dim-on-bg` are for the **white canvas**. `body` defaults
  to the canvas pair, so any new dark container must set `color: var(--text)` itself — see the
  shared rule under `body` in [app.css](src/app.css).

## Status — read before assuming structure

**This project is mid-rework**: the verification flow, data layer, and sheet-page model are all
subject to change, with new features on top. The architecture section of this file is
deliberately deferred until that work lands — explore the codebase rather than assuming
structure.

`README.md` is known to be several features behind the code (it predates sheet pages, batch
families, the D365 upload panel, recheck, and checkout export) and its SQL schema sketch is
missing the required `sheet_page_id` column. Do not trust it for architecture until it is
rewritten.
