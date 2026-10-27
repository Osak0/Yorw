param(
    [Parameter(Mandatory=$true)][string]$Executable,
    [Parameter(Mandatory=$true)][string]$ReportDirectory,
    [Parameter(Mandatory=$true)][string]$FixtureDirectory
)
$ErrorActionPreference = 'Stop'
$mvpExe = (Resolve-Path -LiteralPath $Executable).Path
$mvpFixtures = (Resolve-Path -LiteralPath $FixtureDirectory).Path
$mvpReport = [IO.Path]::GetFullPath($ReportDirectory)
if (Test-Path -LiteralPath $mvpReport) { throw 'Use a new report directory to preserve earlier evidence.' }
if (-not (Test-Path -LiteralPath (Join-Path $mvpFixtures 'fixture.pdf'))) { throw 'Missing self-authored fixture.pdf' }
New-Item -ItemType Directory -Path $mvpReport | Out-Null
Copy-Item -LiteralPath $mvpFixtures -Destination (Join-Path $mvpReport 'fixtures') -Recurse
Copy-Item -LiteralPath (Join-Path $mvpFixtures 'fixture.pdf') -Destination (Join-Path $mvpReport 'fixture.pdf')
$mvpOldEnvironment = @{}
foreach ($name in @('Path','PYTHONHOME','PYTHONPATH','VIRTUAL_ENV','ELECTRON_RUN_AS_NODE')) { $mvpOldEnvironment[$name] = [Environment]::GetEnvironmentVariable($name,'Process') }
$mvpTimer = [Diagnostics.Stopwatch]::StartNew()
try {
    # This checks bundled execution with no Node/Python lookup via PATH. It does not
    # turn this host into a clean Windows VM and must never be reported as one.
    $env:Path = "$env:SystemRoot\System32;$env:SystemRoot"
    foreach ($name in @('PYTHONHOME','PYTHONPATH','VIRTUAL_ENV','ELECTRON_RUN_AS_NODE')) { [Environment]::SetEnvironmentVariable($name,$null,'Process') }
    foreach ($mode in @('--mvp-smoke','--mvp-resume-smoke')) {
        $mvpChild = Start-Process -FilePath $mvpExe -ArgumentList @('--yorw-smoke','--reader-smoke',$mode,"--report-dir=`"$mvpReport`"") -WindowStyle Hidden -PassThru
        if (-not $mvpChild.WaitForExit(180000)) { $mvpChild.Kill(); throw "Timed out in $mode" }
        $mvpChild.WaitForExit()
        if ($mvpChild.ExitCode -ne 0) { throw "MVP verification failed in $mode; see report files." }
    }
    $mvpDesktop = Get-Content -LiteralPath (Join-Path $mvpReport 'desktop-smoke.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if (Test-Path -LiteralPath (Join-Path $mvpReport 'ai-state.json')) {
        $mvpState = Get-Content -LiteralPath (Join-Path $mvpReport 'ai-state.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        $mvpRestart = Get-Content -LiteralPath (Join-Path $mvpReport 'ai-restart.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        $mvpFlow = Get-Content -LiteralPath (Join-Path $mvpReport 'ai-workflow-smoke.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($mvpFlow.result -ne 'passed' -or -not $mvpFlow.appendRenumbered -or -not $mvpFlow.replace -or -not $mvpFlow.rollback -or -not $mvpFlow.crossDocumentScope -or $mvpFlow.textDocuments -ne 5 -or $mvpFlow.negativeDocuments -ne 3 -or -not $mvpRestart.wiki -or -not $mvpRestart.note -or $mvpRestart.pendingStatus -ne 'interrupted') { throw 'Missing v0.2 workflow/recovery proof' }
        $mvpPending = $mvpRestart.pendingStatus
        $mvpKinds = @($mvpState.source_kinds)
        # Read PRAGMA user_version from the isolated workspace header (offset 60,
        # big-endian) instead of asserting the expected schema in the report.
        $mvpDatabase = Join-Path $mvpReport 'workspace/yorw.sqlite3'
        if (-not (Test-Path -LiteralPath $mvpDatabase)) { throw 'Workspace database missing' }
        $mvpBytes = [IO.File]::ReadAllBytes($mvpDatabase)
        if ($mvpBytes.Length -lt 64 -or [Text.Encoding]::ASCII.GetString($mvpBytes,0,15) -ne 'SQLite format 3') { throw 'Invalid workspace database' }
        $mvpSchema = [BitConverter]::ToInt32([byte[]]@($mvpBytes[63],$mvpBytes[62],$mvpBytes[61],$mvpBytes[60]),0)
        if ($mvpSchema -ne 15) { throw "Unexpected schema version: $mvpSchema" }
    } else {
        # Keep the original v0.1 release's embedded smoke protocol reproducible.
        $mvpState = Get-Content -LiteralPath (Join-Path $mvpReport 'mvp-state.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        $mvpRestart = Get-Content -LiteralPath (Join-Path $mvpReport 'mvp-restart.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        $mvpFault = Get-Content -LiteralPath (Join-Path $mvpReport 'mvp-fault.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        if (-not $mvpRestart.saved_wiki -or -not $mvpRestart.saved_note -or $mvpRestart.pending_status -ne 'interrupted' -or -not $mvpFault.service_exit_detected) { throw 'Missing v0.1 workflow/recovery proof' }
        $mvpSchema = 9
        $mvpPending = $mvpRestart.pending_status
        $mvpKinds = @($mvpRestart.source_kinds)
    }
    if ($mvpDesktop.nodeExposed -or $mvpDesktop.status.state -ne 'ready') { throw 'Desktop isolation/restart failed' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $mvpArchive = [IO.Compression.ZipFile]::OpenRead($mvpState.export_path)
    try {
        $mvpEntry = $mvpArchive.GetEntry("wiki/$($mvpState.topic_id).md")
        if (-not $mvpEntry) { throw 'Wiki missing from export' }
        $mvpReader = New-Object IO.StreamReader($mvpEntry.Open(),[Text.Encoding]::UTF8)
        try { if ($mvpReader.ReadToEnd() -cne $mvpState.body_md) { throw 'Export differs from saved Wiki' } }
        finally { $mvpReader.Dispose() }
    } finally { $mvpArchive.Dispose() }
    $mvpSummary = [ordered]@{ result='passed'; executable_sha256=(Get-FileHash -LiteralPath $mvpExe -Algorithm SHA256).Hash; version=(Get-Item -LiteralPath $mvpExe).VersionInfo.ProductVersion; schema_version=$mvpSchema; runtime_path_restricted=$true; clean_windows_verified=$false; text_documents=5; negative_documents=3; source_kinds=$mvpKinds; pending_status=$mvpPending; duration_seconds=[math]::Round($mvpTimer.Elapsed.TotalSeconds,2) }
    $mvpSummary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $mvpReport 'verification.json') -Encoding UTF8
    Write-Output "MVP workflow and recovery passed. Evidence: $mvpReport"
} finally {
    foreach ($name in $mvpOldEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name,$mvpOldEnvironment[$name],'Process') }
}
