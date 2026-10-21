#!/bin/bash
# Removes trench-flow from macOS: stops it, removes its login agents, the app in ~/Applications and its folder,
# then asks before deleting your data (~/.trench-flow). ActivityWatch and Bun are left installed.
#
#   curl -fsSL https://raw.githubusercontent.com/Yah-shu/trench-flow/main/uninstall.sh | bash
#
# TRENCHFLOW_DELETE_DATA=1 deletes the data without asking, =0 keeps it without asking.
set -uo pipefail

ROOT="${TRENCHFLOW_HOME:-$HOME/.local/share/trench-flow}"
APP="$ROOT/app"
DATA="${TRENCHFLOW_DIR:-$HOME/.trench-flow}"
AGENTS="$HOME/Library/LaunchAgents"
UID_NOW="$(id -u)"

say() { printf '\n==> %s\n' "$1"; }
info() { printf '    %s\n' "$1"; }

say "Stopping trench-flow and removing start at login"
for label in net.trench-flow.server net.trench-flow.activitywatch; do
  launchctl bootout "gui/$UID_NOW/$label" 2>/dev/null || launchctl unload "$AGENTS/$label.plist" 2>/dev/null || true
  if [ -f "$AGENTS/$label.plist" ]; then rm -f "$AGENTS/$label.plist"; info "removed $label"; fi
done
pkill -f "$APP/server/main.ts" 2>/dev/null && info "stopped" || true

say "Removing the app"
rm -rf "$HOME/Applications/trench-flow.app" && info "removed ~/Applications/trench-flow.app"
if [ -d "$ROOT" ]; then rm -rf "$ROOT"; info "removed $ROOT"; else info "already gone"; fi

say "Your data"
if [ -d "$DATA" ]; then
  answer="${TRENCHFLOW_DELETE_DATA:-}"
  if [ "$answer" != "1" ] && [ "$answer" != "0" ]; then
    # read from the keyboard, not from the piped script
    if [ -r /dev/tty ]; then
      printf '    Delete your trench-flow data too (%s: settings, day summaries, screenshots)? Type yes to delete: ' "$DATA"
      read -r reply < /dev/tty || reply=""
    else
      reply=""
    fi
    if [ "$reply" = "yes" ]; then answer=1; else answer=0; fi
  fi
  if [ "$answer" = "1" ]; then rm -rf "$DATA"; info "deleted"; else info "kept in $DATA"; fi
else
  info "none found"
fi

printf '\ntrench-flow is removed.\n'
echo "  ActivityWatch is still installed (drag it from Applications to the Bin to remove it). It no longer starts"
echo "  at login through trench-flow. Bun is still installed (~/.bun)."
