# trench-flow installer for Windows 10/11. Run it again any time to update (your data is kept).
#
#   irm https://raw.githubusercontent.com/Yah-shu/trench-flow/main/install.ps1 | iex
#
# No admin rights needed. What it does, in order:
#   1. Bun (the JavaScript runtime trench-flow runs on), if it is missing
#   2. ActivityWatch (records which window is in front), if it is missing, and starts it at login
#   3. ffmpeg (only used for the optional screenshots), if it is missing
#   4. downloads trench-flow into %LOCALAPPDATA%\trench-flow\app, installs its packages and builds the page
#   5. a "trench-flow" shortcut in the Start menu and on the desktop, and starts trench-flow at login (hidden)
#   6. starts trench-flow and opens its window
#
# Options (set before running, e.g.  $env:TRENCHFLOW_NO_AUTOSTART = '1'):
#   TRENCHFLOW_NO_AUTOSTART=1   don't start trench-flow at login
#   TRENCHFLOW_NO_DESKTOP=1     no desktop shortcut
#   TRENCHFLOW_NO_SHORTCUTS=1   no shortcuts at all (implies no autostart)
#   TRENCHFLOW_NO_LAUNCH=1      don't start it at the end
#   TRENCHFLOW_NO_MATCHER=1     skip the optional local look-alike matcher (~450 MB download)
#   TRENCHFLOW_SKIP_DEPS=1      don't check or install ActivityWatch and ffmpeg
#   TRENCHFLOW_PORT=7766        the port it runs on
#   TRENCHFLOW_HOME=<folder>    install somewhere else than %LOCALAPPDATA%\trench-flow
#   TRENCHFLOW_SOURCE=<folder>  install from a local copy instead of downloading (for testing)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

$Repo = 'Yah-shu/trench-flow'
$ZipUrl = if ($env:TRENCHFLOW_ZIP_URL) { $env:TRENCHFLOW_ZIP_URL } else { "https://github.com/$Repo/archive/refs/heads/main.zip" }
$Root = if ($env:TRENCHFLOW_HOME) { $env:TRENCHFLOW_HOME } else { Join-Path $env:LOCALAPPDATA 'trench-flow' }
$App = Join-Path $Root 'app'
$Tools = Join-Path $Root 'tools'
$Port = if ($env:TRENCHFLOW_PORT) { [int]$env:TRENCHFLOW_PORT } else { 7766 }
# a port kept from an earlier install (the app folder's .env)
if (-not $env:TRENCHFLOW_PORT -and (Test-Path (Join-Path $App '.env'))) {
  $m = Select-String -Path (Join-Path $App '.env') -Pattern '^\s*TRENCHFLOW_PORT=(\d+)' | Select-Object -Last 1
  if ($m) { $Port = [int]$m.Matches[0].Groups[1].Value }
}
$AwVersion = 'v0.14.1'
$DataDir = if ($env:TRENCHFLOW_DIR) { $env:TRENCHFLOW_DIR } else { Join-Path $env:USERPROFILE '.trench-flow' }

function Say($m) { Write-Host ""; Write-Host "==> $m" -ForegroundColor Cyan }
function Info($m) { Write-Host "    $m" }
function Warn($m) { Write-Host "    ! $m" -ForegroundColor Yellow }
function On($name) { return [Environment]::GetEnvironmentVariable($name) -eq '1' }
function Have-Winget { return [bool](Get-Command winget.exe -ErrorAction SilentlyContinue) }

# Runs a program and shows its output. Programs write progress to stderr; PowerShell 5.1 would turn that into an
# error when the output is captured (as when an AI assistant runs this), so errors are judged by the exit code only.
function Run($exe, [string[]]$arguments) {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $exe @arguments 2>&1 | ForEach-Object { Write-Host "    $_" }
    return $LASTEXITCODE
  } finally { $ErrorActionPreference = $old }
}

function Test-Url($url) {
  try { $r = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 3; return $r.StatusCode -eq 200 } catch { return $false }
}

function Get-File($url, $out) {
  for ($i = 1; $i -le 3; $i++) {
    try { Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $out; return } catch {
      if ($i -eq 3) { throw }
      Warn "download failed ($($_.Exception.Message)), trying again"
      Start-Sleep -Seconds 3
    }
  }
}

if ([Environment]::OSVersion.Version.Major -lt 10) { throw 'trench-flow needs Windows 10 or 11.' }
if (-not [Environment]::Is64BitOperatingSystem) { throw 'trench-flow needs 64-bit Windows.' }
New-Item -ItemType Directory -Force -Path $Root, $Tools | Out-Null

# ---------- 1. Bun ----------

