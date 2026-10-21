/**
 * Day API (/api/day/*): summary, manual refresh, week, settings. Bodies follow the Day contract directly
 * (no { data } wrapper); errors are { error }.
 */
import { Hono } from 'hono'
import { initConfig, readConfig, readDay, setUserLabel, titleKey, updateDay, writeConfig } from './store.ts'
import { askDay, getStandup, makeStandup } from './assist.ts'
import { listShots, readShot } from './capture.ts'
import { streakNow } from './nudge.ts'
import { buildSummary, buildWeek, dayBounds, isDate, requestRefresh, startScheduler, today } from './service.ts'
import { AI_LEVELS, type AiLevel, type Category, type DayConfig, type NudgeSettings, type PrivateList, type Rating, type Rule, type ScreenshotSettings, type Source, type Targets } from './types.ts'

export const dayRoutes = new Hono()

try {
  initConfig()
  startScheduler()
} catch (err) {
  console.error('[day] init failed:', (err as Error).message)
}

const dateParam = (v: string | undefined) => (v === undefined || v === '' ? today() : isDate(v) ? v : null)

dayRoutes.get('/day/summary', async (c) => {
  const date = dateParam(c.req.query('date'))
  if (!date) return c.json({ error: 'date must be YYYY-MM-DD' }, 400)
  return c.json(await buildSummary(date))
})

dayRoutes.post('/day/summary/refresh', (c) => {
  const date = dateParam(c.req.query('date'))
  if (!date) return c.json({ error: 'date must be YYYY-MM-DD' }, 400)
  const r = requestRefresh(date)
  if (!r.ok) {
    c.header('Retry-After', String(r.retryAfterSeconds))
    return c.json({ retryAfterSeconds: r.retryAfterSeconds }, 429)
  }
  return c.json({ status: r.status }, 202)
})

dayRoutes.get('/day/week', async (c) => {
  const end = dateParam(c.req.query('end'))
  if (!end) return c.json({ error: 'end must be YYYY-MM-DD' }, 400)
  return c.json(await buildWeek(end))
})

const publicSettings = (cfg: DayConfig) => ({
  targets: cfg.targets,
  categories: cfg.categories,
  sources: cfg.sources,
  dayStartHour: cfg.dayStartHour,
  rules: cfg.rules,
  private: cfg.private,
  screenshots: cfg.screenshots,
  nudges: cfg.nudges,
  aiLevel: cfg.aiLevel,
})

dayRoutes.get('/day/settings', (c) => c.json(publicSettings(readConfig())))

const ID = /^[a-z0-9][a-z0-9_-]{0,31}$/
const str = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max
/** A pattern the user typed: a valid case-insensitive regular expression of at most 300 characters. */
const pattern = (v: unknown) => {
  if (typeof v !== 'string' || !v.trim() || v.length > 300) return false
  try {
    new RegExp(v, 'i')
    return true
  } catch {
    return false
  }
}

