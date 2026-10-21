/**
 * Pure day maths: active segments, categories, totals, timeline blocks, compact text for the AI.
 *
 * Active time = window events ∩ not-AFK intervals (a host without an AFK bucket counts all window time).
 * Cross-device rule (no double counting): every second of the day belongs to at most one segment. Segments are
 * laid down in start order and a later-starting segment takes over the seconds it overlaps, so when two devices
 * are active at once the one you most recently switched to wins. The same rule removes overlaps inside one device.
 */
import type { AwEvent, SourceData } from './aw.ts'
import type { Card, Category, DayStats, PrivateList, Rule, Segment } from './types.ts'
import { titleKey } from './store.ts'

export const MIN_SEGMENT_MS = 10_000
const MERGE_GAP_MS = 5_000

type Interval = [number, number]

const evInterval = (e: AwEvent): Interval => {
  const s = Date.parse(e.timestamp)
  return [s, s + Math.max(0, Number(e.duration) || 0) * 1000]
}

function unionIntervals(list: Interval[]): Interval[] {
  const sorted = list.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])
  const out: Interval[] = []
  for (const iv of sorted) {
    const last = out[out.length - 1]
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1])
    else out.push([iv[0], iv[1]])
  }
  return out
}

/** Window events clipped to not-AFK time and to [dayStart, dayEnd). */
export function activeSegments(data: SourceData[], dayStart: number, dayEnd: number): Segment[] {
  const raw: Segment[] = []
  for (const src of data) {
    for (const host of src.hosts) {
      const notAfk = host.afk.length
        ? unionIntervals(host.afk.filter((e) => e.data?.status === 'not-afk').map(evInterval))
        : [[dayStart, dayEnd] as Interval]
      const tabs = browserTabs(host.web ?? [])
      for (const e of host.window) {
        let [s, t] = evInterval(e)
        s = Math.max(s, dayStart)
        t = Math.min(t, dayEnd)
        if (t <= s) continue
        const app = String(e.data?.app ?? 'unknown')
        const title = String(e.data?.title ?? '')
        for (const [a, b] of notAfk) {
          if (b <= s) continue
          if (a >= t) break
          const cs = Math.max(a, s)
          const ce = Math.min(b, t)
          if (ce > cs) raw.push(...splitByTabs({ start: cs, end: ce, device: src.source.id, app, title }, tabs))
        }
      }
    }
  }
  return dedupeAndMerge(raw, dayStart, dayEnd)
}

interface Tab { start: number; end: number; title: string; domain: string }

const domainOf = (url: string) => {
  try {
    const u = new URL(url)
    return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, '') : ''
  } catch {
    return ''
  }
}

function browserTabs(events: AwEvent[]): Tab[] {
  return events
    .map((e) => {
      const [start, end] = evInterval(e)
      return { start, end, title: String(e.data?.title ?? '').trim().toLowerCase(), domain: domainOf(String(e.data?.url ?? '')) }
    })
    .filter((t) => t.end > t.start && t.domain && t.title.length >= 3)
    .sort((a, b) => a.start - b.start)
}

/**
 * Gives a window the website of the browser tab that was active at the same time, only where the window title
 * contains the tab title (the extension keeps reporting its tab while another app or browser is in front).
 */
export function splitByTabs(seg: Segment, tabs: Tab[]): Segment[] {
  if (!tabs.length) return [seg]
  const win = seg.title.toLowerCase()
  const out: Segment[] = []
  let at = seg.start
  // first tab that could overlap: binary search on start, then step back over long tabs
  let lo = 0
  let hi = tabs.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (tabs[mid].start < seg.start) lo = mid + 1
    else hi = mid
  }
  let i = Math.max(0, lo - 1)
  while (i > 0 && tabs[i - 1].end > seg.start) i--
  for (; i < tabs.length && tabs[i].start < seg.end; i++) {
    const t = tabs[i]
    if (t.end <= at || !win.includes(t.title.slice(0, 40))) continue
    const a = Math.max(at, t.start)
    const b = Math.min(seg.end, t.end)
    if (a > at) out.push({ ...seg, start: at, end: a })
    out.push({ ...seg, start: a, end: b, domain: t.domain })
    at = b
  }
  if (at < seg.end) out.push({ ...seg, start: at, end: seg.end })
  return out
}

