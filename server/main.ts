/**
 * Starts trench-flow: the server on 127.0.0.1 (port TRENCHFLOW_PORT, default 7766), the Day scheduler, and the page in
 * an app window. If trench-flow is already running on that port it only opens the window.
 *
 *   bun server/main.ts                 start (or find) the server and open the window
 *   bun server/main.ts --no-open       start without opening a window (what starts at login)
 *   bun server/main.ts --background    also write the log to <data folder>/logs/server.log (no console to show it)
 *
 * TRENCHFLOW_NO_OPEN=1 is the same as --no-open. TRENCHFLOW_DIR moves the data folder (default ~/.trench-flow).
 */
import { appendFileSync, mkdirSync, statSync, truncateSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findFfmpeg } from './ffmpeg.ts'
import { openAppWindow } from './window.ts'

const args = process.argv.slice(2)
const PORT = Number(process.env.TRENCHFLOW_PORT || 7766)
const WEB_PORT = Number(process.env.TRENCHFLOW_WEB_PORT || 7767)
const OPEN = !args.includes('--no-open') && process.env.TRENCHFLOW_NO_OPEN !== '1'
const URL_HERE = `http://127.0.0.1:${PORT}/`
const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

if (args.includes('--background')) {
  const dir = join(process.env.TRENCHFLOW_DIR || join(homedir(), '.trench-flow'), 'logs')
  const file = join(dir, 'server.log')
  mkdirSync(dir, { recursive: true })
  try {
    if (statSync(file).size > 5_000_000) truncateSync(file, 0)
  } catch {
    // no log yet
  }
  const write = (level: string) => (...parts: unknown[]) => {
    try {
      appendFileSync(file, `${new Date().toISOString()} ${level} ${parts.map((p) => (p instanceof Error ? p.stack ?? p.message : typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`)
    } catch {
      // a log that can't be written never stops the app
    }
  }
  console.log = write('info')
  console.warn = write('warn')
  console.error = write('error')
}

async function alreadyRunning(): Promise<boolean> {
  try {
    const r = await fetch(`${URL_HERE}api/health`, { signal: AbortSignal.timeout(1500) })
    const j = (await r.json()) as { app?: string }
    return j.app === 'trench-flow'
  } catch {
    return false
  }
}

if (await alreadyRunning()) {
  console.log(`trench-flow is already running at ${URL_HERE}`)
  if (OPEN) openAppWindow(URL_HERE)
  process.exit(0)
}

const ffmpeg = findFfmpeg(process.env, APP_DIR)
if (ffmpeg) process.env.FFMPEG_PATH = ffmpeg

// Imported after the environment is set up: importing the routes starts the Day scheduler.
const { createApp } = await import('./app.ts')
const app = createApp({ port: PORT, webPort: WEB_PORT })

try {
  Bun.serve({ fetch: (req) => app.fetch(req), port: PORT, hostname: '127.0.0.1' })
} catch (err) {
  console.error(`trench-flow could not use port ${PORT} (${(err as Error).message}). Is another program using it? Set TRENCHFLOW_PORT to pick another.`)
  process.exit(1)
}

console.log(`trench-flow is running at ${URL_HERE} (only this computer can open it)`)
if (OPEN) openAppWindow(URL_HERE)
