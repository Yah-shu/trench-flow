# Removes trench-flow from Windows: stops it, removes its shortcuts and start-at-login entry and its app folder,
# then asks before deleting your data (~\.trench-flow). ActivityWatch, Bun and ffmpeg are left installed.
#
#   irm https://raw.githubusercontent.com/Yah-shu/trench-flow/main/uninstall.ps1 | iex
#
# TRENCHFLOW_DELETE_DATA=1 deletes the data without asking, =0 keeps it without asking.
# TRENCHFLOW_HOME=<folder> if it was installed somewhere else than %LOCALAPPDATA%\trench-flow.

$ErrorActionPreference = 'Stop'
$Root = if ($env:TRENCHFLOW_HOME) { $env:TRENCHFLOW_HOME } else { Join-Path $env:LOCALAPPDATA 'trench-flow' }
$App = Join-Path $Root 'app'
$Data = if ($env:TRENCHFLOW_DIR) { $env:TRENCHFLOW_DIR } else { Join-Path $env:USERPROFILE '.trench-flow' }

function Say($m) { Write-Host ""; Write-Host "==> $m" -ForegroundColor Cyan }
function Info($m) { Write-Host "    $m" }

Say 'Stopping trench-flow'
$main = (Join-Path $App 'server\main.ts').ToLower()
$procs = Get-CimInstance Win32_Process -Filter "Name = 'bun.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains($main) }
foreach ($p in $procs) { Invoke-CimMethod -InputObject $p -MethodName Terminate | Out-Null; Info "stopped process $($p.ProcessId)" }
if (-not $procs) { Info 'it was not running' } else { Start-Sleep -Seconds 1 }

Say 'Removing shortcuts and start at login'
$shell = New-Object -ComObject WScript.Shell
foreach ($dir in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Startup'))) {
  $lnk = Join-Path $dir 'trench-flow.lnk'
  if (Test-Path $lnk) {
    # only ours: it points into the trench-flow app folder
    if ($shell.CreateShortcut($lnk).Arguments.ToLower().Contains($main)) { Remove-Item $lnk -Force; Info "removed $lnk" }
  }
}

Say 'Removing the app'
if (Test-Path $Root) { Remove-Item $Root -Recurse -Force; Info "removed $Root" } else { Info 'already gone' }

Say 'Your data'
if (Test-Path $Data) {
  $answer = $env:TRENCHFLOW_DELETE_DATA
  if ($answer -ne '1' -and $answer -ne '0') {
    $reply = Read-Host "    Delete your trench-flow data too (${Data}: settings, day summaries, screenshots)? Type yes to delete"
    $answer = if ($reply -eq 'yes') { '1' } else { '0' }
  }
  if ($answer -eq '1') { Remove-Item $Data -Recurse -Force; Info 'deleted' } else { Info "kept in $Data" }
} else { Info 'none found' }

Write-Host ''
Write-Host 'trench-flow is removed.' -ForegroundColor Green
Write-Host '  ActivityWatch is still installed (it has its own uninstaller in Settings -> Apps; remove'
Write-Host '  "ActivityWatch.lnk" from the Startup folder too if trench-flow added it). Bun and ffmpeg are still installed.'