/** Second-resolution ownership (later start wins), then merge same device+app+title runs, then drop < 10 s. */
export function dedupeAndMerge(raw: Segment[], dayStart: number, dayEnd: number): Segment[] {
  if (!raw.length) return []
  const secs = Math.ceil((dayEnd - dayStart) / 1000)
  const owner = new Int32Array(secs).fill(-1)
  const order = raw.map((_, i) => i).sort((a, b) => raw[a].start - raw[b].start || a - b)
  for (const i of order) {
    const a = Math.max(0, Math.floor((raw[i].start - dayStart) / 1000))
    const b = Math.min(secs, Math.ceil((raw[i].end - dayStart) / 1000))
    owner.fill(i, a, b)
  }
  const runs: Segment[] = []
  let cur = -1
  let runStart = 0
  const push = (endSec: number) => {
    if (cur < 0) return
    const r = raw[cur]
    runs.push({ start: dayStart + runStart * 1000, end: dayStart + endSec * 1000, device: r.device, app: r.app, title: r.title, ...(r.domain ? { domain: r.domain } : {}) })
  }
  for (let s = 0; s < secs; s++) {
    if (owner[s] !== cur) {
      push(s)
      cur = owner[s]
      runStart = s
    }
  }
  push(secs)
  const merged = mergeSame(runs)
  // a window shown for under 10 s joins the window before it (or after it), so quick flicks keep their time
  const out: Segment[] = []
  for (let i = 0; i < merged.length; i++) {
    const s = merged[i]
    if (s.end - s.start >= MIN_SEGMENT_MS) {
      out.push(s)
      continue
    }
    const prev = out[out.length - 1]
    const next = merged[i + 1]
    if (prev && prev.device === s.device && s.start - prev.end <= MERGE_GAP_MS) prev.end = s.end
    else if (next && next.device === s.device && next.start - s.end <= MERGE_GAP_MS) next.start = s.start
  }
  return mergeSame(out)
}

function mergeSame(list: Segment[]): Segment[] {
  const merged: Segment[] = []
  for (const r of list) {
    const last = merged[merged.length - 1]
    if (last && last.device === r.device && last.app === r.app && last.title === r.title && last.domain === r.domain && r.start - last.end <= MERGE_GAP_MS) last.end = r.end
    else merged.push({ ...r })
  }
  return merged
}

const compiled = new Map<string, RegExp | null>()
function re(src: string): RegExp | null {
  if (!compiled.has(src)) {
    try {
      compiled.set(src, new RegExp(src, 'i'))
    } catch {
      compiled.set(src, null)
    }
  }
  return compiled.get(src) ?? null
}

/** Rules ignore a trailing ".exe" so the same rule works for Windows and macOS app names. */
export function matchRule(rules: Rule[], app: string, title: string, domain?: string): string | null {
  return matchRuleDetail(rules, app, title, domain)?.categoryId ?? null
}

/** The first matching rule; `byTitle` says whether the title or website (not just the app) decided it. */
export function matchRuleDetail(rules: Rule[], app: string, title: string, domain?: string): { categoryId: string; byTitle: boolean } | null {
  const a = app.replace(/\.exe$/i, '')
  for (const r of rules) {
    if (!r.app && !r.title && !r.domain) continue
    if (r.app && !(re(r.app)?.test(a) || re(r.app)?.test(app))) continue
    if (r.title && !re(r.title)?.test(title)) continue
    if (r.domain && !(domain && re(r.domain)?.test(domain))) continue
    return { categoryId: r.categoryId, byTitle: !!(r.title || r.domain) }
  }
  return null
}

/** Emails become [email]; 7+ digit runs, card-style 4x4 groups and phone-style 3-3-4 groups become [number] (dates stay). */
export const maskTitle = (t: string) => t.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]').replace(/\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4}\b|\b\d{3}[ -]\d{3}[ -]\d{4}\b|\b\d{7,}\b/g, '[number]')