export function validateSettings(body: unknown, current: DayConfig): { ok: true; cfg: DayConfig } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body must be an object' }
  const b = body as Partial<Record<'targets' | 'categories' | 'sources' | 'dayStartHour' | 'rules' | 'private' | 'screenshots' | 'nudges' | 'aiLevel', unknown>>
  const next: DayConfig = { ...current }
  if (b.dayStartHour !== undefined) {
    const h = b.dayStartHour
    if (typeof h !== 'number' || !Number.isInteger(h) || h < 0 || h > 12) return { ok: false, error: 'dayStartHour must be a whole hour 0-12' }
    next.dayStartHour = h
  }
  if (b.targets !== undefined) {
    const t = b.targets as Partial<Targets>
    if (!t || typeof t !== 'object') return { ok: false, error: 'targets must be an object' }
    const focusHours = t.focusHours ?? current.targets.focusHours
    const budget = t.distractionBudgetMinutes ?? current.targets.distractionBudgetMinutes
    if (typeof focusHours !== 'number' || !(focusHours >= 0 && focusHours <= 24)) return { ok: false, error: 'focusHours must be 0-24' }
    if (typeof budget !== 'number' || !(budget >= 0 && budget <= 1440)) return { ok: false, error: 'distractionBudgetMinutes must be 0-1440' }
    next.targets = { focusHours, distractionBudgetMinutes: Math.round(budget) }
  }
  if (b.categories !== undefined) {
    if (!Array.isArray(b.categories) || !b.categories.length || b.categories.length > 40) return { ok: false, error: 'categories must be a list of 1-40' }
    const seen = new Set<string>()
    const cats: Category[] = []
    for (const raw of b.categories as Partial<Category>[]) {
      if (!raw || !ID.test(String(raw.id)) || seen.has(String(raw.id))) return { ok: false, error: `bad or duplicate category id: ${String(raw?.id)}` }
      if (!str(raw.name, 40)) return { ok: false, error: `category ${raw.id}: name required (≤40)` }
      if (!['focus', 'distraction', 'neutral'].includes(String(raw.kind))) return { ok: false, error: `category ${raw.id}: kind must be focus|distraction|neutral` }
      if (!str(raw.color, 24) || !/^[a-z][a-z0-9-]*$/.test(String(raw.color))) return { ok: false, error: `category ${raw.id}: color must be a token name` }
      seen.add(String(raw.id))
      cats.push({ id: String(raw.id), name: String(raw.name).trim(), kind: raw.kind as Category['kind'], color: String(raw.color) })
    }
    if (!seen.has('other')) return { ok: false, error: 'the "other" category must stay' }
    next.categories = cats
    // rules pointing at a removed category are dropped
    next.rules = current.rules.filter((r: Rule) => seen.has(r.categoryId))
  }
  if (b.sources !== undefined) {
    if (!Array.isArray(b.sources) || !b.sources.length || b.sources.length > 10) return { ok: false, error: 'sources must be a list of 1-10' }
    const seen = new Set<string>()
    const srcs: Source[] = []
    for (const raw of b.sources as Partial<Source>[]) {
      if (!raw || !ID.test(String(raw.id)) || seen.has(String(raw.id))) return { ok: false, error: `bad or duplicate source id: ${String(raw?.id)}` }
      if (!str(raw.name, 40) || !str(raw.kind, 20)) return { ok: false, error: `source ${raw.id}: name and kind required` }
      let u: URL
      try {
        u = new URL(String(raw.url))
      } catch {
        return { ok: false, error: `source ${raw.id}: url is not valid` }
      }
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return { ok: false, error: `source ${raw.id}: url must be http(s) without credentials` }
      seen.add(String(raw.id))
      srcs.push({ id: String(raw.id), name: String(raw.name).trim(), kind: String(raw.kind).trim(), url: u.origin + u.pathname.replace(/\/+$/, '') })
    }
    next.sources = srcs
  }
  if (b.rules !== undefined) {
    if (!Array.isArray(b.rules) || b.rules.length > 300) return { ok: false, error: 'rules must be a list of up to 300' }
    const ids = new Set(next.categories.map((c) => c.id))
    const rules: Rule[] = []
    for (const [i, raw] of (b.rules as Partial<Rule>[]).entries()) {
      const n = i + 1
      if (!raw || !ids.has(String(raw.categoryId))) return { ok: false, error: `rule ${n}: pick a category` }
      const r: Rule = { categoryId: String(raw.categoryId) }
      for (const f of ['app', 'title', 'domain'] as const) {
        const v = raw[f]
        if (v === undefined || v === null || v === '') continue
        if (!pattern(v)) return { ok: false, error: `rule ${n}: the ${f === 'domain' ? 'website' : f} pattern is not valid` }
        r[f] = String(v)
      }
      if (!r.app && !r.title && !r.domain) return { ok: false, error: `rule ${n}: needs an app, title or website pattern` }
      rules.push(r)
    }
    next.rules = rules
  }
  if (b.private !== undefined) {
    const p = b.private as Partial<PrivateList>
    if (!p || typeof p !== 'object') return { ok: false, error: 'private must be an object' }
    const priv: PrivateList = { ...next.private }
    for (const f of ['apps', 'titles'] as const) {
      if (p[f] === undefined) continue
      const list = p[f]
      if (!Array.isArray(list) || list.length > 100) return { ok: false, error: `private ${f} must be a list of up to 100` }
      const clean = list.map((v) => String(v ?? '').trim()).filter(Boolean)
      const bad = clean.find((v) => !pattern(v))
      if (bad !== undefined) return { ok: false, error: `private ${f}: "${bad.slice(0, 40)}" is not a valid pattern` }
      priv[f] = clean
    }
    next.private = priv
  }
  if (b.screenshots !== undefined) {
    const sc = b.screenshots as Partial<ScreenshotSettings>
    if (!sc || typeof sc !== 'object') return { ok: false, error: 'screenshots must be an object' }
    const v: ScreenshotSettings = { ...next.screenshots, ...sc }
    if (typeof v.enabled !== 'boolean') return { ok: false, error: 'screenshots.enabled must be true or false' }
    if (!Number.isInteger(v.everySeconds) || v.everySeconds < 15 || v.everySeconds > 600) return { ok: false, error: 'screenshots every 15-600 seconds' }
    if (!Number.isInteger(v.keepDays) || v.keepDays < 1 || v.keepDays > 60) return { ok: false, error: 'keep screenshots 1-60 days' }
    next.screenshots = { enabled: v.enabled, everySeconds: v.everySeconds, keepDays: v.keepDays }
  }
  if (b.aiLevel !== undefined) {
    if (!AI_LEVELS.includes(b.aiLevel as AiLevel)) return { ok: false, error: `aiLevel must be one of ${AI_LEVELS.join(', ')}` }
    next.aiLevel = b.aiLevel as AiLevel
  }
  if (b.nudges !== undefined) {
    const nu = b.nudges as Partial<NudgeSettings>
    if (!nu || typeof nu !== 'object') return { ok: false, error: 'nudges must be an object' }
    const v: NudgeSettings = { ...next.nudges, ...nu }
    if (typeof v.enabled !== 'boolean') return { ok: false, error: 'nudges.enabled must be true or false' }
    if (!Number.isInteger(v.afterMinutes) || v.afterMinutes < 5 || v.afterMinutes > 240) return { ok: false, error: 'nudge after 5-240 minutes' }
    if (!Number.isInteger(v.quietMinutes) || v.quietMinutes < 5 || v.quietMinutes > 480) return { ok: false, error: 'quiet time 5-480 minutes' }
    next.nudges = { enabled: v.enabled, afterMinutes: v.afterMinutes, quietMinutes: v.quietMinutes }
  }
  return { ok: true, cfg: next }
}

