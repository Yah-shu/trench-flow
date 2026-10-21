/**
 * Smart screenshots (Windows and macOS). Every `everySeconds` the server asks this computer's ActivityWatch which window is in
 * front and whether you're away, then has ffmpeg (gdigrab) save the desktop (all screens, at most 1920 px wide) as a
 * JPEG into <day dir>/shots/<YYYY-MM-DD>/<HHmmss>.jpg with a line in index.jsonl ({ t, app, title, file }). Grabbing
 * just the front window comes out black for GPU-drawn apps (Chrome, Edge, Discord). Nothing is taken while you're away, on the
 * lock screen, or when the window matches the private list. Shots stay on this computer for `keepDays` days. The AI
 * only sees a couple of them for cards whose window titles say too little (service.ts describeDay); the page uses
 * them for the replay. Off unless config.screenshots.enabled. Windows: ffmpeg from PATH (or FFMPEG_PATH). macOS: the
 * built-in screencapture + sips (needs Screen Recording permission for the app that runs the server; without it the
 * shot shows only the desktop background).
 */
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { dayRoot, readConfig } from './store.ts'
import type { DayConfig } from './types.ts'

export const shotsDir = () => join(dayRoot(), 'shots')

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

let timer: ReturnType<typeof setInterval> | null = null
let timerEvery = 0
let busy = false

/** Starts, re-times or stops the capture timer to match the config. Safe to call every minute. */
export function syncCapture(): void {
  const sc = readConfig().screenshots
  const want = sc.enabled && (process.platform === 'win32' || process.platform === 'darwin') && !process.env.VITEST
  if (timer && (!want || timerEvery !== sc.everySeconds)) {
    clearInterval(timer)
    timer = null
  }
  if (!want || timer) return
  timerEvery = sc.everySeconds
  timer = setInterval(() => void captureOnce(), sc.everySeconds * 1000)
  timer.unref?.()
}

/** The local ActivityWatch: the newest window event and whether you're away now. */
async function frontWindow(cfg: DayConfig): Promise<{ app: string; title: string; away: boolean } | null> {
  const src = cfg.sources.find((s) => /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(s.url))
  if (!src) return null
  const base = src.url.replace(/\/+$/, '')
  const get = async <T,>(p: string): Promise<T> => (await (await fetch(`${base}/api/0/${p}`, { signal: AbortSignal.timeout(5000) })).json()) as T
  const buckets = await get<Record<string, { id: string; type: string }>>('buckets/')
  const win = Object.values(buckets).find((b) => b.type === 'currentwindow')
  const afk = Object.values(buckets).find((b) => b.type === 'afkstatus')
  if (!win) return null
  const [w] = await get<{ data: { app?: string; title?: string } }[]>(`buckets/${encodeURIComponent(win.id)}/events?limit=1`)
  const a = afk ? (await get<{ data: { status?: string } }[]>(`buckets/${encodeURIComponent(afk.id)}/events?limit=1`))[0] : undefined
  if (!w) return null
  return { app: String(w.data.app ?? ''), title: String(w.data.title ?? ''), away: a?.data.status === 'afk' }
}

const isPrivate = (cfg: DayConfig, app: string, title: string) => {
  const test = (p: string, v: string) => {
    try {
      return new RegExp(p, 'i').test(v)
    } catch {
      return false
    }
  }
  const a = app.replace(/\.exe$/i, '')
  return cfg.private.apps.some((p) => test(p, a)) || cfg.private.titles.some((p) => test(p, title))
}

function ffmpeg(input: string, out: string): Promise<boolean> {
  return new Promise((resolve) => {
    const args = ['-hide_banner', '-loglevel', 'error', '-f', 'gdigrab', '-framerate', '1', '-i', input, '-frames:v', '1', '-vf', 'scale=min(1920\\,iw):-2', '-q:v', '7', '-y', out]
    const c = spawn(process.env.FFMPEG_PATH || 'ffmpeg', args, { windowsHide: true, stdio: 'ignore' })
    const t = setTimeout(() => c.kill(), 15_000)
    c.on('error', () => resolve(false))
    c.on('exit', (code) => {
      clearTimeout(t)
      resolve(code === 0 && existsSync(out))
    })
  })
}

