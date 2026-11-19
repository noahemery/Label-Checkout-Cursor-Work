# Sender window — technical design

A small window on the PC that runs D365. The person chooses a CSV and sees the
sheets already loaded on the AIO. The AIO operator does not click Review for
that file. The two PCs meet through the Windows shared folder in DESIGN.md.
SharePoint is not involved.

## Data Flow

```
finished CSV on the D365 PC
  -> sender window (person clicks Send)
  -> copy to \\<aio>\LabelInbox\<stem>-<timestamp>.csv.partial
  -> size matches, rename to .csv
  -> station sees the new .csv, imports with the saved column layout
  -> SQLite batches + import_sessions
  -> station writes station-status.json into the same folder
  -> sender window reads that file and shows the sheet list
```

`station-status.json` is plain text the station rewrites whenever a sheet is
added, hidden, or removed. The window polls it every few seconds. It carries
the connection proof: if the file is readable and recent, the window says
Connected.

Hide and remove travel the other way as one-line request files
(`hide-<id>.request`, `remove-<id>.request`). The station performs the same
action the D365 panel performs today, deletes the request, and rewrites the
status file. The window confirms remove before writing the request, with the
label count from the status file.

## Stack

The window is a small program installed on the D365 PC. It calls
`Send-D365Export.ps1` for the copy, so the partial-file and hash rules stay in
one place. The person double-clicks the window. PowerShell stays behind it.

The station change is inside the existing Tauri app: auto-import a settled
`.csv` that arrives in the inbox, and publish `station-status.json`. Column
mapping still uses the saved layout. A file that does not match that layout
is not imported; the status file records the error and the window shows it.

Alternative: a custom network service on the AIO that the window calls
directly. That is a second program to keep running, plus a firewall port and
a password. The shared folder is already the hole we mean to open, and the
station is already looking in it.

## File Layout

```
scripts/d365-inbox/Send-D365Export.ps1     copy one finished CSV (already written)
scripts/d365-inbox/Sender/                 the window on the D365 PC
src/data/inboxStatus.ts                    write station-status.json from import sessions
src/data/useDropFolder.ts                  import ready CSVs; apply hide/remove requests
```

On the share, at runtime:

```
\\<aio>\LabelInbox\*.csv                   files the window has finished sending
\\<aio>\LabelInbox\station-status.json     sheets, counts, last error
\\<aio>\LabelInbox\*.request               hide or remove, deleted after the station acts
```

## Key Interfaces

```ts
interface StationSheet {
  id: string
  filename: string
  labelCount: number
  active: boolean
  importedAt: string
}

interface StationStatus {
  station: string
  writtenAt: string
  sheets: StationSheet[]
  lastImport: { filename: string; added: number; skipped: number; error: string | null } | null
}
```

```ts
function writeStationStatus(folder: string, status: StationStatus): Promise<void>
function takeInboxImports(folder: string): Promise<void>
```

The window's Send button is `Send-D365Export.ps1 -Path <file> -Inbox \\<aio>\LabelInbox -Force`.
`-Force` is right here because the person clicked Send on purpose. A second
click of the same bytes still makes a new inbox name. The station then skips
batch numbers already on the page and reports `added` and `skipped` in
`lastImport`.

## What the window shows

```
Label station — LABEL-AIO                              Connected

Sheets on the station
  thursday-run.csv          128 labels     on the log      1:04 PM
  monday-additions.csv       14 labels     hidden         11:20 AM

CSV   C:\Exports\friday.csv
      86 data rows. Batch column found.
      [ Send to station ]

friday.csv — 80 labels added, 6 already on the station.
```

Choose CSV opens the normal Windows file picker. Connected flips to
"Cannot reach the station" when `station-status.json` cannot be read.
Send stays disabled until Connected and a CSV is chosen.

## Build Order

1. Station writes `station-status.json` into the inbox folder from the sheets
   it already has. A hand-copied CSV that is then confirmed on the AIO shows
   up in that file. This proves the window will have something to read.
2. Window that only reads the status file and lists sheets. No sending yet.
3. Send button wired to the existing copy script. Station still waits for
   Review on the AIO. The window can say "Sent — waiting for the station."
4. Station auto-imports a new `.csv` and fills `lastImport`. The AIO banner
   for that folder goes away. This is the step that removes the click on the AIO.
5. Hide and Remove on each row, with the confirm copy the station already uses.

Steps 1–3 are safe to ship before auto-import. Step 4 is the behavior change:
the person who clicks Send is the person who chose the print run.

## Failure Modes

| What happened | What the person sees |
| --- | --- |
| AIO off, or the share was never created | "Cannot reach the station." Send does nothing. |
| CSV still open in Excel | "That file is still open. Close it and send again." |
| Columns do not match the saved layout | Sheet is not added. The window shows the station's mapping error. |
| Batch numbers already on the station | Sheet is added for the new rows only. The window shows added and skipped counts. |
| Two people send at once | Two inbox names. Both import. Duplicate batches are skipped. |
| Status file half-written | Window keeps the last good copy and retries. |
