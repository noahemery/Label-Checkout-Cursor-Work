# AGENTS.md

Project rules for AI coding agents. Cursor reads this file natively; Claude Code loads it via
the `@AGENTS.md` import in `CLAUDE.md`. Keep the content here so both tools stay in sync.

**Label Verification System** — a machine double-check and digital audit trail supplementing the
FMI B001 / FMLB003 paper "Label Log Out" process on the production floor. React 19 + Vite +
TypeScript, no backend. The Zebra scanner and RFID badge reader are both USB keyboard wedges.

## Commands

```
npm run dev      # Vite dev server — this IS how it runs in production
npm run build    # tsc -b && vite build
npm run lint     # eslint .
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

**Never auto-fill a verification slot from the database.** Stated at
[matching.ts:7-9](src/domain/matching.ts#L7-L9): a verdict requires a batch number **and** a
label code read off *both* physical artifacts — the printed label and the paper log sheet row.

The single exception is `itemNumber`
([useVerification.ts:297](src/verification/useVerification.ts#L297), `if (!side.itemNumber)
side.itemNumber = batch.itemNumber`), and that is precisely why `itemNumber` is compared as
*optional* while batch number and label code are *required*
([matching.ts:48-50](src/domain/matching.ts#L48-L50)).

Auto-filling `labelCode` from `batch.labelCode` would make every handshake pass unconditionally
and destroy the entire reason this application exists. No test will catch it — there are no
tests. If a refactor appears to need this, stop and ask.

Corollary: `normalizeId` ([normalize.ts:5-7](src/domain/normalize.ts#L5-L7)) strips all
non-alphanumerics and uppercases, so `US0.18.V2` ≡ `US0.18  V2` ≡ `us018v2`. Matching is lenient
about punctuation, exact about character sequence. All batch lookups index `batchNumberNorm`.

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
  Both import paths are live and behave differently: the Admin modal's `parseCsvFile` ignores
  the saved column mapping, the D365 panel's flow uses it.
- `findBatchByNumber` ([DataStore.ts:45](src/data/DataStore.ts#L45)) and `deleteSheetPhoto`
  ([DataStore.ts:59](src/data/DataStore.ts#L59)) are dead code — declared and implemented, never
  called.
- [vite.config.ts](vite.config.ts) pins no port, so Vite silently moves to 5174 when 5173 is
  taken and the hardcoded URL in `Start Label Verification.bat` breaks.
- StrictMode double-mount can double-seed the queue via two interleaved `syncPageQueue` passes.

## Conventions

- All `localStorage` keys are `lvs-`-prefixed (e.g. `lvs-settings`,
  [settings.ts:22](src/config/settings.ts#L22)). Everything else lives in IndexedDB, db
  `label-verification`.
- Sounds are gated on `settings.soundEnabled` **at each call site** —
  [sounds.ts](src/audio/sounds.ts) has no internal gate, so a new call site must check it itself.
- Tunable thresholds live in [settings.ts:13-20](src/config/settings.ts#L13-L20) and are editable
  at runtime under Admin → Settings: `badgePattern` (default `^\d{5,14}$` — 5-digit Alltech prox
  badges), `burstGapMs` (40), `commitPauseMs` (250), `autoAdvanceMs` (2500).

## Status — read before assuming structure

**This project is mid-rework**: the verification flow, data layer, and sheet-page model are all
subject to change, with new features on top. The architecture section of this file is
deliberately deferred until that work lands — explore the codebase rather than assuming
structure.

`README.md` is known to be several features behind the code (it predates sheet pages, batch
families, the D365 upload panel, recheck, and checkout export) and its SQL schema sketch is
missing the required `sheet_page_id` column. Do not trust it for architecture until it is
rewritten.