function Find-Bun {
  $c = @()
  if ($env:TRENCHFLOW_BUN) { $c += $env:TRENCHFLOW_BUN }
  $c += (Join-Path $env:USERPROFILE '.bun\bin\bun.exe')
  $cmd = Get-Command bun.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($cmd) { $c += $cmd.Source }
  $c += (Join-Path $env:APPDATA 'npm\node_modules\bun\bin\bun.exe')
  $c += (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\bun.exe')
  $pk = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
  if (Test-Path $pk) { Get-ChildItem $pk -Directory -Filter 'Oven-sh.Bun*' | ForEach-Object { Get-ChildItem $_.FullName -Recurse -Filter bun.exe -ErrorAction SilentlyContinue | ForEach-Object { $c += $_.FullName } } }
  foreach ($p in $c) { if ($p -and (Test-Path $p) -and $p.ToLower().EndsWith('.exe')) { return (Resolve-Path $p).Path } }
  return $null
}

Say 'Bun'
$Bun = Find-Bun
if (-not $Bun) {
  Info 'not found, installing it (from bun.sh)'
  try {
    $null = Run 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://bun.sh/install.ps1 | iex')
  } catch { Warn "the bun.sh installer failed: $($_.Exception.Message)" }
  $Bun = Find-Bun
  if (-not $Bun -and (Have-Winget)) {
    Info 'trying winget instead'
    $null = Run 'winget.exe' @('install', '--id', 'Oven-sh.Bun', '-e', '--scope', 'user', '--silent', '--accept-package-agreements', '--accept-source-agreements')
    $Bun = Find-Bun
  }
  if (-not $Bun) { throw 'Bun could not be installed. Install it from https://bun.sh and run this again.' }
}
$old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$bunVersion = (& $Bun --version 2>&1 | Select-Object -First 1)
$ErrorActionPreference = $old
Info "using $Bun ($bunVersion)"

# ---------- 2. ActivityWatch ----------

function Find-AwQt {
  $c = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\ActivityWatch\aw-qt.exe'),
    (Join-Path $env:ProgramFiles 'ActivityWatch\aw-qt.exe')
  )
  if (${env:ProgramFiles(x86)}) { $c += (Join-Path ${env:ProgramFiles(x86)} 'ActivityWatch\aw-qt.exe') }
  foreach ($key in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
    if (Test-Path $key) {
      Get-ChildItem $key -ErrorAction SilentlyContinue | ForEach-Object {
        if ("$($_.GetValue('DisplayName'))" -like '*ActivityWatch*') { $loc = $_.GetValue('InstallLocation'); if ($loc) { $c += (Join-Path $loc 'aw-qt.exe') } }
      }
    }
  }
  $p = Get-Process aw-qt -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($p -and $p.Path) { $c += $p.Path }
  foreach ($x in $c) { if ($x -and (Test-Path $x)) { return $x } }
  return $null
}

$Startup = [Environment]::GetFolderPath('Startup')
$Programs = [Environment]::GetFolderPath('Programs')
$Desktop = [Environment]::GetFolderPath('Desktop')
$Shell = New-Object -ComObject WScript.Shell

function New-Shortcut($path, $target, $arguments, $workdir, $icon, $description, $style) {
  $s = $Shell.CreateShortcut($path)
  $s.TargetPath = $target
  $s.Arguments = $arguments
  $s.WorkingDirectory = $workdir
  if ($icon) { $s.IconLocation = $icon }
  $s.Description = $description
  $s.WindowStyle = $style
  $s.Save()
}

function AwStartsAtLogin {
  $lnk = Get-ChildItem $Startup -Filter '*.lnk' -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*ActivityWatch*' -or $Shell.CreateShortcut($_.FullName).TargetPath -like '*aw-qt*' }
  if ($lnk) { return $true }
  $run = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue
  if ($run) { foreach ($v in $run.PSObject.Properties) { if ("$($v.Value)" -like '*aw-qt*') { return $true } } }
  return $false
}