/**
 * Privacy, applied before anything else sees a segment: windows of a private app or with a private title become
 * "(private)" with no website (they never reach the AI, caches or the summary); other titles are masked.
 */
export function applyPrivacy(segs: Segment[], priv: PrivateList): Segment[] {
  const apps = priv.apps.map(re).filter((r): r is RegExp => !!r)
  const titles = priv.titles.map(re).filter((r): r is RegExp => !!r)
  return segs.map((s) => {
    const a = s.app.replace(/\.exe$/i, '')
    if (apps.some((r) => r.test(a)) || titles.some((r) => r.test(s.title))) {
      const { domain: _d, ...rest } = s
      return { ...rest, title: '(private)', private: true }
    }
    const t = maskTitle(s.title)
    return t === s.title ? s : { ...s, title: t }
  })
}

/** Who decided a window's category: the user's own label, a rule, Haiku, the local look-alike matcher, or nobody. */
export type How = 'you' | 'rule' | 'ai' | 'local' | 'none'

export interface Classifier {
  categoryOf(seg: Pick<Segment, 'app' | 'title' | 'domain'>): string | null
  explain(seg: Pick<Segment, 'app' | 'title' | 'domain'>): { categoryId: string; how: How } | null
}

/** Order: the user's labels, rules, Haiku's cached answers, then the local look-alike matcher's answers. */
export function makeClassifier(
  rules: Rule[],
  cache: Record<string, string>,
  valid: Set<string>,
  local: Record<string, string> = {},
  labels: Record<string, string> = {},
): Classifier {
  const explain: Classifier['explain'] = ({ app, title, domain }) => {
    const k = titleKey(app, title)
    if (labels[k] && valid.has(labels[k])) return { categoryId: labels[k], how: 'you' }
    const r = matchRule(rules, app, title, domain)
    if (r && valid.has(r)) return { categoryId: r, how: 'rule' }
    if (cache[k] && valid.has(cache[k])) return { categoryId: cache[k], how: 'ai' }
    if (local[k] && valid.has(local[k])) return { categoryId: local[k], how: 'local' }
    return null
  }
  return { explain, categoryOf: (s) => explain(s)?.categoryId ?? null }
}

