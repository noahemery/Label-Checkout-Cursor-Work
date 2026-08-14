# Copy-Paste Prompt for Claude (30-Min Presentation)

Copy everything inside the fenced block below into Claude (claude.ai or Claude in Cursor). Attach 4–6 app screenshots if you have them.

Optional add-on (paste after the block):

> My audience includes production, quality, and operations leaders at Alltech. Emphasize operator ease and supervisor audit trail. Include one slide on this being an intern prototype built over several weeks with AI-assisted tools.

---

```
You are helping me build a 30-minute presentation slide deck for a non-technical audience at Alltech (production, quality, and operations leaders — not software engineers).

## Presentation constraints
- Total runtime: ~30 minutes (aim for 18–22 slides + 5–8 min live demo/Q&A buffer)
- Tone: clear, confident, practical — no jargon without a plain-English definition
- Visual style suggestion: light industrial theme matching the app (light background, amber/green status colors, Alltech branding(terracoda orange constantyly in the slides))
- Every slide should have: a short title, 3–5 bullet max (or one simple diagram), and optional speaker notes (1–2 paragraphs per slide)
- Do NOT assume the audience knows what code, APIs, IndexedDB, or React mean — translate everything to floor operations language

## Presenter context (use this accurately)
- Presenter: Alltech engineering intern
- Project: **Label Verification System** — a companion to the paper **FMI B001/3 "Label Log Out"** process
- Built using **Cursor** (AI-powered code editor) with assistance from **Claude** (AI assistant)
- GitHub repo: Label-Checkout-Cursor-Work (working prototype, not production IT system yet)
- Runs today on a label-room PC: double-click `Start Label Verification.bat` → opens in browser at localhost
- Hardware: Zebra barcode scanner + RFID badge reader (both plug in like keyboards — no special drivers), (mention 3 tyra printers are what actually print the labels)
- Badge IDs: 5-digit prox badges supported (e.g. 13925)

## Required slide order and sections

### Section A — Setting the stage (5–6 min, ~4 slides)
1. **Title slide** — Label Verification System, Alltech, date, presenter name
2. **What is AI-assisted development?** — Explain in plain language:
   - What **Claude** is (conversational AI you describe problems to; it helps write, explain, and refine)
   - What **Cursor** is (Cursor = a code editor; Claude is the assistant inside it that helps build the app while you describe what the floor needs)
   - Analogy: "I describe the label-room workflow; the AI helps draft the screen, logic, and fixes — I review and test on the real scanners"
   - Keep this non-threatening: AI did not replace the process — it accelerated building a prototype
3. **Why use this approach for a floor tool?** — Fast iteration, demo-able in weeks, built around real scanner/badge hardware, easy to change when supervisors give feedback
4. **What we built (one sentence)** — A scanning station that double-checks every printed label against the log sheet before it leaves the print room

### Section B — The problem (6–7 min, ~4 slides)
5. **What happens today (paper FMI B001/3)** — Operators log labels out on paper; human process, no machine double-check at scan time
6. **What can go wrong** — Wrong batch on wrong roll, mismatched label code vs sheet row, no timestamped digital record of who verified what, hard for supervisors to audit after the fact
7. **Why paper alone isn't enough** — Paper stays (compliance binder); but the floor needs immediate feedback: green = go, red = stop, loud and obvious
8. **What success looks like** — Every batch verified by a named operator, both physical artifacts scanned, mismatch caught before labels hit the line, exportable record for supervisors

### Section C — The solution (10–12 min, ~8 slides)
9. **Core idea: two-scan handshake** — Scan 1 = printed label. Scan 2 = log sheet row. Both must match (batch number, label code, and item number). Nothing auto-filled from memory — both sides come from physical scans.
10. **Operator flow (step by step)** — Badge in → Card 1 active (printed label) → Card 2 unlocks (log sheet row) → Green verified OR red mismatch with exact difference shown
11. **Who is accountable** — RFID badge sign-in, every scan/verify/mismatch logged in Activity
12. **What the operator sees** — Describe the UI zones without code terms:
    - Header: Alltech logo, session ID, shift, operator name
    - Scan zone: sequential cards (not parallel) — label first, sheet second
    - Batch log: "21 of 65 labels checked today" with progress ring
    - D365 upload zone: import today's print run CSV with column mapping
13. **What happens on mismatch** — Full-screen red, field-by-field comparison (label vs sheet), operator can re-scan or flag for supervisor
14. **Supervisor tools (zero infrastructure today)** — Activity log, CSV export (Operator, Child Batch, Parent Batch, Item, Qty, Result, Timestamp), printable summary page
15. **Demo slide** — [LIVE DEMO or SCREENSHOTS] — suggest 4 screenshots: badge gate, mid-scan Card 1 active, green verified, batch log with progress

### Section D — What's real vs what's next (5–6 min, ~4 slides)
16. **What works today (prototype)** — Runs on one PC, local browser memory, per-sheet check-out memory, D365 CSV import, sheet photo upload, multi-sheet pages (FMLB003, FMI B001 demo)
17. **What is NOT production yet** — No central database, no sync across stations, no live D365 feed, no OCR reading uploaded sheet photos, no BarTender printing sheet-row QRs yet
18. **Roadmap (3 phases)** —
    - Phase 1 (now): floor prototype, local audit trail, CSV export for supervisors
    - Phase 2: Azure SQL / company database, multi-station sync, D365 integration
    - Phase 3: QR codes printed on FMI B001 rows at print time (BarTender automation)
19. **Ask / discussion** — What would supervisors need to trust this on the floor? What would IT need for Phase 2?

### Section E — Close (2 min, ~1 slide)
20. **Summary** — Paper process stays(eventually everything being digital is ideal, just will take a long time); app adds machine enforcement + audit trail; built fast with AI-assisted tools; ready for feedback and pilot

## Diagrams to include (describe or use mermaid in speaker notes)
- Two-scan handshake flow: Badge → Label scan → Sheet scan → Match?
- Paper + digital: FMI B001 binder (official) + app (double-check + log)
- Today vs tomorrow: Local PC memory → Azure/fabric central database

## Things to avoid
- Don't oversell as "replacing" the paper log — it supplements FMI B001, this has kinda changed since, we are now good with replacing paper, but it just won't likely happend this summer
- Don't claim OCR or D365 live integration exists today, we don't know if it does, we at least don't have it

## Output format
Deliver:
1. Slide-by-slide outline (title, bullets, speaker notes, suggested visual)
2. A timing guide (minutes per section)
3. 3–5 anticipated Q&A questions with suggested answers (e.g. "What if the PC reboots?" → check-out memory is local to that browser; exports are the backup)
4. Optional: opening 30-second script and closing 30-second script


```

## Suggested screenshots to attach

| Screenshot | When to show |
|------------|----------------|
| Badge gate ("Scan your badge to start") | Slide 10 or live demo start |
| Scan zone — Card 1 active, Card 2 dimmed | Slide 10–12 |
| Green VERIFIED banner | Slide 13 |
| Batch log with "N of M labels checked today" | Slide 12 |
| Red mismatch overlay | Slide 13 |
| Activity drawer + Export CSV | Slide 14 |

## Output format options

After Claude responds, paste the outline into:

- **PowerPoint / Google Slides** — one slide per section
- **Gamma.app or Beautiful.ai** — paste markdown outline for auto-layout
- **Pre-built deck** — see [`label-verification-presentation-deck.md`](label-verification-presentation-deck.md) in this folder (already generated and reviewed against the app)