if (-not (On 'TRENCHFLOW_SKIP_DEPS')) {
  Say 'ActivityWatch'
  $awRunning = Test-Url 'http://127.0.0.1:5600/api/0/info'
  $awQt = Find-AwQt
  if (-not $awQt -and -not $awRunning) {
    Info 'not found, installing it'
    if (Have-Winget) {
      $null = Run 'winget.exe' @('install', '--id', 'ActivityWatch.ActivityWatch', '-e', '--scope', 'user', '--silent', '--accept-package-agreements', '--accept-source-agreements')
      $awQt = Find-AwQt
      if (-not $awQt) {
        $null = Run 'winget.exe' @('install', '--id', 'ActivityWatch.ActivityWatch', '-e', '--silent', '--accept-package-agreements', '--accept-source-agreements')
        $awQt = Find-AwQt
      }
    }
    if (-not $awQt) {
      Info "downloading the official installer ($AwVersion) from GitHub"
      $setup = Join-Path $env:TEMP "activitywatch-$AwVersion-setup.exe"
      Get-File "https://github.com/ActivityWatch/activitywatch/releases/download/$AwVersion/activitywatch-$AwVersion-windows-x86_64-setup.exe" $setup
      Start-Process -FilePath $setup -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -Wait
      Remove-Item $setup -Force -ErrorAction SilentlyContinue
      $awQt = Find-AwQt
    }
    if (-not $awQt) { Warn 'ActivityWatch could not be installed. Get it from https://activitywatch.net and run this again.' }
  } elseif ($awRunning -and -not $awQt) {
    Info 'already running on port 5600 (installed somewhere else) - leaving it as it is'
  } else {
    Info "found $awQt"
  }
  if ($awQt) {
    if (-not (AwStartsAtLogin)) {
      New-Shortcut (Join-Path $Startup 'ActivityWatch.lnk') $awQt '' (Split-Path $awQt) $awQt 'ActivityWatch (started at login for trench-flow)' 7
      Info 'starts at login now'
    } else {
      Info 'already starts at login'
    }
    if (-not (Test-Url 'http://127.0.0.1:5600/api/0/info')) {
      Start-Process -FilePath $awQt -WorkingDirectory (Split-Path $awQt)
      Info 'started'
    }
  }

  Say 'ffmpeg (for the optional screenshots)'
  $ff = Get-Command ffmpeg.exe -CommandType Application -ErrorAction SilentlyContinue
  $ffLocal = Join-Path $Tools 'ffmpeg\bin\ffmpeg.exe'
  $ffLinks = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\ffmpeg.exe'
  if ($ff -or (Test-Path $ffLocal) -or (Test-Path $ffLinks)) {
    Info 'found'
  } else {
    $done = $false
    if (Have-Winget) {
      $done = (Run 'winget.exe' @('install', '--id', 'Gyan.FFmpeg', '-e', '--scope', 'user', '--silent', '--accept-package-agreements', '--accept-source-agreements')) -eq 0
    }
    if (-not $done) {
      try {
        Info 'downloading a build from GitHub (BtbN/FFmpeg-Builds)'
        $zip = Join-Path $env:TEMP 'trench-flow-ffmpeg.zip'
        Get-File 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip' $zip
        $x = Join-Path $env:TEMP 'trench-flow-ffmpeg'
        Remove-Item $x -Recurse -Force -ErrorAction SilentlyContinue
        Expand-Archive $zip -DestinationPath $x -Force
        $inner = Get-ChildItem $x -Directory | Select-Object -First 1
        Remove-Item (Join-Path $Tools 'ffmpeg') -Recurse -Force -ErrorAction SilentlyContinue
        Move-Item $inner.FullName (Join-Path $Tools 'ffmpeg')
        Remove-Item $zip, $x -Recurse -Force -ErrorAction SilentlyContinue
        $done = $true
      } catch { Warn "ffmpeg could not be installed ($($_.Exception.Message)). Everything works without it except screenshots." }
    }
    if ($done) { Info 'installed' }
  }
}

# ---------- 4. trench-flow itself ----------

Say 'Stopping a running trench-flow (if any)'
$main = (Join-Path $App 'server\main.ts').ToLower()
$procs = Get-CimInstance Win32_Process -Filter "Name = 'bun.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains($main) }
foreach ($p in $procs) { Invoke-CimMethod -InputObject $p -MethodName Terminate | Out-Null; Info "stopped process $($p.ProcessId)" }
if ($procs) { Start-Sleep -Seconds 1 }

Say 'Getting trench-flow'
$stage = Join-Path $Root 'app.new'
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
if ($env:TRENCHFLOW_SOURCE) {
  Info "copying $($env:TRENCHFLOW_SOURCE)"
  New-Item -ItemType Directory -Force -Path $stage | Out-Null
  Get-ChildItem $env:TRENCHFLOW_SOURCE -Force | Where-Object { @('node_modules', '.git', 'dist') -notcontains $_.Name } | Copy-Item -Destination $stage -Recurse -Force
} else {
  Info "downloading $ZipUrl"
  $zip = Join-Path $env:TEMP 'trench-flow-main.zip'
  Get-File $ZipUrl $zip
  $x = Join-Path $env:TEMP 'trench-flow-unzip'
  Remove-Item $x -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive $zip -DestinationPath $x -Force
  $inner = Get-ChildItem $x -Directory | Select-Object -First 1
  Move-Item $inner.FullName $stage
  Remove-Item $zip, $x -Recurse -Force -ErrorAction SilentlyContinue
}
# keep the installed packages across updates (bun install brings them up to date)
if (Test-Path (Join-Path $App 'node_modules')) { Move-Item (Join-Path $App 'node_modules') (Join-Path $stage 'node_modules') }
# and your own settings file, if you made one
if (Test-Path (Join-Path $App '.env')) { Copy-Item (Join-Path $App '.env') (Join-Path $stage '.env') -Force }
if ($env:TRENCHFLOW_PORT) {
  $envFile = Join-Path $stage '.env'
  $lines = @(); if (Test-Path $envFile) { $lines = @(Get-Content $envFile | Where-Object { $_ -notmatch '^\s*TRENCHFLOW_PORT=' }) }
  Set-Content -Path $envFile -Value ($lines + "TRENCHFLOW_PORT=$Port") -Encoding ASCII
}
Remove-Item $App -Recurse -Force -ErrorAction SilentlyContinue
Move-Item $stage $App
Info "in $App"