dayRoutes.put('/day/settings', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid JSON' }, 400)
  }
  const r = validateSettings(body, readConfig())
  if (!r.ok) return c.json({ error: r.error }, 400)
  writeConfig(r.cfg)
  return c.json(publicSettings(r.cfg))
})

// —— the fix-it loop: label a window, rate or pin a card ——

dayRoutes.post('/day/label', async (c) => {
  const b = (await c.req.json().catch(() => null)) as { app?: unknown; title?: unknown; categoryId?: unknown } | null
  if (!b || typeof b.app !== 'string' || !b.app || typeof b.title !== 'string' || b.app.length > 200 || b.title.length > 1000) return c.json({ error: 'app and title required' }, 400)
  const cat = b.categoryId
  if (cat !== null && !readConfig().categories.some((x) => x.id === cat)) return c.json({ error: 'unknown category' }, 400)
  setUserLabel(titleKey(b.app, b.title), cat as string | null)
  return c.json({ ok: true })
})

const RATINGS: Rating[] = ['focused', 'neutral', 'distracted']

dayRoutes.post('/day/card', async (c) => {
  const date = dateParam(c.req.query('date'))
  if (!date) return c.json({ error: 'date must be YYYY-MM-DD' }, 400)
  const b = (await c.req.json().catch(() => null)) as { id?: unknown; rating?: unknown; categoryId?: unknown } | null
  if (!b || typeof b.id !== 'string' || !b.id || b.id.length > 120) return c.json({ error: 'id required' }, 400)
  if (b.rating !== undefined && b.rating !== null && !RATINGS.includes(b.rating as Rating)) return c.json({ error: 'rating must be focused, neutral or distracted' }, 400)
  if (b.categoryId !== undefined && b.categoryId !== null && !readConfig().categories.some((x) => x.id === b.categoryId)) return c.json({ error: 'unknown category' }, 400)
  const edits = { ...(readDay(date).cardEdits ?? {}) }
  const e = { ...(edits[b.id] ?? {}) }
  if (b.rating !== undefined) {
    if (b.rating === null) delete e.rating
    else e.rating = b.rating as Rating
  }
  if (b.categoryId !== undefined) {
    if (b.categoryId === null) delete e.categoryId
    else e.categoryId = b.categoryId as string
  }
  if (Object.keys(e).length) edits[b.id] = e
  else delete edits[b.id]
  updateDay(date, { cardEdits: edits })
  return c.json({ ok: true })
})

