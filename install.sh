#!/bin/bash
# trench-flow installer for macOS. Run it again any time to update (your data is kept).
#
#   curl -fsSL https://raw.githubusercontent.com/Yah-shu/trench-flow/main/install.sh | bash
#
# No admin password needed. What it does, in order:
#   1. Bun (the JavaScript runtime trench-flow runs on), if it is missing
#   2. ActivityWatch (records which window is in front), if it is missing, and starts it at login
#   3. downloads trench-flow into ~/.local/share/trench-flow/app, installs its packages and builds the page
#   4. starts trench-flow at login, hidden (a LaunchAgent), and adds "trench-flow" to ~/Applications
#   5. starts it, opens its window, and shows the two permission screens macOS needs you to switch on
#
# Options (put them before "bash", e.g.  curl -fsSL ... | TRENCHFLOW_NO_AUTOSTART=1 bash):
#   TRENCHFLOW_NO_AUTOSTART=1   don't start trench-flow at login
#   TRENCHFLOW_NO_LAUNCH=1      don't start it at the end
#   TRENCHFLOW_NO_PROMPTS=1     don't open the System Settings permission screens
#   TRENCHFLOW_NO_MATCHER=1     skip the optional local look-alike matcher (~450 MB download)
#   TRENCHFLOW_SKIP_DEPS=1      don't check or install ActivityWatch
#   TRENCHFLOW_PORT=7766        the port it runs on
#   TRENCHFLOW_HOME=<folder>    install somewhere else than ~/.local/share/trench-flow
#   TRENCHFLOW_SOURCE=<folder>  install from a local copy instead of downloading (for testing)
set -euo pipefail

REPO="Yah-shu/trench-flow"
ZIP_URL="${TRENCHFLOW_ZIP_URL:-https://github.com/$REPO/archive/refs/heads/main.zip}"
ROOT="${TRENCHFLOW_HOME:-$HOME/.local/share/trench-flow}"
APP="$ROOT/app"
DATA="${TRENCHFLOW_DIR:-$HOME/.trench-flow}"
PORT="${TRENCHFLOW_PORT:-}"
# a port kept from an earlier install (the app folder's .env)
[ -z "$PORT" ] && [ -f "$APP/.env" ] && PORT="$(sed -n 's/^[[:space:]]*TRENCHFLOW_PORT=\([0-9]*\).*/\1/p' "$APP/.env" | tail -1)"
PORT="${PORT:-7766}"
AW_VERSION="v0.14.1"
AGENTS="$HOME/Library/LaunchAgents"
SERVER_LABEL="net.trench-flow.server"
AW_LABEL="net.trench-flow.activitywatch"
APP_BUNDLE="$HOME/Applications/trench-flow.app"
UID_NOW="$(id -u)"

say() { printf '\n==> %s\n' "$1"; }
info() { printf '    %s\n' "$1"; }
warn() { printf '    ! %s\n' "$1"; }
on() { [ "${!1:-}" = "1" ]; }
answers() { curl -fs --max-time 3 "$1" >/dev/null 2>&1; }
fetch() {
  local i
  for i in 1 2 3; do
    if curl -fL --retry 2 -o "$2" "$1"; then return 0; fi
    warn "download failed, trying again"
    sleep 3
  done
  return 1
}

[ "$(uname -s)" = "Darwin" ] || { echo "This installer is for macOS. On Windows use install.ps1 (see the README)."; exit 1; }
ARCH="$(uname -m)"; [ "$ARCH" = "arm64" ] || ARCH="x86_64"
mkdir -p "$ROOT" "$DATA/logs" "$AGENTS" "$HOME/Applications"

# ---------- 1. Bun ----------

find_bun() {
  local c
  for c in "${TRENCHFLOW_BUN:-}" "$HOME/.bun/bin/bun" "$(command -v bun 2>/dev/null || true)" /opt/homebrew/bin/bun /usr/local/bin/bun; do
    if [ -n "$c" ] && [ -x "$c" ]; then echo "$c"; return 0; fi
  done
  return 1
}

say "Bun"
BUN="$(find_bun || true)"
if [ -z "$BUN" ]; then
  info "not found, installing it (from bun.sh)"
  curl -fsSL https://bun.sh/install | bash || warn "the bun.sh installer failed"
  BUN="$(find_bun || true)"
  [ -n "$BUN" ] || { echo "Bun could not be installed. Install it from https://bun.sh and run this again."; exit 1; }
fi
info "using $BUN ($("$BUN" --version))"

# ---------- 2. ActivityWatch ----------

