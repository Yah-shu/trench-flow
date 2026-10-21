/** Pure helpers for the Day page: durations, dates, the ring's arcs, target fills, colours. */

/** 47 → "47m", 60 → "1h", 582 → "9h 42m", 0 → "0m". */
export function fmtShort(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  const h = Math.floor(m / 60)
  const r = m % 60
  if (!h) return `${r}m`
  return r ? `${h}h ${r}m` : `${h}h`
}

/** 739 → "12 hours 19 minutes", 60 → "1 hour", 1 → "1 minute". */
export function fmtLong(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  const h = Math.floor(m / 60)
  const r = m % 60
  const hs = h ? `${h} hour${h === 1 ? '' : 's'}` : ''
  const ms = r || !h ? `${r} minute${r === 1 ? '' : 's'}` : ''
  return [hs, ms].filter(Boolean).join(' ')
}

/** 582 → "9.7" (hours, one decimal, no trailing ".0"). */
export function fmtHours(minutes: number): string {
  const v = Math.round((Math.max(0, minutes) / 60) * 10) / 10
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

/** ISO time → "14:05" in local time. */
export function fmtClock(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function minutesBetween(a: string, b: string): number {
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000))
}

/** Local YYYY-MM-DD. */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const START_KEY = 'day.startHour'

/** The server's day start hour, remembered from the last summary so "today" is right before the first load. */
export function rememberDayStart(h: number | undefined): void {
  if (typeof h !== 'number') return
  try {
    localStorage.setItem(START_KEY, String(h))
  } catch {
    // private mode: fall back to the default
  }
}

/** The day that is running now: before the day start hour (default 04:00) it is still yesterday. */
export function todayDate(now = new Date()): string {
  let h = 4
  try {
    const v = Number(localStorage.getItem(START_KEY))
    if (localStorage.getItem(START_KEY) !== null && Number.isInteger(v)) h = v
  } catch {
    // keep the default
  }
  const d = new Date(now)
  d.setHours(d.getHours() - h)
  return isoDate(d)
}

export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return isoDate(new Date(y!, m! - 1, d! + days))
}

export function dayLabel(date: string, today: string): string {
  if (date === today) return 'Today'
  if (date === shiftDate(today, -1)) return 'Yesterday'
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y!, m! - 1, d!).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}

export function weekdayShort(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y!, m! - 1, d!).toLocaleDateString('en-GB', { weekday: 'short' })
}

export interface Arc {
  start: number
  end: number
}

/**
 * The ring's segments, in degrees clockwise from 12 o'clock. Each value gets its share of the
 * circle minus a fixed gap between segments; zero values get no segment (null). One segment
 * fills the whole circle with no gap.
 */
export function ringArcs(values: number[], gapDeg = 6): (Arc | null)[] {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0)
  const live = values.filter((v) => v > 0).length
  if (!total) return values.map(() => null)
  if (live === 1) return values.map((v) => (v > 0 ? { start: 0, end: 360 } : null))
  const usable = 360 - gapDeg * live
  let at = gapDeg / 2
  return values.map((v) => {
    if (v <= 0) return null
    const span = (v / total) * usable
    const arc = { start: at, end: at + span }
    at += span + gapDeg
    return arc
  })
}

/** SVG path for an arc of a circle centred at (c, c). */
export function arcPath(c: number, r: number, a: Arc): string {
  const pt = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180
    return `${(c + r * Math.cos(rad)).toFixed(2)} ${(c + r * Math.sin(rad)).toFixed(2)}`
  }
  if (a.end - a.start >= 359.99) {
    return `M ${pt(0)} A ${r} ${r} 0 1 1 ${pt(180)} A ${r} ${r} 0 1 1 ${pt(359.99)}`
  }
  const large = a.end - a.start > 180 ? 1 : 0
  return `M ${pt(a.start)} A ${r} ${r} 0 ${large} 1 ${pt(a.end)}`
}

/**
 * How a bar against a target is drawn. The track spans max(actual, target), so going over
 * the target never clips: the target becomes a marker inside the track.
 */
export function targetFill(actual: number, target: number) {
  const a = Math.max(0, actual)
  const t = Math.max(0, target)
  const scale = Math.max(a, t) || 1
  return {
    /** 0–1 share of the track the actual fills. */
    fill: a / scale,
    /** 0–1 position of the target marker (1 when not over). */
    marker: t / scale,
    over: t > 0 && a > t,
    /** actual / target, uncapped (1.08 = 108%). */
    ratio: t ? a / t : 0,
    scale,
  }
}

/**
 * Colour tokens → hex. The eight chromatic ones are a validated categorical set (dataviz
 * validate_palette: lightness band, chroma floor, CVD and normal-vision separation pass in this
 * order on white; sun and teal are under 3:1, so every colour sits next to a text label).
 * ink and slate are the neutrals.
 */
export const DAY_COLORS: Record<string, string> = {
  sky: '#2F7FD1',
  sun: '#D69A00',
  leaf: '#1E9E6A',
  plum: '#7A55C9',
  coral: '#E2645C',
  teal: '#14A3B8',
  sand: '#B9772F',
  rose: '#D9669B',
  ink: '#4A4A4A',
  slate: '#8A94A3',
  // extra tokens the backend uses
  orange: '#E07B24',
  red: '#C8423B',
  stone: '#A39E93',
}

export const colorOf = (token: string | undefined): string => (token && DAY_COLORS[token]) || (token?.startsWith('#') ? token : DAY_COLORS.slate!)

/** The neutral and distraction groups as drawn in the ring. */
export const DISTRACTION_COLOR = DAY_COLORS.coral!
export const NEUTRAL_COLOR = '#C9C3B8'

/** "distracted 2×, 6m" for a card's distractions; null when there are none. */
export function distractionChip(list: { minutes: number }[] | undefined): string | null {
  if (!list?.length) return null
  return `distracted ${list.length}×, ${fmtShort(list.reduce((s, d) => s + d.minutes, 0))}`
}

/** AI titles come every ~2 hours (and at day end): a card still waiting shows a quiet hint. */
export function awaitingAiTitle(item: { summary: string | null; end: string }, date: string, today: string, now = Date.now()): boolean {
  if (item.summary !== null) return false
  return date === today || now - new Date(item.end).getTime() < 2 * 60 * 60 * 1000
}