Say 'Installing packages'
Push-Location $App
try {
  $ok = $false
  for ($i = 1; $i -le 3 -and -not $ok; $i++) {
    $ok = (Run $Bun @('install')) -eq 0
    if (-not $ok -and $i -lt 3) { Warn 'install failed, trying again'; Start-Sleep -Seconds 3 }
  }
  if (-not $ok) { throw 'bun install failed. Check your internet connection and run this again.' }
  if (-not (On 'TRENCHFLOW_NO_MATCHER')) {
    Info 'the optional local look-alike matcher (large download; fine to fail)'
    if ((Run $Bun @('run', 'add-matcher')) -ne 0) { Warn 'skipped: trench-flow works without it (run "bun run add-matcher" in the app folder later to retry)' }
  }
  Say 'Building the page'
  if ((Run $Bun @('run', 'build')) -ne 0) { throw 'the build failed.' }
} finally { Pop-Location }

# ---------- 5. shortcuts and autostart ----------

$conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
$icon = Join-Path $App 'assets\icon.ico'
$mainTs = Join-Path $App 'server\main.ts'
# conhost --headless runs bun with no console window; the app opens its own window (Edge/Chrome app mode).
$openArgs = "--headless `"$Bun`" `"$mainTs`" --background"
$bgArgs = "$openArgs --no-open"
$autoLnk = Join-Path $Startup 'trench-flow.lnk'

if (-not (On 'TRENCHFLOW_NO_SHORTCUTS')) {
  Say 'Shortcuts'
  New-Shortcut (Join-Path $Programs 'trench-flow.lnk') $conhost $openArgs $App $icon 'trench-flow: see where your day went' 7
  Info 'Start menu: trench-flow'
  if (-not (On 'TRENCHFLOW_NO_DESKTOP')) {
    New-Shortcut (Join-Path $Desktop 'trench-flow.lnk') $conhost $openArgs $App $icon 'trench-flow: see where your day went' 7
    Info 'Desktop: trench-flow'
  }
  if (-not (On 'TRENCHFLOW_NO_AUTOSTART')) {
    New-Shortcut $autoLnk $conhost $bgArgs $App $icon 'trench-flow (starts hidden at login)' 7
    Info 'starts at login (hidden)'
  } elseif (Test-Path $autoLnk) {
    Remove-Item $autoLnk -Force
    Info 'start at login: off'
  }
}

# ---------- 6. start ----------

$url = "http://127.0.0.1:$Port/"
if (-not (On 'TRENCHFLOW_NO_LAUNCH')) {
  Say 'Starting trench-flow'
  Start-Process -FilePath $conhost -ArgumentList $openArgs -WorkingDirectory $App
  $up = $false
  for ($i = 0; $i -lt 40 -and -not $up; $i++) { Start-Sleep -Milliseconds 500; $up = Test-Url "${url}api/health" }
  if ($up) { Info "running at $url" } else { Warn "it did not answer yet; open the trench-flow shortcut, or see $DataDir\logs\server.log" }
}

Write-Host ''
Write-Host 'trench-flow is installed.' -ForegroundColor Green
Write-Host @"

  Open it:    Start menu -> trench-flow   (or $url)
  Your data:  $DataDir   (stays on this computer)

  Optional next steps
  - Websites: install the ActivityWatch browser extension "aw-watcher-web" (Chrome, Edge, Firefox):
      https://github.com/ActivityWatch/aw-watcher-web#installation
  - AI summaries (optional, uses your own Claude plan): install Claude Code
      irm https://claude.ai/install.ps1 | iex
    then run  claude  once and sign in. In trench-flow open Settings -> AI level (Off works fully without it).
  - Screenshots are off until you turn them on in Settings.

  Update: run the install line again.   Remove: irm https://raw.githubusercontent.com/$Repo/main/uninstall.ps1 | iex
"@
