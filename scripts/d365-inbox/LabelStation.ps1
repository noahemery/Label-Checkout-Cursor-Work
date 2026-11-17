#Requires -Version 5.1
<#
.SYNOPSIS
    Window on the D365 PC. Send a CSV to the label station and see its sheets.

.DESCRIPTION
    Reads station-status.json from the shared inbox and writes hide/show/remove
    request files the station picks up. Send calls Send-D365Export.ps1.
    The person using this window does not type PowerShell.

    Set LVS_SENDER_SELFTEST=1 to run the checks and exit without opening a window.
#>
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$script:ConfigPath = Join-Path $env:LOCALAPPDATA 'LabelVerification\sender-config.json'
$script:CopyScript = Join-Path $PSScriptRoot 'Send-D365Export.ps1'

function Format-LastImport($Last) {
    if ($null -eq $Last) { return '' }
    $err = $null
    if ($Last.PSObject.Properties.Name -contains 'error') { $err = $Last.error }
    $name = [string]$Last.filename
    if (-not [string]::IsNullOrWhiteSpace([string]$err)) {
        return "${name}: $err"
    }
    $added = 0
    $skipped = 0
    if ($null -ne $Last.added) { $added = [int]$Last.added }
    if ($null -ne $Last.skipped) { $skipped = [int]$Last.skipped }
    if ($added -eq 0) {
        return "$name was already on the station. Nothing new was added."
    }
    $word = 'labels'
    if ($added -eq 1) { $word = 'label' }
    $tail = ''
    if ($skipped -gt 0) { $tail = ", $skipped already on the station" }
    return "${name}: $added $word added${tail}."
}

function New-SheetRequestName([string]$Action, [string]$Id) {
    if ($Action -notin @('hide', 'show', 'remove')) {
        throw "Unknown sheet action $Action"
    }
    if ($Id -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') {
        throw "Sheet id is not a station id."
    }
    return "$Action-$($Id.ToLowerInvariant()).request"
}

function Get-CsvSummary([string]$Path) {
    $lines = @([System.IO.File]::ReadAllLines($Path) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    $rows = [Math]::Max(0, $lines.Count - 1)
    $found = $false
    if ($lines.Length -gt 0) {
        $aliases = @(
            'batch', 'batchnumber', 'batchno', 'batchid', 'lot', 'lotnumber',
            'production', 'inventbatchid', 'productionbatch', 'childbatch'
        )
        foreach ($header in $lines[0].Split(',')) {
            $norm = ([string]$header -replace '[^a-zA-Z0-9]', '').ToLowerInvariant()
            if ($aliases -contains $norm) { $found = $true }
        }
    }
    $batch = 'Batch column was not found.'
    if ($found) { $batch = 'Batch column found.' }
    return "$rows data rows. $batch"
}

function Read-SavedInbox {
    if (-not (Test-Path -LiteralPath $script:ConfigPath)) { return '' }
    try {
        $parsed = Get-Content -LiteralPath $script:ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
        return ([string]$parsed.inbox).Trim()
    } catch {
        return ''
    }
}

function Save-InboxPath([string]$Inbox) {
    $dir = Split-Path -Parent $script:ConfigPath
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir | Out-Null
    }
    $json = @{ inbox = $Inbox.Trim() } | ConvertTo-Json
    Set-Content -LiteralPath $script:ConfigPath -Value $json -Encoding UTF8
}

function Convert-StationStatus([string]$Text) {
    $parsed = $Text | ConvertFrom-Json
    $sheets = @()
    if ($null -ne $parsed.sheets) { $sheets = @($parsed.sheets) }
    return [pscustomobject]@{
        station    = [string]$parsed.station
        sheets     = $sheets
        lastImport = $parsed.lastImport
    }
}

