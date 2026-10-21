/**
 * Builds the Day view from ActivityWatch, sorts window titles (rules → cached answers → local look-alike matcher →
 * Haiku in batches), makes the daily cards + summary, and runs the end-of-day scheduler. Totals and targets never
 * need AI: unknown titles count as "other" until classified, or until the AI has read that card's screenshots
 * (its card category then fills in the time no title answer covers).
 *
 * A "day" runs from dayStartHour (config, default 04:00) to the same hour next morning, so a late night stays
 * with the day it belongs to.
 */
import { createHash } from 'node:crypto'
import { readSource, type SourceData } from './aw.ts'
import { USAGE_CAP, UsageCapError, classifyTitles, describeCards, overUsageCap, summarizeDay, MAX_TITLES_PER_CALL, type CardInput } from './ai.ts'
import { activeSegments, applyPrivacy, buildCards, cardCategory, cardWindows, computeTotals, makeClassifier, type Classifier } from './compute.ts'
import { pickShots, pruneShots, readShot, syncCapture } from './capture.ts'
import { checkNudge } from './nudge.ts'
import { matchLocally, rulesHash } from './embed.ts'
import { addToCache, addToLocalCache, localTitleCache, readConfig, readDay, titleCache, titleKey, updateDay, userLabels } from './store.ts'
import type { AiLevel, Card, CardEdit, DayConfig, DayFile, DayStats, DeviceState, Segment, SummaryStatus } from './types.ts'

export const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

const pad = (n: number) => String(n).padStart(2, '0')
export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(dayBounds(s, 0).start)

/** The day that is running now (before dayStartHour it is still yesterday). */
export function today(now = new Date(), startHour = readConfig().dayStartHour): string {
  const d = new Date(now)
  d.setHours(d.getHours() - startHour)
  return localDate(d)
}

/** Bounds from dayStartHour to dayStartHour next day, local time (handles DST: the day can be 23 or 25 h). */
export function dayBounds(date: string, startHour = readConfig().dayStartHour): { start: number; end: number } {
  const [y, m, d] = date.split('-').map(Number)
  return { start: new Date(y, m - 1, d, startHour).getTime(), end: new Date(y, m - 1, d + 1, startHour).getTime() }
}

export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return localDate(new Date(y, m - 1, d + days))
}

type Unknown = { app: string; title: string; domain?: string; ms: number }

interface Loaded {
  cfg: DayConfig
  data: SourceData[]
  segs: Segment[]
  cls: Classifier
  catOf: (s: Segment) => string
  unknown: Map<string, Unknown>
}

async function load(date: string): Promise<Loaded> {
  const cfg = readConfig()
  const { start, end } = dayBounds(date, cfg.dayStartHour)
  const data = await Promise.all(cfg.sources.map((s) => readSource(s, new Date(start), new Date(end))))
  const segs = applyPrivacy(activeSegments(data, start, end), cfg.private)
  const valid = new Set(cfg.categories.map((c) => c.id))
  const fallback = valid.has('other') ? 'other' : cfg.categories[cfg.categories.length - 1].id
  const cls = makeClassifier(cfg.rules, titleCache(), valid, localTitleCache(rulesHash(cfg)), userLabels())
  const unknown = new Map<string, Unknown>()
  for (const s of segs) {
    // private windows never go to the AI or the look-alike matcher
    if (s.private || cls.categoryOf(s)) continue
    const k = titleKey(s.app, s.title)
    const u = unknown.get(k) ?? { app: s.app, title: s.title, domain: s.domain, ms: 0 }
    u.ms += s.end - s.start
    unknown.set(k, u)
  }
  const privateCat = valid.has('personal') ? 'personal' : fallback
  const onScreen = screenCategories(readDay(date).cardText, valid)
  const catOf = (s: Segment) => {
    const c = cls.explain(s)
    // a title or rule answer wins; "other" only when the user chose it
    if (c && (c.categoryId !== fallback || c.how === 'you')) return c.categoryId
    if (s.private) return privateCat
    return onScreen(s) ?? c?.categoryId ?? fallback
  }
  return { cfg, data, segs, cls, unknown, catOf }
}

/** The AI's card categories (from screenshots + titles) by device and time: used for time nothing else sorted. */
export function screenCategories(texts: DayFile['cardText'], valid: Set<string>): (s: Segment) => string | null {
  const spans = Object.values(texts ?? {})
    .filter((t) => t.categoryId && valid.has(t.categoryId))
    .map((t) => ({ device: t.device, a: Date.parse(t.start), b: Date.parse(t.end), cat: t.categoryId! }))
  if (!spans.length) return () => null
  return (s) => {
    const mid = (s.start + s.end) / 2
    return spans.find((x) => x.device === s.device && mid >= x.a && mid < x.b)?.cat ?? null
  }
}

