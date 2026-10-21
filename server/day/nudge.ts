/**
 * Distraction nudges, from window titles only (no screenshots, no AI). Once a minute the last hour of this
 * computer's activity is sorted with the normal rules/caches; when the current stretch of distraction time reaches
 * `afterMinutes` (short breaks under 2 min don't reset it, being away does) a desktop notification (Windows or macOS) says so, then
 * stays quiet for `quietMinutes`. Off unless config.nudges.enabled.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readSource } from './aw.ts'
import { activeSegments, applyPrivacy, makeClassifier, windowLabel } from './compute.ts'
import { rulesHash } from './embed.ts'
import { localTitleCache, readConfig, titleCache, userLabels } from './store.ts'
import type { DayConfig, Segment } from './types.ts'

export interface Streak {
  minutes: number
  /** The window with the most time in the streak. */
  label: string
  since: string
}

const BREAK_MS = 2 * 60_000

/** The distraction stretch that is still going on at `now` (null when the newest activity isn't a distraction). */
export function currentStreak(segs: Segment[], isDistraction: (s: Segment) => boolean, now: number): Streak | null {
  const sorted = [...segs].sort((a, b) => a.start - b.start)
  let end = now
  let ms = 0
  let since = 0
  const byLabel = new Map<string, number>()
  for (let i = sorted.length - 1; i >= 0; i--) {
    const s = sorted[i]
    if (end - s.end > BREAK_MS) break
    if (!isDistraction(s)) {
      // a short non-distraction blip inside the streak is allowed
      if (s.end - s.start <= BREAK_MS && ms > 0) {
        end = s.start
        continue
      }
      break
    }
    ms += s.end - s.start
    since = s.start
    end = s.start
    const l = windowLabel(s, 40)
    byLabel.set(l, (byLabel.get(l) ?? 0) + s.end - s.start)
  }
  if (!ms) return null
  return { minutes: Math.round(ms / 60_000), label: [...byLabel.entries()].sort((a, b) => b[1] - a[1])[0][0], since: new Date(since).toISOString() }
}

/** The running distraction stretch on this computer right now. */
export async function streakNow(cfg: DayConfig = readConfig(), now = Date.now()): Promise<Streak | null> {
  const src = cfg.sources.find((s) => /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(s.url))
  if (!src) return null
  const data = await readSource(src, new Date(now - 3600_000), new Date(now))
  if (!data.online) return null
  const segs = applyPrivacy(activeSegments([data], now - 3600_000, now), cfg.private)
  const valid = new Set(cfg.categories.map((c) => c.id))
  const cls = makeClassifier(cfg.rules, titleCache(), valid, localTitleCache(rulesHash(cfg)), userLabels())
  const kind = new Map(cfg.categories.map((c) => [c.id, c.kind]))
  return currentStreak(segs, (s) => kind.get(cls.categoryOf(s) ?? 'other') === 'distraction', now)
}

let lastNudge = 0

function toast(title: string, text: string): void {
  if (process.platform === 'darwin') {
    // AppleScript string literals: backslashes and quotes escaped
    const q = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    const c = spawn('osascript', ['-e', `display notification ${q(text)} with title ${q(title)}`], { stdio: 'ignore' })
    c.on('error', (err) => console.error('[day] nudge failed:', err.message))
    return
  }
  if (process.platform !== 'win32') return
  const script = fileURLToPath(new URL('./toast-windows.ps1', import.meta.url))
  const c = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Title', title, '-Text', text], { windowsHide: true, stdio: 'ignore' })
  c.on('error', (err) => console.error('[day] nudge failed:', err.message))
}

/** Called every minute by the scheduler. */
export async function checkNudge(now = Date.now()): Promise<void> {
  const cfg = readConfig()
  const n = cfg.nudges
  if (!n.enabled || process.env.VITEST || now - lastNudge < n.quietMinutes * 60_000) return
  const s = await streakNow(cfg, now).catch(() => null)
  if (!s || s.minutes < n.afterMinutes) return
  lastNudge = now
  toast('trench-flow', `${s.minutes} min on distractions (mostly ${s.label}). Back to it?`)
}
