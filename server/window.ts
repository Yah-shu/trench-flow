/**
 * Opens the page as an app window: Edge or Chrome with --app=<url> (a window with no tabs or address bar), else the
 * default browser. Nothing is installed or changed; it only starts the browser that is already there.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

function start(cmd: string, args: string[]): boolean {
  try {
    const c = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false })
    c.on('error', () => undefined)
    c.unref()
    return true
  } catch {
    return false
  }
}

/** Chromium-style browsers that take --app, in the order they're tried. */
export function appBrowsers(env: Record<string, string | undefined> = process.env, platform = process.platform): string[] {
  if (platform === 'win32') {
    const roots = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter((r): r is string => !!r)
    return [
      ...roots.map((r) => join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
      ...roots.map((r) => join(r, 'Google', 'Chrome', 'Application', 'chrome.exe')),
      ...roots.map((r) => join(r, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')),
    ]
  }
  if (platform === 'darwin') {
    const apps = ['Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Chromium']
    return apps.flatMap((a) => [`/Applications/${a}.app`, join(homedir(), 'Applications', `${a}.app`)])
  }
  return ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge']
}

export function openAppWindow(url: string): void {
  const found = appBrowsers().find((p) => existsSync(p))
  if (process.platform === 'darwin') {
    if (found && start('open', ['-na', found, '--args', `--app=${url}`])) return
    start('open', [url])
    return
  }
  if (found && start(found, [`--app=${url}`])) return
  if (process.platform === 'win32') start('explorer.exe', [url])
  else start('xdg-open', [url])
}