find_aw() {
  local c
  for c in /Applications/ActivityWatch.app "$HOME/Applications/ActivityWatch.app"; do
    if [ -d "$c" ]; then echo "$c"; return 0; fi
  done
  return 1
}

write_agent() { # label, plist body (the <dict> contents)
  local file="$AGENTS/$1.plist"
  cat > "$file" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$1</string>
$2
</dict>
</plist>
PLIST
  launchctl bootout "gui/$UID_NOW/$1" 2>/dev/null || true
  launchctl bootstrap "gui/$UID_NOW" "$file" 2>/dev/null || launchctl load -w "$file" 2>/dev/null || warn "could not load $file (it will still run at the next login)"
}

xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

if ! on TRENCHFLOW_SKIP_DEPS; then
  say "ActivityWatch"
  AW_APP="$(find_aw || true)"
  if [ -z "$AW_APP" ] && answers http://127.0.0.1:5600/api/0/info; then
    info "already running on port 5600 (installed somewhere else) - leaving it as it is"
  else
    if [ -z "$AW_APP" ]; then
      info "not found, downloading the official $AW_VERSION ($ARCH) from GitHub"
      TMP="$(mktemp -d)"
      fetch "https://github.com/ActivityWatch/activitywatch/releases/download/$AW_VERSION/activitywatch-$AW_VERSION-macos-$ARCH.dmg" "$TMP/aw.dmg"
      MNT="$(hdiutil attach -nobrowse -readonly "$TMP/aw.dmg" | awk -F'\t' '/\/Volumes\//{print $NF}' | tail -1)"
      SRC="$(ls -d "$MNT"/*.app | head -1)"
      if [ -w /Applications ]; then AW_APP="/Applications/ActivityWatch.app"; else AW_APP="$HOME/Applications/ActivityWatch.app"; fi
      cp -R "$SRC" "$AW_APP"
      hdiutil detach "$MNT" -quiet || true
      rm -rf "$TMP"
      info "installed in $AW_APP"
    else
      info "found $AW_APP"
    fi
    # start at login: unless ActivityWatch already set that up itself
    if ls "$AGENTS" 2>/dev/null | grep -i activitywatch | grep -qv "$AW_LABEL"; then
      info "already starts at login"
    else
      write_agent "$AW_LABEL" "  <key>ProgramArguments</key><array><string>/usr/bin/open</string><string>-a</string><string>$(xml "$AW_APP")</string></array>
  <key>RunAtLoad</key><true/>"
      info "starts at login now"
    fi
    answers http://127.0.0.1:5600/api/0/info || { open "$AW_APP" || true; info "started"; }
  fi
fi

# ---------- 3. trench-flow itself ----------

say "Stopping a running trench-flow (if any)"
launchctl bootout "gui/$UID_NOW/$SERVER_LABEL" 2>/dev/null && info "stopped the login agent" || true
pkill -f "$APP/server/main.ts" 2>/dev/null && info "stopped" || true

say "Getting trench-flow"
STAGE="$ROOT/app.new"
rm -rf "$STAGE"
if [ -n "${TRENCHFLOW_SOURCE:-}" ]; then
  info "copying $TRENCHFLOW_SOURCE"
  mkdir -p "$STAGE"
  (cd "$TRENCHFLOW_SOURCE" && tar --exclude ./node_modules --exclude ./.git --exclude ./dist -cf - .) | (cd "$STAGE" && tar -xf -)
else
  info "downloading $ZIP_URL"
  TMP="$(mktemp -d)"
  fetch "$ZIP_URL" "$TMP/app.zip"
  unzip -q "$TMP/app.zip" -d "$TMP/x"
  mv "$(ls -d "$TMP"/x/*/ | head -1)" "$STAGE"
  rm -rf "$TMP"
fi
# keep the installed packages across updates (bun install brings them up to date)
[ -d "$APP/node_modules" ] && mv "$APP/node_modules" "$STAGE/node_modules"
# and your own settings file, if you made one
[ -f "$APP/.env" ] && cp "$APP/.env" "$STAGE/.env"
if [ -n "${TRENCHFLOW_PORT:-}" ]; then
  { [ -f "$STAGE/.env" ] && grep -v '^[[:space:]]*TRENCHFLOW_PORT=' "$STAGE/.env" || true; echo "TRENCHFLOW_PORT=$PORT"; } > "$STAGE/.env.tmp"
  mv "$STAGE/.env.tmp" "$STAGE/.env"
fi
rm -rf "$APP"
mv "$STAGE" "$APP"
info "in $APP"

