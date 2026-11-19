# D365 inbox — technical design

The shared folder in this document is the road between the D365 PC and the AIO.
Daily use of that road is the sender window in
[SENDER-WINDOW.md](SENDER-WINDOW.md): the person picks a CSV, the station
imports it, and the window shows the sheets loaded on the AIO. This file is the
copy and the one-time share. The PowerShell script is what the window calls.
The person at the D365 PC does not run it themselves.

## Data Flow

```
D365 export on the licensed PC (finished .csv on local disk)
  -> Send-D365Export.ps1 checks the file is closed, non-empty, and size-stable
  -> SHA-256; skip if this PC already sent that exact content
  -> copy to \\<aio>\LabelInbox\<stem>-<timestamp>.csv.partial
  -> byte count must match, then rename to .csv
  -> station polls C:\LabelVerification\Inbox every 30s (existing FolderSource)
  -> banner "Review and import" -> preview -> Confirm import
  -> SQLite batches + import_sessions row keyed by the inbox filename
```

The `.csv.partial` name is the important boundary. The station lists only `.csv`
files, so a copy in progress is invisible. Rename on the same share is one
operation. That matters because `scanDropFolder` treats an old modified time as
already settled, and a copy tool often keeps the source timestamp. Waiting on
mtime would not protect a file that appears half-written with yesterday's clock.

## Stack

PowerShell 5.1 script on the D365 PC, plus a Windows share on the AIO.
The station side is the drop folder that is already shipped (`lvs-drop-folder`,
`list_drop_folder` / `read_drop_file`). No new service, no Graph credential,
no code on the station that pulls from the network.

Alternative if plant policy forbids a share on the kiosk: put the same inbox
on a file server both PCs can reach, and point Admin → Settings at that UNC
path. The script and the station code stay the same. Cost is another machine
that has to be up for a print run to be offered.

## File Layout

```
scripts/d365-inbox/Send-D365Export.ps1   copy one finished CSV, or watch a folder
scripts/d365-inbox/DESIGN.md             this document
```

On the AIO, once, outside the repo:

```
C:\LabelVerification\Inbox               local folder the app watches
\\<aio-hostname>\LabelInbox              same folder, shared to the D365 user
```

On the D365 PC, per user, created by the script:

```
%LOCALAPPDATA%\LabelVerification\sent-exports.json   content already copied
%LOCALAPPDATA%\LabelVerification\send.log            one line per run
```

## Key Interfaces

```powershell
# Send one finished file. Returns a result object; exit 0, 2, or 3.
.\Send-D365Export.ps1 -Path C:\Exports\print-run.csv -Inbox '\\AIO\LabelInbox'

# Forward every new CSV in a folder. Same file content is sent once.
.\Send-D365Export.ps1 -Watch C:\Exports -Inbox '\\AIO\LabelInbox'

# Prove the share is reachable and writable. Does not leave a .csv behind.
.\Send-D365Export.ps1 -TestConnection -Inbox '\\AIO\LabelInbox'
```

`-Inbox` falls back to the `LVS_INBOX` environment variable. There is no
default hostname.

A sent file is recorded as `{ sha256, sourceName, sourcePath, inboxName, bytes, sentAt }`.
The inbox name is `<original-stem>-yyyyMMdd-HHmmss-fff.csv`. The station dedupes
on that name, so a new export must be a new name even when the person saved
over `print-run.csv` locally. `-Force` sends again even when the hash matches;
the station will still skip batch numbers already on the page.

## Build Order

1. On the AIO, as an administrator, create the inbox and share it. Replace the
   domain group with the account that actually exports from D365. The station
   user only needs NTFS read, which it already has as the folder's owner,
   because the app reads the local path. Enable File and Printer Sharing on
   the Domain profile only.

```powershell
New-Item -ItemType Directory -Force -Path C:\LabelVerification\Inbox
New-SmbShare -Name LabelInbox -Path C:\LabelVerification\Inbox `
  -ChangeAccess 'DOMAIN\Label Export Writers' -FullAccess 'Administrators'
icacls C:\LabelVerification\Inbox /grant 'DOMAIN\Label Export Writers:(OI)(CI)M'
Set-NetFirewallRule -DisplayGroup "File and Printer Sharing" -Enabled True -Profile Domain
```

If the AIO is not on the domain, create a local user for the export PC instead
of a domain group, grant that user the same Change / Modify rights, and on the
D365 PC store the credential with `cmdkey /add:<aio-hostname> /user:<aio-hostname>\label-export`.

2. On the AIO app: Admin → Settings → D365 export folder →
   `C:\LabelVerification\Inbox` → Save folder. Status must say the folder was
   reached. Leave the field empty only when someone will use Choose your file.
3. On the D365 PC, run `-TestConnection`. Then `-Path` a real export.
   Within about a minute the station banner offers that filename.
   Confirm import only when the preview is the right print run.
4. When that works by hand, add a scheduled task every minute for `-Watch`
   on the folder they already save into. Run it as the user who can see the
   share, and only store a password if it must run while they are logged off
   (a logged-off task cannot touch the network otherwise).

```powershell
schtasks /Create /TN "Label Verification export" /SC MINUTE /MO 1 /RL LIMITED `
  /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\LabelVerification\Send-D365Export.ps1 -Watch C:\Exports -Inbox \\AIO-HOSTNAME\LabelInbox"
```

Copy the script onto the D365 PC first. `C:\Exports` is whatever folder the
export is saved into, not the AIO inbox.

Step 3 is the whole system. Step 4 is so a busy export does not depend on
someone remembering a second click.

## Failure Modes

| What happened | What the system does |
| --- | --- |
| AIO off, share down, or firewall blocking 445 | Script waits at most 15s, writes the error, sends nothing, exits 2. Next run retries. The station shows "Shared folder unreachable" only if its own path is bad; a local inbox stays readable when the share is down. |
| Excel still has the CSV open, or the copy onto the D365 disk is unfinished | That file is skipped this run. It is not recorded as sent. |
| Copy lands short | `.csv.partial` is deleted. Nothing is renamed to `.csv`. Not recorded. Exit 3. |
| Same export run twice | Hash matches the send log. Skipped. No second banner. |
| Corrected export, same batches, new file | New inbox name, station offers it. Confirming import does not update rows already on the page. Remove the old sheet first when the correction must replace them. |
| Someone drops a CSV into the inbox without the script | Station still offers it after the 20s settle, as long as the modified time is recent. A drag-drop of an already-old file can be offered immediately. Prefer the script. |
| Send log unreadable | Script refuses to run. It does not start a fresh log, because that would resend every file still sitting in the watch folder. |
| OneDrive placeholder on the AIO | Does not apply while the watched folder is `C:\LabelVerification\Inbox`. If someone points the setting at a OneDrive library instead, the existing placeholder check holds the file and tells them it has not downloaded. |
| Two stations later | Both can watch one inbox. Each confirms for itself. Do not build fan-out. |

## What this deliberately is not

- Not an auto-import. The banner is the control that keeps a bad file off the batch log.
- Not Microsoft Graph. That still needs a credential with SharePoint access and IT approval. `CsvSource` can grow a `GraphSource` later without changing this script's contract.
- Not a custom upload service on the AIO. SMB already moves the file, and the app already refuses paths outside the configured folder.
