#Requires -Version 5.1
<#
.SYNOPSIS
    Copy a finished D365 CSV onto the label-station inbox.

.DESCRIPTION
    Runs on the PC that has Dynamics 365, not on the AIO. The station watches
    a local folder and only lists .csv files, so this script copies to
    <name>.csv.partial and renames after the byte count matches.

    A repeated file (same SHA-256) is skipped unless -Force is set. The inbox
    name always includes a timestamp, because the station treats a repeated
    filename as already imported.

.PARAMETER Path
    One CSV to send now.

.PARAMETER Watch
    Local folder to scan, non-recursive. CSVs already recorded in the send
    log are left where they are.

.PARAMETER Inbox
    UNC (or local) path of the inbox. Falls back to the LVS_INBOX environment
    variable. Example: \\LABEL-AIO\LabelInbox

.PARAMETER LogPath
    Where this PC remembers what it already sent. Default:
    %LOCALAPPDATA%\LabelVerification\sent-exports.json

.PARAMETER Force
    Send even when this exact file content was sent before.

.PARAMETER TestConnection
    Write and delete a non-csv probe. Exit 0 when the inbox is writable.
#>
[CmdletBinding(DefaultParameterSetName = 'Watch')]
param(
    [Parameter(Mandatory = $true, ParameterSetName = 'File', Position = 0)]
    [string]$Path,

    [Parameter(Mandatory = $true, ParameterSetName = 'Watch')]
    [string]$Watch,

    [string]$Inbox = $env:LVS_INBOX,

    [string]$LogPath,

    [switch]$Force,

    [Parameter(Mandatory = $true, ParameterSetName = 'Test')]
    [switch]$TestConnection
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# OFFLINE | RECALL_ON_OPEN | RECALL_ON_DATA_ACCESS. Same bits the station uses.
$script:CloudPlaceholderMask = 0x00001000 -bor 0x00040000 -bor 0x00400000

function Write-RunLog {
    param([string]$Message, [string]$LogFile)
    $dir = Split-Path -Parent $LogFile
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir | Out-Null
    }
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    $target = Join-Path $dir 'send.log'
    Add-Content -LiteralPath $target -Value $line -Encoding UTF8
    if ((Get-Item -LiteralPath $target).Length -gt 1MB) {
        $backup = "$target.bak"
        if (Test-Path -LiteralPath $backup) {
            Remove-Item -LiteralPath $backup -Force
        }
        Move-Item -LiteralPath $target -Destination $backup
    }
}

function Read-SendLog {
    param([string]$LogFile)
    if (-not (Test-Path -LiteralPath $LogFile)) {
        return [pscustomobject]@{ sent = @() }
    }
    $raw = Get-Content -LiteralPath $LogFile -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return [pscustomobject]@{ sent = @() }
    }
    try {
        $parsed = $raw | ConvertFrom-Json
    } catch {
        throw "Send log is unreadable ($LogFile). Not sending, so a broken log cannot resend the watch folder. Fix or rename the file."
    }
    $sentProp = $parsed.PSObject.Properties['sent']
    if ($null -eq $sentProp -or $null -eq $sentProp.Value) {
        throw "Send log has no 'sent' list ($LogFile). Not sending."
    }
    return [pscustomobject]@{ sent = @($sentProp.Value) }
}

function Save-SendLog {
    param($Log, [string]$LogFile)
    $dir = Split-Path -Parent $LogFile
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir | Out-Null
    }
    # A watch folder that is never cleaned would otherwise grow this file forever.
    # Trimming can resend a file older than the kept window if it is still there.
    $kept = @($Log.sent)
    if ($kept.Count -gt 2000) {
        $kept = @($kept | Select-Object -Last 2000)
    }
    # Windows PowerShell 5.1 collapses a one-element array into a bare object.
    # Build the array by hand so the next run still sees a list.
    $parts = @()
    foreach ($item in $kept) {
        $parts += ($item | ConvertTo-Json -Depth 3 -Compress)
    }
    $json = '{"sent":[' + ($parts -join ',') + ']}'
    $tmp = "$LogFile.tmp"
    Set-Content -LiteralPath $tmp -Value $json -Encoding UTF8
    if (Test-Path -LiteralPath $LogFile) {
        Remove-Item -LiteralPath $LogFile -Force
    }
    Move-Item -LiteralPath $tmp -Destination $LogFile
}