say "Installing packages"
cd "$APP"
ok=0
for i in 1 2 3; do
  if "$BUN" install; then ok=1; break; fi
  warn "install failed, trying again"; sleep 3
done
[ "$ok" = 1 ] || { echo "bun install failed. Check your internet connection and run this again."; exit 1; }
if ! on TRENCHFLOW_NO_MATCHER; then
  info "the optional local look-alike matcher (large download; fine to fail)"
  "$BUN" run add-matcher || warn 'skipped: trench-flow works without it (run "bun run add-matcher" in the app folder later to retry)'
fi

say "Building the page"
"$BUN" run build

# ---------- 4. start at login, and the app in ~/Applications ----------

PATH_FOR_AGENT="$(dirname "$BUN"):$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
if ! on TRENCHFLOW_NO_AUTOSTART; then
  say "Start at login"
  write_agent "$SERVER_LABEL" "  <key>ProgramArguments</key><array><string>$(xml "$BUN")</string><string>$(xml "$APP/server/main.ts")</string><string>--no-open</string></array>
  <key>WorkingDirectory</key><string>$(xml "$APP")</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(xml "$PATH_FOR_AGENT")</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$(xml "$DATA/logs/server.log")</string>
  <key>StandardErrorPath</key><string>$(xml "$DATA/logs/server.log")</string>"
  info "trench-flow starts hidden when you log in"
else
  rm -f "$AGENTS/$SERVER_LABEL.plist"
fi

say "The trench-flow app"
# A tiny AppleScript app: it starts trench-flow if it isn't running, then opens the window.
SCRIPT_DIR="$(mktemp -d)"
SCRIPT="$SCRIPT_DIR/trench-flow.applescript"
# single-quoted shell words inside an AppleScript string: ' becomes '\'' and that backslash is doubled for AppleScript
q() { printf '%s' "$1" | sed -e "s/'/'\\\\\\\\''/g"; }
cat > "$SCRIPT" <<APPLESCRIPT
do shell script "export PATH='$(q "$PATH_FOR_AGENT")'; cd '$(q "$APP")' && '$(q "$BUN")' '$(q "$APP/server/main.ts")' --background > /dev/null 2>&1 &"
APPLESCRIPT
rm -rf "$APP_BUNDLE"
osacompile -o "$APP_BUNDLE" "$SCRIPT"
rm -rf "$SCRIPT_DIR"
cp "$APP/assets/icon.icns" "$APP_BUNDLE/Contents/Resources/applet.icns"
touch "$APP_BUNDLE"
info "$APP_BUNDLE (find it in Launchpad or Spotlight: trench-flow)"

# ---------- 5. start, and the permissions ----------

URL="http://127.0.0.1:$PORT/"
if ! on TRENCHFLOW_NO_LAUNCH; then
  say "Starting trench-flow"
  open "$APP_BUNDLE"
  for i in $(seq 1 40); do answers "${URL}api/health" && break; sleep 0.5; done
  if answers "${URL}api/health"; then info "running at $URL"; else warn "it did not answer yet; open trench-flow from ~/Applications, or see $DATA/logs/server.log"; fi
fi

say "Two switches only you can turn on (macOS asks you, not the installer)"
echo "    1. Accessibility -> switch ON 'ActivityWatch' (and 'aw-watcher-window' if it is listed)."
echo "       Without it ActivityWatch can't see window titles."
echo "    2. Screen Recording -> only needed if you turn on screenshots in trench-flow's Settings."
echo "       Add 'bun' with the + button (press Cmd+Shift+G and paste: $BUN), and switch it ON."
echo "       If ActivityWatch asks for Screen Recording too, allow it."
if ! on TRENCHFLOW_NO_PROMPTS; then
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility" || true
fi

cat <<DONE

trench-flow is installed.

  Open it:    ~/Applications/trench-flow  (or $URL)
  Your data:  $DATA   (stays on this Mac)

  Optional next steps
  - Websites: install the ActivityWatch browser extension "aw-watcher-web" (Chrome, Edge, Firefox):
      https://github.com/ActivityWatch/aw-watcher-web#installation
  - AI summaries (optional, uses your own Claude plan): install Claude Code
      curl -fsSL https://claude.ai/install.sh | bash
    then run  claude  once and sign in. In trench-flow open Settings -> AI level (Off works fully without it).
  - Screenshots are off until you turn them on in Settings (then allow Screen Recording, step 2 above).

  Update: run the install line again.
  Remove: curl -fsSL https://raw.githubusercontent.com/$REPO/main/uninstall.sh | bash
DONE