// —— classification (background, single flight) ——

/** Titles seen this long are tried locally; Haiku only gets titles seen for at least 1 min. */
const LOCAL_MIN_MS = 20_000
const AI_MIN_MS = 60_000
/**
 * What each AI level does. Rough Haiku use for a 10-hour day: low ~10-20k tokens, medium ~25-40k, high ~50-80k
 * (mostly screenshots). Off makes no AI calls: rules, your labels and the local look-alike matcher only.
 *   batchTitles / batchMs: Haiku sorts waiting titles once this many wait or they add up to this much time.
 *   classifyEveryMs: the scheduler sorts today's new titles this often, even with the page closed.
 *   describeEveryMs: finished cards get titles this often.
 *   shots: which cards on this computer send screenshots with them (none, only those whose titles say too little, all).
 */
export const LEVELS: Record<Exclude<AiLevel, 'off'>, { batchTitles: number; batchMs: number; classifyEveryMs: number; describeEveryMs: number; shots: 'none' | 'unclear' | 'all' }> = {
  low: { batchTitles: 20, batchMs: 30 * 60_000, classifyEveryMs: 30 * 60_000, describeEveryMs: 2 * 3600_000, shots: 'none' },
  medium: { batchTitles: 10, batchMs: 15 * 60_000, classifyEveryMs: 15 * 60_000, describeEveryMs: 3600_000, shots: 'unclear' },
  high: { batchTitles: 5, batchMs: 5 * 60_000, classifyEveryMs: 5 * 60_000, describeEveryMs: 30 * 60_000, shots: 'all' },
}
const levelOf = (cfg: DayConfig) => (cfg.aiLevel === 'off' ? null : LEVELS[cfg.aiLevel] ?? LEVELS.medium)

let classifying: Promise<void> | null = null
let classifyBackoffUntil = 0
/** Titles Haiku skipped: not asked again for a day (instead of being stored as "other" forever). */
const skippedUntil = new Map<string, number>()

export function classifyUnknown(l: Pick<Loaded, 'unknown' | 'segs' | 'cfg'>, force = false): Promise<void> | null {
  if (classifying) return classifying
  const todo = [...l.unknown.entries()].filter(([, u]) => u.ms >= LOCAL_MIN_MS).sort((a, b) => b[1].ms - a[1].ms)
  if (!todo.length) return null
  const cfg = l.cfg
  classifying = (async () => {
    try {
      // 1. local look-alikes: free, so every waiting title gets a try
      const hash = rulesHash(cfg)
      const seen = [...new Map(l.segs.filter((s) => !s.private).map((s) => [titleKey(s.app, s.title), { app: s.app, title: s.title, domain: s.domain }])).values()]
      const local = await matchLocally(todo.map(([, u]) => u), seen, cfg, titleCache()).catch((err) => {
        console.error('[day] local matching failed:', (err as Error).message)
        return {} as Record<string, string>
      })
      if (Object.keys(local).length) addToLocalCache(hash, local)
      // 2. Haiku for the rest, in batches
      const lv = levelOf(cfg)
      if (!lv || Date.now() < classifyBackoffUntil) return
      const now = Date.now()
      const rest = todo.filter(([k, u]) => !local[k] && u.ms >= AI_MIN_MS && (skippedUntil.get(k) ?? 0) < now)
      const restMs = rest.reduce((n, [, u]) => n + u.ms, 0)
      if (!rest.length || (!force && rest.length < lv.batchTitles && restMs < lv.batchMs)) return
      if (await overUsageCap()) {
        classifyBackoffUntil = Date.now() + 30 * 60_000
        return
      }
      for (let i = 0; i < rest.length; i += MAX_TITLES_PER_CALL) {
        const batch = rest.slice(i, i + MAX_TITLES_PER_CALL)
        const res = await classifyTitles(batch.map(([, u]) => ({ app: u.app, title: u.domain ? `${u.title} (${u.domain})` : u.title })), cfg.categories)
        const entries: Record<string, string> = {}
        batch.forEach(([k], j) => {
          if (res[j]) entries[k] = res[j]
          else skippedUntil.set(k, Date.now() + 24 * 3600_000)
        })
        addToCache(entries)
      }
    } catch (err) {
      classifyBackoffUntil = Date.now() + 10 * 60_000
      console.error('[day] classification failed:', (err as Error).message)
    } finally {
      classifying = null
    }
  })()
  return classifying
}