if ($env:LVS_SENDER_SELFTEST -eq '1') {
    $failed = 0
    function Assert-Same($actual, $expected, $label) {
        if ($actual -ne $expected) {
            Write-Output "FAIL $label : [$actual] != [$expected]"
            $script:failed++
        }
    }
    $id = '550e8400-e29b-41d4-a716-446655440000'
    Assert-Same (New-SheetRequestName 'hide' $id) "hide-$id.request" 'hide name'
    $none = [pscustomobject]@{ filename = 'a.csv'; added = 0; skipped = 4; error = $null }
    Assert-Same (Format-LastImport $none) 'a.csv was already on the station. Nothing new was added.' 'nothing new'
    $some = [pscustomobject]@{ filename = 'a.csv'; added = 2; skipped = 1; error = $null }
    Assert-Same (Format-LastImport $some) 'a.csv: 2 labels added, 1 already on the station.' 'partial'
    $bad = [pscustomobject]@{ filename = 'a.csv'; added = 0; skipped = 0; error = 'No batch rows found in that file.' }
    Assert-Same (Format-LastImport $bad) 'a.csv: No batch rows found in that file.' 'error'
    $dir = Join-Path $env:TEMP ("lvs-sender-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $dir | Out-Null
    Set-Content -LiteralPath (Join-Path $dir 'run.csv') -Value "Production,Label`r`nBO1,US0`r`nBO2,CA0`r`n" -Encoding ASCII
    Assert-Same (Get-CsvSummary (Join-Path $dir 'run.csv')) '2 data rows. Batch column found.' 'summary'
    $raw = '{"station":"AIO1","writtenAt":"2026-10-27T19:00:00.000Z","sheets":{"id":"' + $id + '","filename":"run.csv","labelCount":2,"active":true,"importedAt":"2026-10-27T19:00:00.000Z"},"lastImport":null}'
    $status = Convert-StationStatus $raw
    Assert-Same $status.station 'AIO1' 'station'
    Assert-Same @($status.sheets).Count 1 'one sheet object becomes a list'
    Remove-Item -LiteralPath $dir -Recurse -Force
    if ($failed -gt 0) { exit 1 }
    Write-Output 'SELFTEST OK'
    exit 0
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$script:inbox = Read-SavedInbox
$script:csvPath = ''
$script:readCmd = $null
$script:readHandle = $null
$script:sendCmd = $null
$script:sendHandle = $null
$script:waitingFor = ''

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Label station'
$form.ClientSize = New-Object System.Drawing.Size(720, 520)
$form.StartPosition = 'CenterScreen'
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$form.MinimumSize = New-Object System.Drawing.Size(640, 480)

$inboxLabel = New-Object System.Windows.Forms.Label
$inboxLabel.Text = 'Station folder'
$inboxLabel.Location = New-Object System.Drawing.Point(16, 16)
$inboxLabel.AutoSize = $true

$inboxBox = New-Object System.Windows.Forms.TextBox
$inboxBox.Location = New-Object System.Drawing.Point(120, 12)
$inboxBox.Size = New-Object System.Drawing.Size(460, 26)
$inboxBox.Text = $script:inbox
$inboxBox.Anchor = 'Top, Left, Right'

$saveButton = New-Object System.Windows.Forms.Button
$saveButton.Text = 'Save'
$saveButton.Location = New-Object System.Drawing.Point(590, 10)
$saveButton.Size = New-Object System.Drawing.Size(110, 28)
$saveButton.Anchor = 'Top, Right'

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.Text = 'Set the station folder. It looks like \\AIO-NAME\LabelInbox'
$statusLabel.Location = New-Object System.Drawing.Point(16, 46)
$statusLabel.Size = New-Object System.Drawing.Size(688, 22)
$statusLabel.Anchor = 'Top, Left, Right'

$list = New-Object System.Windows.Forms.ListView
$list.Location = New-Object System.Drawing.Point(16, 76)
$list.Size = New-Object System.Drawing.Size(560, 280)
$list.View = 'Details'
$list.FullRowSelect = $true
$list.GridLines = $true
$list.Anchor = 'Top, Bottom, Left, Right'
$list.Columns.Add('Sheet', 230) | Out-Null
$list.Columns.Add('Labels', 70) | Out-Null
$list.Columns.Add('On the log', 110) | Out-Null
$list.Columns.Add('Imported', 90) | Out-Null

$hideButton = New-Object System.Windows.Forms.Button
$hideButton.Text = 'Hide from log'
$hideButton.Location = New-Object System.Drawing.Point(590, 76)
$hideButton.Size = New-Object System.Drawing.Size(110, 32)
$hideButton.Anchor = 'Top, Right'
$hideButton.Enabled = $false

$removeButton = New-Object System.Windows.Forms.Button
$removeButton.Text = 'Remove'
$removeButton.Location = New-Object System.Drawing.Point(590, 116)
$removeButton.Size = New-Object System.Drawing.Size(110, 32)
$removeButton.Anchor = 'Top, Right'
$removeButton.Enabled = $false

$csvLabel = New-Object System.Windows.Forms.Label
$csvLabel.Text = 'CSV'
$csvLabel.Location = New-Object System.Drawing.Point(16, 372)
$csvLabel.AutoSize = $true
$csvLabel.Anchor = 'Bottom, Left'

$csvBox = New-Object System.Windows.Forms.TextBox
$csvBox.Location = New-Object System.Drawing.Point(60, 368)
$csvBox.Size = New-Object System.Drawing.Size(400, 26)
$csvBox.ReadOnly = $true
$csvBox.Anchor = 'Bottom, Left, Right'

$chooseButton = New-Object System.Windows.Forms.Button
$chooseButton.Text = 'Choose CSV'
$chooseButton.Location = New-Object System.Drawing.Point(470, 366)
$chooseButton.Size = New-Object System.Drawing.Size(110, 28)
$chooseButton.Anchor = 'Bottom, Right'

$summaryLabel = New-Object System.Windows.Forms.Label
$summaryLabel.Text = ''
$summaryLabel.Location = New-Object System.Drawing.Point(16, 404)
$summaryLabel.Size = New-Object System.Drawing.Size(560, 22)
$summaryLabel.Anchor = 'Bottom, Left, Right'

$sendButton = New-Object System.Windows.Forms.Button
$sendButton.Text = 'Send to station'
$sendButton.Location = New-Object System.Drawing.Point(590, 366)
$sendButton.Size = New-Object System.Drawing.Size(110, 32)
$sendButton.Anchor = 'Bottom, Right'
$sendButton.Enabled = $false

$resultLabel = New-Object System.Windows.Forms.Label
$resultLabel.Text = ''
$resultLabel.Location = New-Object System.Drawing.Point(16, 470)
$resultLabel.Size = New-Object System.Drawing.Size(688, 36)
$resultLabel.Anchor = 'Bottom, Left, Right'

$form.Controls.AddRange(@(
    $inboxLabel, $inboxBox, $saveButton, $statusLabel, $list,
    $hideButton, $removeButton, $csvLabel, $csvBox, $chooseButton,
    $summaryLabel, $sendButton, $resultLabel
))

function Update-SendEnabled {
    $sendButton.Enabled = (
        -not [string]::IsNullOrWhiteSpace($script:inbox) -and
        -not [string]::IsNullOrWhiteSpace($script:csvPath) -and
        $null -eq $script:sendHandle
    )
}

function Request-SheetAction([string]$Action) {
    $script:inbox = $inboxBox.Text.Trim()
    if ($list.SelectedItems.Count -lt 1) { return }
    if ([string]::IsNullOrWhiteSpace($script:inbox)) { return }
    $item = $list.SelectedItems[0]
    $id = [string]$item.Tag
    $fileName = $item.Text
    $labels = $item.SubItems[1].Text
    if ($Action -eq 'remove') {
        $answer = [System.Windows.Forms.MessageBox]::Show(
            "Remove $fileName from the station? $labels labels leave the log.",
            'Label station',
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        )
        if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) { return }
    }
    $request = Join-Path $script:inbox (New-SheetRequestName $Action $id)
    [System.IO.File]::WriteAllText($request, $id)
    $verb = 'Hide'
    if ($Action -eq 'show') { $verb = 'Show' }
    if ($Action -eq 'remove') { $verb = 'Remove' }
    $resultLabel.Text = "$verb requested for $fileName. The station applies it on its next check."
}

function Show-StatusText([string]$Text) {
    try {
        $status = Convert-StationStatus $Text
    } catch {
        $statusLabel.Text = 'Cannot reach the station. The status file was not readable.'
        return
    }
    $who = $status.station
    if ([string]::IsNullOrWhiteSpace($who)) { $who = 'the station' }
    $statusLabel.Text = "Connected to $who"
    $selected = ''
    if ($list.SelectedItems.Count -gt 0) { $selected = [string]$list.SelectedItems[0].Tag }
    $list.Items.Clear()
    foreach ($sheet in @($status.sheets)) {
        if ($null -eq $sheet -or [string]::IsNullOrWhiteSpace([string]$sheet.id)) { continue }
        $when = ''
        try {
            $when = [datetimeoffset]::Parse([string]$sheet.importedAt).ToLocalTime().ToString('h:mm tt')
        } catch {
            $when = ''
        }
        $state = 'on the log'
        if (-not $sheet.active) { $state = 'hidden' }
        $row = New-Object System.Windows.Forms.ListViewItem([string]$sheet.filename)
        [void]$row.SubItems.Add([string]$sheet.labelCount)
        [void]$row.SubItems.Add($state)
        [void]$row.SubItems.Add($when)
        $row.Tag = [string]$sheet.id
        [void]$list.Items.Add($row)
        if ($row.Tag -eq $selected) { $row.Selected = $true }
    }
    if (-not [string]::IsNullOrWhiteSpace($script:waitingFor) -and $null -ne $status.lastImport) {
        if ([string]$status.lastImport.filename -eq $script:waitingFor) {
            $script:waitingFor = ''
            $resultLabel.Text = Format-LastImport $status.lastImport
        }
    }
}

function Start-StatusRead {
    if ($null -ne $script:readHandle) { return }
    if ([string]::IsNullOrWhiteSpace($script:inbox)) { return }
    $full = Join-Path $script:inbox 'station-status.json'
    $cmd = [powershell]::Create()
    [void]$cmd.AddScript({
        param($Path)
        try {
            if (-not (Test-Path -LiteralPath $Path)) { return 'ERR:Cannot reach the station.' }
            return 'OK:' + [System.IO.File]::ReadAllText($Path)
        } catch {
            return 'ERR:' + $_.Exception.Message
        }
    }).AddArgument($full)
    $script:readCmd = $cmd
    $script:readHandle = $cmd.BeginInvoke()
}

function Finish-StatusRead {
    if ($null -eq $script:readHandle -or -not $script:readHandle.IsCompleted) { return }
    $text = ''
    try {
        $output = @($script:readCmd.EndInvoke($script:readHandle))
        if ($output.Count -gt 0) { $text = [string]$output[0] }
    } catch {
        $text = 'ERR:' + $_.Exception.Message
    } finally {
        $script:readCmd.Dispose()
        $script:readCmd = $null
        $script:readHandle = $null
    }
    if ($text.StartsWith('OK:')) {
        Show-StatusText $text.Substring(3)
    } else {
        $message = $text
        if ($message.StartsWith('ERR:')) { $message = $message.Substring(4) }
        if ([string]::IsNullOrWhiteSpace($message)) { $message = 'Cannot reach the station.' }
        $statusLabel.Text = $message
    }
}

$saveButton.Add_Click({
    $script:inbox = $inboxBox.Text.Trim()
    Save-InboxPath $script:inbox
    Update-SendEnabled
    $statusLabel.Text = 'Saved. Checking the station...'
    Start-StatusRead
})

$chooseButton.Add_Click({
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Filter = 'CSV files (*.csv)|*.csv|All files (*.*)|*.*'
    $dialog.Title = 'Choose the D365 export'
    if ($dialog.ShowDialog($form) -ne [System.Windows.Forms.DialogResult]::OK) { return }
    $script:csvPath = $dialog.FileName
    $csvBox.Text = $script:csvPath
    try {
        $summaryLabel.Text = Get-CsvSummary $script:csvPath
    } catch {
        $summaryLabel.Text = $_.Exception.Message
    }
    Update-SendEnabled
})

$list.Add_SelectedIndexChanged({
    $has = $list.SelectedItems.Count -gt 0
    $removeButton.Enabled = $has
    $hideButton.Enabled = $has
    if (-not $has) {
        $hideButton.Text = 'Hide from log'
        return
    }
    if ($list.SelectedItems[0].SubItems[2].Text -eq 'hidden') {
        $hideButton.Text = 'Show on log'
    } else {
        $hideButton.Text = 'Hide from log'
    }
})

$hideButton.Add_Click({
    $action = 'hide'
    if ($hideButton.Text -eq 'Show on log') { $action = 'show' }
    try { Request-SheetAction $action } catch { $resultLabel.Text = $_.Exception.Message }
})

$removeButton.Add_Click({
    try { Request-SheetAction 'remove' } catch { $resultLabel.Text = $_.Exception.Message }
})

$sendButton.Add_Click({
    $script:inbox = $inboxBox.Text.Trim()
    Save-InboxPath $script:inbox
    if ([string]::IsNullOrWhiteSpace($script:csvPath) -or [string]::IsNullOrWhiteSpace($script:inbox)) { return }
    $sendButton.Enabled = $false
    $resultLabel.Text = 'Sending...'
    $cmd = [powershell]::Create()
    [void]$cmd.AddScript({
        param($ScriptPath, $Csv, $Inbox)
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ScriptPath -Path $Csv -Inbox $Inbox -Force 2>&1 | ForEach-Object { "$_" }
        "EXIT:$LASTEXITCODE"
    }).AddArgument($script:CopyScript).AddArgument($script:csvPath).AddArgument($script:inbox)
    $script:sendCmd = $cmd
    $script:sendHandle = $cmd.BeginInvoke()
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.Add_Tick({
    Finish-StatusRead
    if ($null -eq $script:readHandle) { Start-StatusRead }
    if ($null -ne $script:sendHandle -and $script:sendHandle.IsCompleted) {
        $output = ''
        try {
            $lines = @($script:sendCmd.EndInvoke($script:sendHandle))
            $output = ($lines | ForEach-Object { [string]$_ }) -join "`n"
        } catch {
            $output = $_.Exception.Message
        } finally {
            $script:sendCmd.Dispose()
            $script:sendCmd = $null
            $script:sendHandle = $null
            Update-SendEnabled
        }
        $exit = 1
        $sentName = ''
        foreach ($line in ($output -split "`n")) {
            if ($line -match '^EXIT:(\d+)$') { $exit = [int]$Matches[1] }
            if ($line -match 'Sent .+ -> (.+\.csv)\s*$') { $sentName = $Matches[1].Trim() }
        }
        if ($exit -eq 0 -and $sentName) {
            $script:waitingFor = $sentName
            $resultLabel.Text = "Sent $sentName. Waiting for the station."
        } elseif ($exit -eq 0) {
            $resultLabel.Text = ($output -replace 'EXIT:\d+', '').Trim()
        } else {
            $clean = ($output -replace 'EXIT:\d+', '').Trim()
            if ([string]::IsNullOrWhiteSpace($clean)) { $clean = 'The file was not sent.' }
            $resultLabel.Text = $clean
        }
    }
})

$form.Add_Shown({ $timer.Start(); Start-StatusRead })
$form.Add_FormClosed({ $timer.Stop(); $timer.Dispose() })
[void]$form.ShowDialog()