function Test-InboxWritable {
    param([string]$InboxPath, [int]$TimeoutSec = 15)
    if ([string]::IsNullOrWhiteSpace($InboxPath)) {
        throw 'Set -Inbox or the LVS_INBOX environment variable to the AIO share, for example \\LABEL-AIO\LabelInbox.'
    }
    $job = Start-Job -ScriptBlock {
        param($Folder)
        if (-not (Test-Path -LiteralPath $Folder)) { return 'missing' }
        $item = Get-Item -LiteralPath $Folder -ErrorAction SilentlyContinue
        if ($null -eq $item -or -not $item.PSIsContainer) { return 'not-a-folder' }
        $probe = Join-Path $Folder ('lvs-write-test-{0}.tmp' -f [guid]::NewGuid().ToString('N'))
        try {
            Set-Content -LiteralPath $probe -Value 'ok' -Encoding ASCII
            Remove-Item -LiteralPath $probe -Force
            return 'ok'
        } catch {
            if (Test-Path -LiteralPath $probe) {
                Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
            }
            return "write:$($_.Exception.Message)"
        }
    } -ArgumentList $InboxPath

    $done = Wait-Job $job -Timeout $TimeoutSec
    if (-not $done) {
        Stop-Job $job | Out-Null
        Remove-Job $job -Force
        throw "Inbox did not answer within ${TimeoutSec}s: $InboxPath"
    }
    $result = (@(Receive-Job $job) | Select-Object -Last 1)
    Remove-Job $job -Force
    if ($result -ne 'ok') {
        throw "Inbox is not writable ($result): $InboxPath"
    }
}

function Test-CloudPlaceholder {
    param($File)
    $attrs = [int]$File.Attributes
    return (($attrs -band $script:CloudPlaceholderMask) -ne 0)
}

function Get-InboxFileName {
    param([string]$SourceName)
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($SourceName)
    $stem = ($stem -replace '[^\w.\- ]', '_').Trim()
    if ([string]::IsNullOrWhiteSpace($stem)) { $stem = 'export' }
    if ($stem.Length -gt 80) { $stem = $stem.Substring(0, 80).Trim() }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    return "$stem-$stamp.csv"
}

function Send-FinishedCsv {
    param(
        $File,
        [string]$InboxPath,
        $Log,
        [bool]$SendAgain
    )

    if ($File.Extension -notmatch '^\.csv$') {
        return [pscustomobject]@{ Status = 'skipped'; Name = $File.Name; Detail = 'not a .csv' }
    }
    if (Test-CloudPlaceholder $File) {
        return [pscustomobject]@{ Status = 'waiting'; Name = $File.Name; Detail = 'file is not downloaded on this PC yet' }
    }
    if ($File.Length -le 0) {
        return [pscustomobject]@{ Status = 'failed'; Name = $File.Name; Detail = 'file is empty' }
    }

    $opened = $null
    try {
        $opened = [System.IO.File]::Open($File.FullName, 'Open', 'Read', 'None')
    } catch {
        return [pscustomobject]@{ Status = 'waiting'; Name = $File.Name; Detail = 'file is still open' }
    } finally {
        if ($null -ne $opened) { $opened.Dispose() }
    }

    $before = $File.Length
    Start-Sleep -Milliseconds 1000
    $File.Refresh()
    if (-not $File.Exists) {
        return [pscustomobject]@{ Status = 'waiting'; Name = $File.Name; Detail = 'file disappeared while it was being checked' }
    }
    if ($File.Length -ne $before) {
        return [pscustomobject]@{ Status = 'waiting'; Name = $File.Name; Detail = 'file is still being written' }
    }

    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $File.FullName).Hash
    $prior = @($Log.sent) | Where-Object { $_.sha256 -eq $hash } | Select-Object -First 1
    if (-not $SendAgain -and $null -ne $prior) {
        return [pscustomobject]@{ Status = 'skipped'; Name = $File.Name; Detail = "already sent as $($prior.inboxName)" }
    }

    $inboxName = Get-InboxFileName $File.Name
    $partialPath = Join-Path $InboxPath ($inboxName + '.partial')
    $finalPath = Join-Path $InboxPath $inboxName

    try {
        if (Test-Path -LiteralPath $finalPath) {
            throw "inbox already has $inboxName"
        }
        Copy-Item -LiteralPath $File.FullName -Destination $partialPath -Force
        $copied = Get-Item -LiteralPath $partialPath
        if ($copied.Length -ne $File.Length) {
            throw "size mismatch after copy ($($copied.Length) bytes on the inbox, $($File.Length) locally)"
        }
        Rename-Item -LiteralPath $partialPath -NewName $inboxName
        $published = Get-Item -LiteralPath $finalPath
        if ($published.Length -ne $File.Length) {
            Remove-Item -LiteralPath $finalPath -Force -ErrorAction SilentlyContinue
            throw "size mismatch after rename"
        }
    } catch {
        if (Test-Path -LiteralPath $partialPath) {
            Remove-Item -LiteralPath $partialPath -Force -ErrorAction SilentlyContinue
        }
        return [pscustomobject]@{ Status = 'failed'; Name = $File.Name; Detail = $_.Exception.Message }
    }

    $entry = [pscustomobject]@{
        sha256     = $hash
        sourceName = $File.Name
        sourcePath = $File.FullName
        inboxName  = $inboxName
        bytes      = [int64]$File.Length
        sentAt     = (Get-Date).ToString('o')
    }
    $Log.sent = @($Log.sent) + $entry
    return [pscustomobject]@{ Status = 'sent'; Name = $File.Name; Detail = $inboxName; Entry = $entry }
}