// —— summary jobs ——

const running = new Set<string>()
export const REFRESH_COOLDOWN_MS = 30 * 60_000

/** Stable within a day: what POST /day/card points at. */
export const cardId = (c: Pick<Card, 'device' | 'start'>) => `${c.device}@${c.start}`

type CardText = NonNullable<DayFile['cardText']>[string]

/** The AI text written for a card, found by overlap, so a card that grew or moved a little keeps its text. */
function textFor(c: Card, texts: Record<string, CardText>): CardText | null {
  const a = Date.parse(c.start)
  const b = Date.parse(c.end)
  let best: CardText | null = null
  let bestOverlap = 0
  for (const t of Object.values(texts)) {
    if (t.device !== c.device) continue
    const ta = Date.parse(t.start)
    const tb = Date.parse(t.end)
    const overlap = Math.min(b, tb) - Math.max(a, ta)
    if (overlap > bestOverlap && overlap >= Math.min(b - a, tb - ta) * 0.5) {
      best = t
      bestOverlap = overlap
    }
  }
  return best
}

/** Live cards (built without AI) with the AI's titles and summaries wherever they were written. */
function liveCards(l: Loaded, file: DayFile): Card[] {
  const texts = file.cardText ?? {}
  return buildCards(l.segs, l.catOf, l.cfg.categories).map((c) => {
    const t = textFor(c, texts)
    return t ? { ...c, title: t.title, summary: t.summary } : c
  })
}

/** Older days keep the cards their summary wrote; everything else shows live cards. */
const dayCards = (l: Loaded, file: DayFile): Card[] => (file.cards?.length && !file.cardText ? file.cards : liveCards(l, file))

/** A card for the page: category from its minutes (or the user's pick), the user's rating, the windows inside it. */
function viewCard(c: Card, l: Loaded, edits: Record<string, CardEdit>) {
  const id = cardId(c)
  const e = edits[id] ?? {}
  const locked = !!e.categoryId && l.cfg.categories.some((x) => x.id === e.categoryId)
  const auto = cardCategory(c, l.segs, l.catOf)
  return {
    ...c,
    id,
    categoryId: locked ? e.categoryId! : auto,
    autoCategoryId: auto,
    categoryLocked: locked,
    rating: e.rating ?? null,
    windows: cardWindows(c, l.segs, l.cls, l.catOf),
  }
}