/** A card's category = the category with the most minutes inside it on that device (the stats decide, not the AI). */
export function cardCategory(card: Pick<Card, 'start' | 'end' | 'device' | 'categoryId'>, segs: Segment[], catOf: (s: Segment) => string): string {
  const a = Date.parse(card.start)
  const b = Date.parse(card.end)
  const byCat = new Map<string, number>()
  for (const s of segs) {
    if (s.device !== card.device || s.end <= a || s.start >= b) continue
    const c = catOf(s)
    byCat.set(c, (byCat.get(c) ?? 0) + Math.min(b, s.end) - Math.max(a, s.start))
  }
  return [...byCat.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? card.categoryId
}

const minutes = (ms: number) => Math.round((ms / 60_000) * 10) / 10

/** The biggest windows inside a card (same app + title that differs only by numbers count as one), up to 8. */
export function cardWindows(card: Pick<Card, 'start' | 'end' | 'device'>, segs: Segment[], cls: Classifier, catOf: (s: Segment) => string) {
  const a = Date.parse(card.start)
  const b = Date.parse(card.end)
  const byKey = new Map<string, { seg: Segment; ms: number }>()
  for (const s of segs) {
    if (s.device !== card.device || s.end <= a || s.start >= b) continue
    const k = `${titleKey(s.app, s.title)}\u0001${s.domain ?? ''}`
    const w = byKey.get(k) ?? { seg: s, ms: 0 }
    w.ms += Math.min(b, s.end) - Math.max(a, s.start)
    byKey.set(k, w)
  }
  return [...byKey.values()]
    .sort((x, y) => y.ms - x.ms)
    .slice(0, 8)
    .map(({ seg, ms }) => ({
      app: seg.app.replace(/\.exe$/i, ''),
      title: seg.title,
      domain: seg.domain ?? null,
      private: !!seg.private,
      minutes: minutes(ms),
      categoryId: catOf(seg),
      how: (cls.explain(seg)?.how ?? 'none') as How,
    }))
}


export interface Totals {
  activeMinutes: number
  focusMinutes: number
  distractionMinutes: number
  neutralMinutes: number
  contextSwitches: number
}

export function computeTotals(segs: Segment[], catOf: (s: Segment) => string, cats: Category[]) {
  const kind = new Map(cats.map((c) => [c.id, c.kind]))
  const byCat: Record<string, number> = Object.fromEntries(cats.map((c) => [c.id, 0]))
  const byApp = new Map<string, { ms: number; cats: Map<string, number> }>()
  const byDevice: Record<string, number> = {}
  let active = 0
  let focus = 0
  let distraction = 0
  let neutral = 0
  let switches = 0
  let prevApp: string | null = null
  for (const s of segs) {
    const ms = s.end - s.start
    const cat = catOf(s)
    active += ms
    byCat[cat] = (byCat[cat] ?? 0) + ms
    byDevice[s.device] = (byDevice[s.device] ?? 0) + ms
    const k = kind.get(cat) ?? 'neutral'
    if (k === 'focus') focus += ms
    else if (k === 'distraction') distraction += ms
    else neutral += ms
    const appKey = s.app.replace(/\.exe$/i, '')
    const a = byApp.get(appKey) ?? { ms: 0, cats: new Map() }
    a.ms += ms
    a.cats.set(cat, (a.cats.get(cat) ?? 0) + ms)
    byApp.set(appKey, a)
    const devApp = `${s.device}:${appKey}`
    if (prevApp !== null && devApp !== prevApp) switches++
    prevApp = devApp
  }
  const totals: Totals = {
    activeMinutes: minutes(active),
    focusMinutes: minutes(focus),
    distractionMinutes: minutes(distraction),
    neutralMinutes: minutes(neutral),
    contextSwitches: switches,
  }
  const categories = cats.map((c) => ({ ...c, minutes: minutes(byCat[c.id] ?? 0) }))
  const topApps = [...byApp.entries()]
    .sort((x, y) => y[1].ms - x[1].ms)
    .slice(0, 10)
    .map(([app, v]) => ({ app, minutes: minutes(v.ms), categoryId: [...v.cats.entries()].sort((x, y) => y[1] - x[1])[0][0] }))
  const deviceMinutes = Object.fromEntries(Object.entries(byDevice).map(([d, ms]) => [d, minutes(ms)]))
  const stats: DayStats = {
    activeMinutes: totals.activeMinutes,
    focusMinutes: totals.focusMinutes,
    distractionMinutes: totals.distractionMinutes,
    byCategory: Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, minutes(v)])),
  }
  return { totals, categories, topApps, deviceMinutes, stats }
}

/** Short label of a window for cards and logs: the website when there is one, else the app. */
export const windowLabel = (s: Pick<Segment, 'app' | 'title' | 'domain'>, len = 50) => {
  const t = s.title.length > len ? `${s.title.slice(0, len - 1)}…` : s.title
  return s.domain ? `${s.domain} · ${t}` : `${s.app.replace(/\.exe$/i, '')}: ${t}`
}

const SLOT_MS = 5 * 60_000
const JOIN_GAP_MS = 10 * 60_000
const MIN_CARD_MS = 10 * 60_000

/**
 * Live timeline without AI. Per device the day is cut into 5-minute slots, each with its biggest category; runs of
 * slots with the same category become one card (idle gaps under 10 min stay inside). Cards under 10 min join the
 * card before them (or after). Each card lists the distractions inside it (when it isn't a distraction itself) and
 * a short log: the main window of each 5 minutes, repeats removed. AI only adds titles and summaries later.
 */
