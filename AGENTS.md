# AGENTS.md — installing trench-flow for a person

You are an AI assistant (Claude Code, Codex, Cursor or similar) and someone asked you to install trench-flow from
https://github.com/Yah-shu/trench-flow on **their own computer**. Assume they are not a developer: a normal Windows 10/11
or macOS machine, possibly without git, Bun, Node, ffmpeg or Claude Code. Follow these steps in order, tell them in
plain words what you are doing, and stop to ask when a step needs them.

## Rules (read first)

- **Never** disable, pause or add exclusions to antivirus, Windows Defender, SmartScreen, Gatekeeper or the firewall,
  and never change security or privacy settings yourself. If something is blocked, stop and tell the person.
- **No admin / sudo** unless a step below says so (none of them need it). Don't run PowerShell as Administrator.
- Don't edit files outside the trench-flow folders (`%LOCALAPPDATA%\trench-flow` or `~/.local/share/trench-flow`)
  and the data folder (`~/.trench-flow`), except what the installer itself creates (shortcuts, login items).
- Don't open ActivityWatch's or trench-flow's port to the network, and don't change ActivityWatch's own settings.
- Don't turn the AI on for them or sign in to Claude for them. Explain the choice; they decide.
- Don't delete their data folder (`~/.trench-flow`) unless they explicitly ask.

## 1. Find out the system

- Windows: run `[Environment]::OSVersion.Version` in PowerShell (needs 10.0 or newer, 64-bit).
- macOS: run `sw_vers -productVersion` and `uname -m` (arm64 or x86_64).
- Anything else (Linux): tell them trench-flow's installers support Windows and macOS only; the manual steps in the
  README may still work.

## 2. Run the installer

Windows (PowerShell, not as Administrator):

```powershell
irm https://raw.githubusercontent.com/Yah-shu/trench-flow/main/install.ps1 | iex
```

macOS (Terminal):

```bash
curl -fsSL https://raw.githubusercontent.com/Yah-shu/trench-flow/main/install.sh | bash
```

It takes a few minutes. It installs what is missing (Bun; ActivityWatch; on Windows ffmpeg), downloads trench-flow,
installs its packages, builds it, adds the shortcuts and start-at-login, starts it and opens its window. It prints
`==>` lines per step and ends with "trench-flow is installed." The step "the optional local look-alike matcher" is a
large download that may fail on a slow line; that is fine and not an error to fix.

If it stops with an error, read the last `==>` step and the message, check the troubleshooting list below, fix what
it says (often: run it again — downloads can drop), and run the same line again. Running it again is always safe.

## 3. Check it works

trench-flow answers on port 7766:

```powershell
irm http://127.0.0.1:7766/api/health                                        # Windows
irm "http://127.0.0.1:7766/api/day/summary?date=$(Get-Date -Format yyyy-MM-dd)" | Select-Object date, devices
```

```bash
curl -s http://127.0.0.1:7766/api/health                                    # macOS
curl -s "http://127.0.0.1:7766/api/day/summary?date=$(date +%F)" | head -c 400
```

The health check must answer `{"ok":true,"app":"trench-flow",...}`, and the summary must answer with JSON.

ActivityWatch answers on port 5600:

```powershell
irm http://127.0.0.1:5600/api/0/info            # Windows
```

```bash
curl -s http://127.0.0.1:5600/api/0/info        # macOS
```

If 5600 doesn't answer: Windows — start "ActivityWatch" from the Start menu; macOS — `open -a ActivityWatch`. Then
check again. In the summary, `devices[0].online` should be `true` once ActivityWatch answers.

## 4. What only the person can do

Explain these and wait for them; you can open the screens, they click.

**macOS — Accessibility for ActivityWatch (needed):** System Settings → Privacy & Security → Accessibility → switch
on **ActivityWatch** (and **aw-watcher-window** if listed). Open the screen with:

```bash
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
```

Then restart ActivityWatch (quit it from its menu-bar icon, `open -a ActivityWatch`). Window titles appear within a
minute or two.

**macOS — Screen Recording (only if they want screenshots):** System Settings → Privacy & Security → Screen Recording →
**+** → add the `bun` program (the installer printed its path, usually `~/.bun/bin/bun`; press Cmd+Shift+G to paste a
path) → switch it on. Open the screen with:

```bash
open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
```

**Browser extension (optional, both systems):** websites show up only with ActivityWatch's browser extension
**aw-watcher-web** for Chrome, Edge or Firefox: https://github.com/ActivityWatch/aw-watcher-web#installation — they
install it from their browser's store page.

## 5. The AI (optional — ask them)

trench-flow works fully with the AI **Off**. With the AI on it names blocks of time, writes a day summary, answers
questions about the day and writes a standup, using Claude Haiku on **their own Claude plan** through the Claude Code
CLI (about 10–80k Haiku tokens a day depending on the level; it stops by itself at 93% of the plan's weekly limit).

Ask whether they want it. If yes and `claude --version` doesn't work, they can install Claude Code:

```powershell
irm https://claude.ai/install.ps1 | iex       # Windows
```

```bash
curl -fsSL https://claude.ai/install.sh | bash   # macOS
```

Then **they** run `claude` once in a terminal and sign in with their Claude account (you don't sign in for them).
Then they choose the level in trench-flow → Settings (gear icon) → AI level: Off, Low, Medium or High. If they don't
want the AI, have them choose **Off** (the default is Medium, which needs Claude Code).

## 6. Finish

Tell them:

- open trench-flow from the Start menu / desktop (Windows) or `~/Applications/trench-flow` (macOS);
- it starts hidden at every login, and the day fills in as they work; "sample data" on the page means the server
  isn't answering (start it from the shortcut);
- their data is in `~/.trench-flow` and never leaves the computer except what the AI level sends to Claude;
- update = run the install line again; uninstall = the line in the README (it asks before deleting data).

## Troubleshooting (with exact checks)

| Symptom | Check | Fix |
| --- | --- | --- |
| Installer: "Bun could not be installed" | `bun --version` | Install from https://bun.sh (their one-line installer), then run trench-flow's installer again. |
| Installer: "bun install failed" | internet connection | Run the installer again; downloads sometimes drop. |
| Installer: download blocked / script blocked by antivirus | the message | Stop and tell the person. Don't bypass it. |
| Health check fails (Windows) | `Get-CimInstance Win32_Process -Filter "Name='bun.exe'" \| Select-Object CommandLine` | Start the Start-menu shortcut "trench-flow"; read `$env:USERPROFILE\.trench-flow\logs\server.log`. |
| Health check fails (macOS) | `launchctl print gui/$(id -u)/net.trench-flow.server \| head -20` | `open ~/Applications/trench-flow.app`; read `~/.trench-flow/logs/server.log`. |
| Port 7766 taken by something else | Windows `Get-NetTCPConnection -LocalPort 7766`; macOS `lsof -iTCP:7766 -sTCP:LISTEN` | Re-run the installer with `$env:TRENCHFLOW_PORT='7800'` first (Windows) or `TRENCHFLOW_PORT=7800` before `bash` (macOS); the port is then kept in the app folder's `.env`. Use that port in the checks above. |
| Device offline / empty day | `http://127.0.0.1:5600/api/0/info` | Start ActivityWatch (step 3). |
| macOS: no window titles | Accessibility (step 4) | Ask the person to switch it on, restart ActivityWatch. |
| Windows screenshots missing | `ffmpeg -version` | Run the installer again (it installs ffmpeg); screenshots must also be on in Settings. |
| "could not start Claude Code" on the page | `claude --version` | Step 5, or set the AI level to Off. |

Logs: `~/.trench-flow/logs/server.log` (Windows `%USERPROFILE%\.trench-flow\logs\server.log`); AI call sizes (never
content) in `~/.trench-flow/logs/ai-YYYY-MM.jsonl`.

Files the installer creates: the app folder (`%LOCALAPPDATA%\trench-flow` / `~/.local/share/trench-flow`); on Windows
the shortcuts `trench-flow.lnk` in the Start menu, on the desktop and in the Startup folder (plus `ActivityWatch.lnk`
in Startup if ActivityWatch didn't start at login yet); on macOS `~/Applications/trench-flow.app` and the LaunchAgents
`net.trench-flow.server` and `net.trench-flow.activitywatch` in `~/Library/LaunchAgents`.