const hm = (iso: string) => {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** The source that is this computer (screenshots are taken here only). */
const localDevice = (cfg: DayConfig) => cfg.sources.find((s) => /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(s.url))?.id

const GENERIC_TITLE = /^(new tab|untitled.*|google chrome|microsoft.? edge|mozilla firefox|program manager|)$/i

/** Titles say too little when one window fills most of a 20+ minute card, or the main title is empty or generic. */
function unclear(c: Card, wins: { title: string; minutes: number }[]): boolean {
  const mins = (Date.parse(c.end) - Date.parse(c.start)) / 60_000
  if (mins < 20 || !wins.length) return false
  return wins[0].minutes >= mins * 0.6 || GENERIC_TITLE.test(wins[0].title.trim())
}

/**
 * How many screenshots a card gets for the AI (like Dayflow reading the screen, but a few frames instead of video):
 * one per ~15 minutes, 2 to 4. Cards with nothing sorted get one more, since the screen is all there is to go on.
 */
function shotCount(c: Card, wins: { how: string; minutes: number }[]): number {
  const mins = (Date.parse(c.end) - Date.parse(c.start)) / 60_000
  const unsorted = wins.filter((w) => w.how === 'none').reduce((n, w) => n + w.minutes, 0)
  return Math.min(4, Math.max(2, Math.round(mins / 15)) + (unsorted >= mins * 0.3 ? 1 : 0))
}

/** Cards per AI call: fewer when they carry screenshots, so one call never holds dozens of images. */
const CARDS_PER_CALL_TEXT = 20
const CARDS_PER_CALL_SHOTS = 6

/** Cards worth describing: finished (ended 15+ min ago, or the day is over), 10+ min long, no AI text yet. */
function cardsToDescribe(cards: Card[], file: DayFile, dayOver: boolean): Card[] {
  const texts = file.cardText ?? {}
  const cutoff = Date.now() - 15 * 60_000
  return cards.filter((c) => (dayOver || Date.parse(c.end) <= cutoff) && Date.parse(c.end) - Date.parse(c.start) >= 10 * 60_000 && !textFor(c, texts))
}

const describing = new Set<string>()

/** Asks Haiku for titles + summaries of finished cards that have none (20 per call). Returns how many it wrote. */
export async function describeDay(date: string, loaded?: Loaded): Promise<number> {
  if (describing.has(date)) return 0
  describing.add(date)
  try {
    const l = loaded ?? (await load(date))
    const file = readDay(date)
    const cards = liveCards(l, file)
    const todo = cardsToDescribe(cards, file, date < today())
    if (!todo.length) return 0
    const catName = new Map(l.cfg.categories.map((c) => [c.id, c.name]))
    const texts = { ...(file.cardText ?? {}) }
    let n = 0
    const shotMode = levelOf(l.cfg)?.shots ?? 'none'
    const here = l.cfg.screenshots.enabled && shotMode !== 'none' ? localDevice(l.cfg) : undefined
    const step = here ? CARDS_PER_CALL_SHOTS : CARDS_PER_CALL_TEXT
    for (let i = 0; i < todo.length; i += step) {
      const batch = todo.slice(i, i + step)
      const before = cards.filter((c) => c.start < batch[0].start && c.summary).slice(-3).map((c) => `${hm(c.start)} ${c.title}`)
      const input: CardInput[] = batch.map((c) => {
        const wins = cardWindows(c, l.segs, l.cls, l.catOf)
        const shots =
          here && c.device === here && (shotMode === 'all' || unclear(c, wins))
            ? pickShots(Date.parse(c.start), Date.parse(c.end), shotMode === 'all' ? shotCount(c, wins) : 2)
                .map((s) => readShot(s.file)?.toString('base64'))
                .filter((x): x is string => !!x)
            : []
        return {
          id: cardId(c),
          time: `${hm(c.start)}-${hm(c.end)}`,
          category: catName.get(cardCategory(c, l.segs, l.catOf)) ?? 'Other',
          windows: wins
            .slice(0, 6)
            .map((w) => `${w.domain ? `${w.domain} · ` : `${w.app}: `}${w.title.slice(0, 80)} (${Math.round(w.minutes)}m)`)
            .join('; '),
          distractions: (c.distractions ?? []).map((d) => `${d.label} (${Math.round(d.minutes)}m)`).join('; '),
          ...(shots.length ? { shots } : {}),
        }
      })
      const out = await describeCards(input, before, l.cfg.categories)
      for (const c of batch) {
        const t = out[cardId(c)]
        if (!t) continue
        texts[cardId(c)] = { start: c.start, end: c.end, device: c.device, title: t.title, summary: t.summary, ...(t.categoryId ? { categoryId: t.categoryId } : {}) }
        n++
      }
      updateDay(date, { cardText: texts, cardsAiAt: new Date().toISOString() })
    }
    return n
  } finally {
    describing.delete(date)
  }
}

/** Cards as text lines: "HH:MM-HH:MM device | category | title | what happened | distractions". */
function cardLines(cards: Card[], l: Loaded): string[] {
  return cards.map((c) => {
    const what =
      c.summary ??
      cardWindows(c, l.segs, l.cls, l.catOf)
        .slice(0, 3)
        .map((w) => `${w.domain ?? w.app}: ${w.title.slice(0, 60)} (${Math.round(w.minutes)}m)`)
        .join('; ')
    const dist = (c.distractions ?? []).map((d) => `${d.label} (${Math.round(d.minutes)}m)`).join('; ')
    return `${hm(c.start)}-${hm(c.end)} ${c.device} | ${cardCategory(c, l.segs, l.catOf)} | ${c.title} | ${what} | ${dist || '-'}`
  })
}

/** A day as text for chat and the standup: totals, the summary when written, and the cards. */
export async function dayDigest(date: string): Promise<{ text: string; active: number }> {
  const l = await load(date)
  const file = readDay(date)
  const t = computeTotals(l.segs, l.catOf, l.cfg.categories)
  const byCat = t.categories.filter((c) => c.minutes >= 1).sort((a, b) => b.minutes - a.minutes).map((c) => `${c.name} ${Math.round(c.minutes)}m`).join(', ')
  const parts = [
    `${date}: active ${Math.round(t.totals.activeMinutes)} min, focus ${Math.round(t.totals.focusMinutes)}, distraction ${Math.round(t.totals.distractionMinutes)}; ${byCat || 'nothing tracked'}`,
  ]
  if (file.summary) parts.push(`Summary: ${file.summary.text}`)
  const lines = cardLines(dayCards(l, file), l)
  if (lines.length) parts.push(`Blocks (time device | category | title | what happened | distractions):\n${lines.join('\n')}`)
  return { text: parts.join('\n'), active: t.totals.activeMinutes }
}

export async function runSummary(date: string): Promise<SummaryStatus> {
  if (running.has(date)) return 'running'
  running.add(date)
  try {
    if (!levelOf(readConfig())) {
      updateDay(date, { summaryStatus: 'none', summaryError: 'AI is off in Settings' })
      return 'none'
    }
    if (await overUsageCap()) {
      updateDay(date, { summaryStatus: 'skipped-usage-cap', summaryError: `weekly usage >= ${USAGE_CAP}%` })
      return 'skipped-usage-cap'
    }
    const l = await load(date)
    // classify first so the cards use real categories
    await classifyUnknown(l, true)
    const l2 = await load(date)
    if (!l2.segs.length) {
      updateDay(date, { summaryStatus: 'none', summaryError: 'no activity' })
      return 'none'
    }
    // name the cards first; if that fails the summary still works from the windows
    await describeDay(date, l2).catch((err) => console.error('[day] card titles failed:', (err as Error).message))
    const file = readDay(date)
    const cards = liveCards(l2, file)
    const t = computeTotals(l2.segs, l2.catOf, l2.cfg.categories)
    const { totals } = t
    const devices = [...new Set(l2.segs.map((s) => s.device))]
    const byCat = t.categories.filter((c) => c.minutes >= 1).sort((a, b) => b.minutes - a.minutes).map((c) => `${c.id} ${Math.round(c.minutes)}`).join(', ')
    const lines = cardLines(cards, l2)
    const input = {
      date,
      compact: lines.join('\n'),
      categories: l2.cfg.categories,
      devices,
      totalsLine: `active ${totals.activeMinutes} min, focus ${totals.focusMinutes}, distraction ${totals.distractionMinutes}, neutral ${totals.neutralMinutes}, ${totals.contextSwitches} app switches; minutes by category: ${byCat}`,
    }
    const hash = createHash('sha1').update(JSON.stringify(input)).digest('hex').slice(0, 16)
    if (file.summary && file.summaryInputHash === hash) {
      // nothing changed since the last summary: keep it, no AI call
      updateDay(date, { summaryStatus: 'fresh', summaryUpdatedAt: new Date().toISOString(), summaryError: null })
      return 'fresh'
    }
    const out = await summarizeDay(input)
    updateDay(date, {
      // live cards from now on (older days had summary-made cards)
      cards: [],
      cardText: readDay(date).cardText ?? {},
      summary: { text: out.summary.text, highlights: out.summary.highlights.slice(0, 3), biggestTimeSink: out.summary.biggestTimeSink },
      summaryStatus: 'fresh',
      summaryUpdatedAt: new Date().toISOString(),
      summaryError: null,
      summaryInputHash: hash,
    })
    return 'fresh'
  } catch (err) {
    const capped = err instanceof UsageCapError
    updateDay(date, { summaryStatus: capped ? 'skipped-usage-cap' : 'error', summaryError: (err as Error).message.slice(0, 300) })
    console.error('[day] summary failed:', (err as Error).message)
    return capped ? 'skipped-usage-cap' : 'error'
  } finally {
    running.delete(date)
  }
}

export type RefreshResult = { ok: true; status: SummaryStatus } | { ok: false; retryAfterSeconds: number }

export function requestRefresh(date: string, now = Date.now()): RefreshResult {
  if (running.has(date)) return { ok: true, status: 'running' }
  const last = readDay(date).lastManualAt
  const since = last ? now - Date.parse(last) : Infinity
  if (since < REFRESH_COOLDOWN_MS) return { ok: false, retryAfterSeconds: Math.ceil((REFRESH_COOLDOWN_MS - since) / 1000) }
  updateDay(date, { lastManualAt: new Date(now).toISOString() })
  void runSummary(date)
  return { ok: true, status: 'running' }
}

function statusOf(date: string, file: ReturnType<typeof readDay>): SummaryStatus {
  if (running.has(date)) return 'running'
  const st = file.summaryStatus ?? 'none'
  if (st !== 'fresh' || !file.summaryUpdatedAt) return file.summary && st === 'error' ? 'error' : st
  const at = Date.parse(file.summaryUpdatedAt)
  const { end } = dayBounds(date)
  // stale: written before the day was over and more than an hour ago
  return at < end && Date.now() - at > 60 * 60_000 ? 'stale' : 'fresh'
}

// —— views ——

export async function buildSummary(date: string) {
  const l = await load(date)
  void classifyUnknown(l)
  const t = computeTotals(l.segs, l.catOf, l.cfg.categories)
  const devices: DeviceState[] = l.data.map((d) => ({
    id: d.source.id,
    name: d.source.name,
    kind: d.source.kind,
    online: d.online,
    lastSeen: d.lastSeen,
    activeMinutes: t.deviceMinutes[d.source.id] ?? 0,
  }))
  const file = readDay(date)
  const timeline = dayCards(l, file).map((c) => viewCard(c, l, file.cardEdits ?? {}))
  if (date < today()) cacheStats(date, t.stats)
  return {
    date,
    generatedAt: new Date().toISOString(),
    timezone: timezone(),
    dayStartHour: l.cfg.dayStartHour,
    devices,
    totals: t.totals,
    targets: l.cfg.targets,
    categories: t.categories,
    timeline,
    topApps: t.topApps,
    summary: file.summary ?? null,
    summaryStatus: statusOf(date, file),
    summaryUpdatedAt: file.summaryUpdatedAt ?? null,
  }
}

function cacheStats(date: string, stats: DayStats) {
  const f = readDay(date)
  // re-cache when a newer classification could have changed it (at most hourly)
  if (f.statsAt && Date.now() - Date.parse(f.statsAt) < 60 * 60_000) return
  updateDay(date, { stats, statsAt: new Date().toISOString() })
}

export async function buildWeek(end: string) {
  const days = []
  const now = today()
  for (let i = 6; i >= 0; i--) {
    const date = shiftDate(end, -i)
    const f = readDay(date)
    let stats = date < now ? f.stats : undefined
    if (!stats) {
      const l = await load(date)
      stats = computeTotals(l.segs, l.catOf, l.cfg.categories).stats
      if (date < now) cacheStats(date, stats)
    }
    days.push({ date, ...stats })
  }
  return { days }
}

// —— scheduler: once a day is over (dayStartHour next morning), summarize it if it has no finished summary ——

let timer: ReturnType<typeof setInterval> | null = null

/** One automatic attempt per day (restarts under bun --watch must not repeat a failed or capped run). */
function autoRun(date: string): void {
  const f = readDay(date)
  if (f.autoTried || running.has(date)) return
  updateDay(date, { autoTried: new Date().toISOString() })
  void runSummary(date)
}

function checkYesterday(): void {
  const y = shiftDate(today(), -1)
  const f = readDay(y)
  const finished = f.summary && f.summaryUpdatedAt && Date.parse(f.summaryUpdatedAt) >= dayBounds(y).end
  if (!finished) autoRun(y)
}

/** Finished cards get their AI titles (and screen-read category) as often as the AI level says; nothing is sent when none finished. */
let lastDescribeTry = 0
let lastClassifyTry = 0

async function describeToday(): Promise<void> {
  const d = today()
  const lv = levelOf(readConfig())
  if (!lv || running.has(d)) return
  if (Date.now() - lastClassifyTry >= lv.classifyEveryMs) {
    lastClassifyTry = Date.now()
    const l = await load(d)
    await classifyUnknown(l)
  }
  const f = readDay(d)
  const last = Math.max(lastDescribeTry, f.cardsAiAt ? Date.parse(f.cardsAiAt) : 0)
  if (Date.now() - last < lv.describeEveryMs) return
  lastDescribeTry = Date.now()
  if (await overUsageCap()) return
  await describeDay(d)
}

let lastPrune = 0

function tick(): void {
  checkYesterday()
  void describeToday().catch((err) => console.error('[day] live cards:', (err as Error).message))
  void checkNudge().catch((err) => console.error('[day] nudge:', (err as Error).message))
  try {
    syncCapture()
    if (Date.now() - lastPrune > 3600_000) {
      lastPrune = Date.now()
      pruneShots(readConfig().screenshots.keepDays)
    }
  } catch (err) {
    console.error('[day] screenshots:', (err as Error).message)
  }
}

export function startScheduler(): void {
  if (timer || process.env.VITEST) return
  setTimeout(tick, 60_000).unref?.()
  timer = setInterval(tick, 60_000)
  timer.unref?.()
}