function run(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { windowsHide: true, stdio: 'ignore' })
    const t = setTimeout(() => c.kill(), 15_000)
    c.on('error', () => resolve(false))
    c.on('exit', (code) => {
      clearTimeout(t)
      resolve(code === 0)
    })
  })
}

/** macOS: every screen into one JPEG, then shrunk to at most 1920 px (screencapture -x = no shutter sound). */
async function macShot(out: string): Promise<boolean> {
  if (!(await run('screencapture', ['-x', '-t', 'jpg', out]))) return false
  await run('sips', ['-Z', '1920', '-s', 'formatOptions', '60', out, '--out', out])
  return existsSync(out)
}

/** One shot of the window in front (or the desktop), unless away, locked or private. */
export async function captureOnce(now = new Date()): Promise<string | null> {
  if (busy) return null
  busy = true
  try {
    const cfg = readConfig()
    const fw = await frontWindow(cfg).catch(() => null)
    if (!fw || fw.away || /^lockapp(\.exe)?$/i.test(fw.app) || isPrivate(cfg, fw.app, fw.title)) return null
    const day = join(shotsDir(), ymd(now))
    mkdirSync(day, { recursive: true })
    const name = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.jpg`
    const out = join(day, name)
    const ok = process.platform === 'darwin' ? await macShot(out) : await ffmpeg('desktop', out)
    if (!ok) return null
    appendFileSync(join(day, 'index.jsonl'), `${JSON.stringify({ t: now.toISOString(), app: fw.app, title: fw.title, file: name })}\n`)
    return out
  } finally {
    busy = false
  }
}

/** Deletes day folders older than keepDays. */
export function pruneShots(keepDays: number, now = new Date()): void {
  const dir = shotsDir()
  if (!existsSync(dir)) return
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - keepDays)
  const oldest = ymd(cutoff)
  for (const d of readdirSync(dir)) if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d < oldest) rmSync(join(dir, d), { recursive: true, force: true })
}

export interface Shot {
  /** ISO time the shot was taken. */
  t: string
  /** "YYYY-MM-DD/HHmmss.jpg" under the shots folder (what GET /day/shot takes). */
  file: string
  app: string
  title: string
}

/** Shots between two times (they can span two calendar folders when a day runs past midnight). */
export function listShots(from: number, to: number): Shot[] {
  const out: Shot[] = []
  const folders = new Set<string>()
  for (let t = from; t <= to + 24 * 3600_000; t += 24 * 3600_000) {
    const d = new Date(Math.min(t, to))
    folders.add(ymd(d))
  }
  for (const f of folders) {
    const index = join(shotsDir(), f, 'index.jsonl')
    if (!existsSync(index)) continue
    for (const line of readFileSync(index, 'utf8').split('\n')) {
      try {
        const x = JSON.parse(line.replace(/^﻿/, '')) as { t: string; app: string; title: string; file: string }
        const t = Date.parse(x.t)
        if (t >= from && t < to && /^\d{6}\.jpg$/.test(x.file)) out.push({ t: x.t, file: `${f}/${x.file}`, app: x.app, title: x.title })
      } catch {
        // half-written or empty line
      }
    }
  }
  return out.sort((a, b) => a.t.localeCompare(b.t))
}

export const SHOT_FILE = /^\d{4}-\d{2}-\d{2}\/\d{6}\.jpg$/

/** The JPEG bytes of one shot, or null (bad name or deleted). */
export function readShot(file: string): Buffer | null {
  if (!SHOT_FILE.test(file)) return null
  const p = join(shotsDir(), ...file.split('/'))
  return existsSync(p) ? readFileSync(p) : null
}

/** Up to `n` shots spread evenly over a stretch of time. */
export function pickShots(from: number, to: number, n: number): Shot[] {
  const all = listShots(from, to)
  if (all.length <= n) return all
  return Array.from({ length: n }, (_, i) => all[Math.floor(((i + 0.5) * all.length) / n)])
}