export function buildCards(segs: Segment[], catOf: (s: Segment) => string, cats: Category[]): Card[] {
  interface Slot { at: number; first: number; last: number; cats: Map<string, number>; wins: Map<string, { seg: Segment; ms: number }> }
  interface Run { device: string; cat: string; slots: Slot[] }
  const kind = new Map(cats.map((c) => [c.id, c.kind]))
  const top = <T,>(m: Map<string, T>, ms: (v: T) => number) => [...m.entries()].sort((x, y) => ms(y[1]) - ms(x[1]))
  const byDevice = new Map<string, Map<number, Slot>>()
  for (const s of segs) {
    const slots = byDevice.get(s.device) ?? new Map<number, Slot>()
    byDevice.set(s.device, slots)
    for (let a = s.start; a < s.end; ) {
      const at = Math.floor(a / SLOT_MS) * SLOT_MS
      const b = Math.min(s.end, at + SLOT_MS)
      const slot = slots.get(at) ?? { at, first: a, last: b, cats: new Map(), wins: new Map() }
      slot.first = Math.min(slot.first, a)
      slot.last = Math.max(slot.last, b)
      slot.cats.set(catOf(s), (slot.cats.get(catOf(s)) ?? 0) + b - a)
      const k = `${titleKey(s.app, s.title)}\u0001${s.domain ?? ''}`
      const w = slot.wins.get(k) ?? { seg: s, ms: 0 }
      w.ms += b - a
      slot.wins.set(k, w)
      slots.set(at, slot)
      a = b
    }
  }
  const cards: Card[] = []
  for (const [device, slotMap] of byDevice) {
    const runs: Run[] = []
    for (const slot of [...slotMap.values()].sort((x, y) => x.at - y.at)) {
      if ([...slot.cats.values()].reduce((n, v) => n + v, 0) < 30_000) continue
      const cat = top(slot.cats, (v) => v)[0][0]
      const last = runs[runs.length - 1]
      const lastSlot = last?.slots[last.slots.length - 1]
      if (last && last.cat === cat && slot.first - lastSlot!.last <= JOIN_GAP_MS) last.slots.push(slot)
      else runs.push({ device, cat, slots: [slot] })
    }
    const span = (r: Run) => r.slots[r.slots.length - 1].last - r.slots[0].first
    // short runs join a neighbour that is close enough
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i]
      if (span(r) >= MIN_CARD_MS || runs.length === 1) continue
      const prev = runs[i - 1]
      const next = runs[i + 1]
      if (prev && r.slots[0].first - prev.slots[prev.slots.length - 1].last <= JOIN_GAP_MS) {
        prev.slots.push(...r.slots)
        runs.splice(i--, 1)
      } else if (next && next.slots[0].first - r.slots[r.slots.length - 1].last <= JOIN_GAP_MS) {
        next.slots.unshift(...r.slots)
        runs.splice(i--, 1)
      }
    }
    // a short detour that joined its neighbour can leave two runs of the same category side by side
    const runCat = (r: Run) => {
      const m = new Map<string, number>()
      for (const sl of r.slots) for (const [c, v] of sl.cats) m.set(c, (m.get(c) ?? 0) + v)
      return top(m, (v) => v)[0][0]
    }
    for (let i = 1; i < runs.length; i++) {
      const prev = runs[i - 1]
      if (runCat(prev) === runCat(runs[i]) && runs[i].slots[0].first - prev.slots[prev.slots.length - 1].last <= JOIN_GAP_MS) {
        prev.slots.push(...runs[i].slots)
        runs.splice(i--, 1)
      }
    }
    for (const r of runs) {
      const catMs = new Map<string, number>()
      const wins = new Map<string, { seg: Segment; ms: number }>()
      for (const sl of r.slots) {
        for (const [c, v] of sl.cats) catMs.set(c, (catMs.get(c) ?? 0) + v)
        for (const [k, w] of sl.wins) {
          const x = wins.get(k) ?? { seg: w.seg, ms: 0 }
          x.ms += w.ms
          wins.set(k, x)
        }
      }
      const cat = top(catMs, (v) => v)[0][0]
      const isDistraction = kind.get(cat) === 'distraction'
      const distractions = isDistraction
        ? []
        : top(wins, (w) => w.ms)
            .filter(([, w]) => kind.get(catOf(w.seg)) === 'distraction' && w.ms >= 60_000)
            .slice(0, 3)
            .map(([, w]) => ({ label: windowLabel(w.seg, 40), minutes: minutes(w.ms) }))
      const log: { at: string; text: string }[] = []
      for (const sl of r.slots) {
        const text = windowLabel(top(sl.wins, (w) => w.ms)[0][1].seg, 60)
        if (log[log.length - 1]?.text !== text) log.push({ at: new Date(sl.first).toISOString(), text })
      }
      cards.push({
        start: new Date(r.slots[0].first).toISOString(),
        end: new Date(r.slots[r.slots.length - 1].last).toISOString(),
        device,
        categoryId: cat,
        title: windowLabel(top(wins, (w) => w.ms)[0][1].seg, 50).slice(0, 60),
        summary: null,
        distractions,
        log: log.slice(0, 24),
      })
    }
  }
  return cards.sort((a, b) => a.start.localeCompare(b.start))
}