if ([string]::IsNullOrWhiteSpace($LogPath)) {
    $LogPath = Join-Path $env:LOCALAPPDATA 'LabelVerification\sent-exports.json'
}

try {
    Test-InboxWritable -InboxPath $Inbox
} catch {
    Write-RunLog -Message $_.Exception.Message -LogFile $LogPath
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
    exit 2
}

if ($TestConnection) {
    Write-RunLog -Message "Inbox writable: $Inbox" -LogFile $LogPath
    Write-Output "Inbox writable: $Inbox"
    exit 0
}

try {
    $log = Read-SendLog -LogFile $LogPath
} catch {
    Write-RunLog -Message $_.Exception.Message -LogFile $LogPath
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
    exit 3
}

function Test-SameFolder {
    param([string]$Left, [string]$Right)
    $a = [System.IO.Path]::GetFullPath($Left).TrimEnd('\')
    $b = [System.IO.Path]::GetFullPath($Right).TrimEnd('\')
    return ($a.Equals($b, [System.StringComparison]::OrdinalIgnoreCase))
}

$files = @()
if ($PSCmdlet.ParameterSetName -eq 'File') {
    if (-not (Test-Path -LiteralPath $Path)) {
        Write-Error -Message "File not found: $Path" -ErrorAction Continue
        exit 3
    }
    $one = Get-Item -LiteralPath $Path
    if ($one.PSIsContainer) {
        Write-Error -Message "-Path must be a file. Use -Watch for a folder." -ErrorAction Continue
        exit 3
    }
    if (Test-SameFolder -Left $one.DirectoryName -Right $Inbox) {
        Write-Error -Message "Refusing to send a file that is already in the inbox." -ErrorAction Continue
        exit 3
    }
    $files = @($one)
} else {
    if (-not (Test-Path -LiteralPath $Watch)) {
        Write-Error -Message "Watch folder not found: $Watch" -ErrorAction Continue
        exit 3
    }
    if (Test-SameFolder -Left $Watch -Right $Inbox) {
        Write-Error -Message "The watch folder and the inbox are the same folder. Point -Watch at the export folder on this PC." -ErrorAction Continue
        exit 3
    }
    $files = @(Get-ChildItem -LiteralPath $Watch -File | Where-Object { $_.Extension -match '^\.csv$' })
}

$failed = 0
$sent = 0
foreach ($file in $files) {
    $result = Send-FinishedCsv -File $file -InboxPath $Inbox -Log $log -SendAgain ([bool]$Force)
    switch ($result.Status) {
        'sent' {
            $sent++
            $line = "Sent $($result.Name) -> $($result.Detail)"
            Write-RunLog -Message $line -LogFile $LogPath
            Write-Output $line
        }
        'skipped' {
            Write-Output "Skipped $($result.Name) - $($result.Detail)"
        }
        'waiting' {
            $line = "Waiting on $($result.Name) - $($result.Detail)"
            Write-RunLog -Message $line -LogFile $LogPath
            Write-Output $line
        }
        'failed' {
            $failed++
            $line = "Failed $($result.Name) - $($result.Detail)"
            Write-RunLog -Message $line -LogFile $LogPath
            Write-Error -Message $line -ErrorAction Continue
        }
    }
    if ($result.Status -eq 'sent') {
        # Record before the next file. A kill mid-run must not resend what already landed.
        Save-SendLog -Log $log -LogFile $LogPath
    }
}

if ($failed -gt 0) { exit 3 }
if ($files.Count -eq 0 -and $PSCmdlet.ParameterSetName -eq 'Watch') {
    Write-Output "No CSV files in $Watch"
}
exit 0