// —— screenshots: list for a stretch of a day, and one image ——

dayRoutes.get('/day/shots', (c) => {
  const date = dateParam(c.req.query('date'))
  if (!date) return c.json({ error: 'date must be YYYY-MM-DD' }, 400)
  const { start, end } = dayBounds(date)
  const from = c.req.query('from') ? Date.parse(String(c.req.query('from'))) : start
  const to = c.req.query('to') ? Date.parse(String(c.req.query('to'))) : end
  if (Number.isNaN(from) || Number.isNaN(to)) return c.json({ error: 'from/to must be ISO times' }, 400)
  return c.json({ shots: listShots(Math.max(from, start), Math.min(to, end)) })
})

dayRoutes.get('/day/shot', (c) => {
  const img = readShot(String(c.req.query('f') ?? ''))
  if (!img) return c.json({ error: 'not found' }, 404)
  return c.body(new Uint8Array(img), 200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400' })
})

// —— right now, chat, standup ——

dayRoutes.get('/day/streak', async (c) => c.json({ streak: await streakNow().catch(() => null) }))

dayRoutes.post('/day/chat', async (c) => {
  const date = dateParam(c.req.query('date'))
  if (!date) return c.json({ error: 'date must be YYYY-MM-DD' }, 400)
  const b = (await c.req.json().catch(() => null)) as { question?: unknown; history?: unknown } | null
  const q = typeof b?.question === 'string' ? b.question.trim() : ''
  if (!q || q.length > 500) return c.json({ error: 'ask a question (up to 500 characters)' }, 400)
  const history = (Array.isArray(b?.history) ? b!.history : [])
    .filter((h): h is { role: 'you' | 'day'; text: string } => !!h && typeof h === 'object' && ['you', 'day'].includes((h as { role?: string }).role ?? '') && typeof (h as { text?: unknown }).text === 'string')
    .slice(-6)
    .map((h) => ({ role: h.role, text: h.text.slice(0, 1000) }))
  const r = await askDay(date, q, history)
  return 'error' in r ? c.json(r, r.status) : c.json(r)
})

dayRoutes.get('/day/standup', (c) => {
  const date = dateParam(c.req.query('date'))
  if (!date) return c.json({ error: 'date must be YYYY-MM-DD' }, 400)
  return c.json({ standup: getStandup(date) })
})

dayRoutes.post('/day/standup', async (c) => {
  const date = dateParam(c.req.query('date'))
  if (!date) return c.json({ error: 'date must be YYYY-MM-DD' }, 400)
  const r = await makeStandup(date)
  return 'error' in r ? c.json(r, r.status) : c.json(r)
})
