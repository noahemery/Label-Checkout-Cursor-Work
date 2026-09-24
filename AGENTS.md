# AGENTS.md

Project rules for AI coding agents. Cursor reads this file natively; Claude Code loads it via
the `@AGENTS.md` import in `CLAUDE.md`. Keep the content here so both tools stay in sync.

**Label Verification System** — a machine double-check and digital audit trail supplementing the
FMI B001 / FMLB003 paper "Label Log Out" process on the production floor. React 19 + Vite +
TypeScript, no backend. The Zebra scanner and RFID badge reader are both USB keyboard wedges.
The floor station is a Tauri desktop app with SQLite; `npm run dev` in a browser is for
development only and uses IndexedDB.

## Commands

```
npm run desktop       # Tauri window + SQLite — this is how the station runs
npm run desktop:build # NSIS installer under src-tauri/target/release/bundle
npm run dev           # Vite in a browser (IndexedDB) — development without the desktop shell
npm run build         # tsc -b && vite build
npm run lint          # eslint .
```

**There is no test framework in this repo.** No runner, no test files, no testing dependency in
`package.json`. Do not tell the user to "run the tests," and never treat a passing build as
evidence that behavior is preserved.

**`npm run build` passes. `npm run lint` currently fails** with 19 errors and 3 warnings, all
pre-existing — so a red lint run is *not* a signal that you broke something. Compare against the
baseline below before assuming your change caused a failure:

- 9 × `react-hooks/refs` — refs written/read during render (`useVerification.ts:94,96`,
  `useWedgeCapture.ts:57`, `AppDataContext.tsx:29,30,76`, `App.tsx:121,122,139`)
- 4 × `react-hooks/set-state-in-effect` (`App.tsx:45`, `useWedgeCapture.ts:135`,
  `AdminModal.tsx:30`, `D365UploadPanel.tsx:44`)
- 4 × `react-refresh/only-export-components` — the context files export hooks beside providers
- 1 × `preserve-caught-error` (`IndexedDbStore.ts:207`), 1 × `no-useless-assignment`
  (`payloads.ts:81`)

These come from `eslint-plugin-react-hooks` v7 rules that postdate the code; none is a behavior
defect. Build is the only currently-green gate.

## The core control — do not break this

**Nothing is written to a batch until a badge that matches the signed-in operator taps at the
end of the order.** The operator attests to the *order context* by picking it off the batch log;
the machine checks *label identity* on every member; the badge signs for the whole thing.

The state machine lives in [useVerification.ts](src/verification/useVerification.ts) with the
phases in [familyCheckout.ts](src/domain/familyCheckout.ts):

- `scanning` — the operator clicked an order, so it is open on its first member. Each member is
  checked by its printed `LBL|` QR alone, compared against the D365 record via `dbSideFromBatch`.
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

No test will catch a regression in any of these — there are no tests. If a refactor appears to
need one of them, stop and ask.

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
- No test framework anywhere, and `npm run lint` is red by default (see Commands). Between them
  there is currently **no green regression gate** — behavior changes must be verified by running
  the app.
- An unknown badge tap writes **no audit event** —
  [SessionContext.tsx:54-60](src/session/SessionContext.tsx#L54-L60) sets state and plays a tone
  only. A real gap for a compliance tool.
- [csv.ts](src/data/csv.ts) is a legacy barrel over [csvMapping.ts](src/data/csvMapping.ts).
  The D365 panel is the only CSV import UI; it uses saved column mapping, mapping step, and preview.
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
- StrictMode double-mount can double-seed the queue via two interleaved `syncPageQueue` passes.
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
Each D365 import creates an **import session** (`ImportSession` in IndexedDB store
`importSessions`, schema v10) and stamps every row added that import with `batch.importId`.

- **Additive import:** `importBatches` skips duplicate batch numbers already on the page — the
  first sheet keeps the row; re-importing a corrected CSV does not update existing rows.
- **Mixed queue:** pending, verified, and flagged labels from every import share one batch log.
  Leftover unchecked labels from an earlier CSV stay until checked out or **Clear run** wipes
  the whole print run (batches + import sessions).
- **Sheet column:** shows the source CSV filename (truncated; full name in tooltip).
- **Delivery column:** D365 Delivery field, visible to operators; default sort is soonest
  delivery first (`lvs-queue-sort` in localStorage; alternate: sort by sheet / import time).
- Flagged families always sort to the top regardless of the user's sort mode.

## Testing without printed labels

There is no automated test runner. Floor-style testing uses the real control flow:

1. Import a D365 CSV (sample: **Load sample export** in the D365 panel, or choose your own file).
2. Enroll a badge in Admin; sign in.
3. Find the order with the **search bar** above the batch log, then click it — that opens it.
4. For each member, scan a synthetic **LBL** QR from **Test labels** (Admin or D365 panel;
   admin-only, hidden in operator preview), paste `LBL|1|batch|item|labelCode` into the wedge
   input, or hand-type batch + label code (two Enter commits).
5. Badge tap to confirm — with the badge of whoever is signed in.

`buildLabelQrPayload` ([referenceQr.ts](src/domain/referenceQr.ts)) builds LBL strings from
imported rows. Happy-path synthetic LBLs match the database by design; mismatch testing uses the
"Mismatch test" QR in the Test labels drawer, which sends a label code of `WRONG` so the prefix
check fails. Synthetic LBLs still require per-member scans in run order and a badge confirm —
never auto-fill the scanned side from `dbSideFromBatch`.

## Conventions

- All `localStorage` keys are `lvs-`-prefixed (e.g. `lvs-settings`,
  [settings.ts](src/config/settings.ts)). Browser `npm run dev` keeps batches, operators,
  and audit in IndexedDB (`label-verification`). Desktop stores those plus settings in
  SQLite (`label-verification.db` under the app config dir). Settings are dual-written
  so a first desktop launch can pick up values already in `localStorage`.
- Sounds are gated on `settings.soundEnabled` **at each call site** —
  [sounds.ts](src/audio/sounds.ts) has no internal gate, so a new call site must check it itself.
- Tunable thresholds live in [settings.ts:13-20](src/config/settings.ts#L13-L20) and are editable
  at runtime under Admin → Settings: `badgePattern` (default `^\d{5,14}$` — 5-digit Alltech prox
  badges), `burstGapMs` (40), `commitPauseMs` (250), `autoAdvanceMs` (2500, now inert).
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