const hhmm = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * The day for the summary call as one line per 15-minute block and device: minutes per category, then the main
 * windows with their minutes. Neighbouring blocks with the same main window and category become one line, so a
 * long stretch on one thing costs one line. Blocks grow (30, 60 min) and titles shrink until it fits maxChars.
 */
export function compactDay(segs: Segment[], catOf: (s: Segment) => string, maxChars = 12_000): string {
  let text = ''
  for (const [blockMin, titleLen, topN] of [[15, 70, 3], [30, 60, 3], [60, 50, 3], [60, 40, 2]] as const) {
    text = renderBlocks(segs, catOf, blockMin * 60_000, titleLen, topN)
    if (text.length <= maxChars) return text
  }
  return text.slice(0, maxChars)
}

function renderBlocks(segs: Segment[], catOf: (s: Segment) => string, blockMs: number, titleLen: number, topN: number): string {
  interface Block { start: number; end: number; device: string; cats: Map<string, number>; wins: Map<string, number> }
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v)
  const top = (m: Map<string, number>) => [...m.entries()].sort((x, y) => y[1] - x[1])
  const blocks = new Map<string, Block>()
  for (const s of segs) {
    // a segment can span several blocks: split it at block edges (block edges follow the local clock via epoch math)
    for (let a = s.start; a < s.end; ) {
      const edge = Math.floor(a / blockMs) * blockMs + blockMs
      const b = Math.min(s.end, edge)
      const key = `${s.device}|${edge}`
      const blk = blocks.get(key) ?? { start: edge - blockMs, end: edge, device: s.device, cats: new Map(), wins: new Map() }
      add(blk.cats, catOf(s), b - a)
      add(blk.wins, `${s.app.replace(/\.exe$/i, '')}: ${s.title.slice(0, titleLen)}${s.domain ? ` [${s.domain}]` : ''}`, b - a)
      blocks.set(key, blk)
      a = b
    }
  }
  const ordered = [...blocks.values()].filter((b) => [...b.cats.values()].reduce((n, v) => n + v, 0) >= 60_000).sort((x, y) => x.start - y.start || x.device.localeCompare(y.device))
  const lines: Block[] = []
  const lastOf = new Map<string, Block>()
  for (const b of ordered) {
    const last = lastOf.get(b.device)
    if (last && last.end === b.start && top(last.cats)[0][0] === top(b.cats)[0][0] && top(last.wins)[0][0] === top(b.wins)[0][0]) {
      last.end = b.end
      for (const [k, v] of b.cats) add(last.cats, k, v)
      for (const [k, v] of b.wins) add(last.wins, k, v)
      continue
    }
    lines.push(b)
    lastOf.set(b.device, b)
  }
  const m = (ms: number) => `${Math.round(ms / 60_000)}m`
  return lines
    .map((b) => {
      const cats = top(b.cats).filter(([, v]) => v >= 60_000).map(([k, v]) => `${k} ${m(v)}`).join(', ')
      const wins = top(b.wins).filter(([, v], i) => i === 0 || v >= 60_000).slice(0, topN).map(([k, v]) => `${k} (${m(v)})`).join('; ')
      return `${hhmm(b.start)}-${hhmm(b.end)} ${b.device} | ${cats} | ${wins}`
    })
    .join('\n')
}
