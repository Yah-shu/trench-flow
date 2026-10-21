/**
 * Day: config, title cache, per-day files and the AI call log, all under the Day folder
 * (DEFAULT_DAY_DIR in defaults.ts; TRENCHFLOW_DIR overrides it, e.g. in tests).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AI_LEVELS, type AiLevel, type DayConfig, type DayFile, type Source } from './types.ts'
import { DEFAULT_CATEGORIES, DEFAULT_DAY_DIR, DEFAULT_RULES } from './defaults.ts'

export { DEFAULT_CATEGORIES, DEFAULT_RULES }

export const dayRoot = () => process.env.TRENCHFLOW_DIR || DEFAULT_DAY_DIR
export const workDir = () => join(dayRoot(), 'work')
const daysDir = () => join(dayRoot(), 'days')
const logsDir = () => join(dayRoot(), 'logs')

export function ensureDirs(): void {
  for (const d of [dayRoot(), workDir(), daysDir(), logsDir()]) mkdirSync(d, { recursive: true })
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** Write to a temp file then rename, so a crash never leaves half a file. */
export function writeJson(file: string, value: unknown): void {
  ensureDirs()
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2))
  renameSync(tmp, file)
}

export const DEFAULT_SOURCES: Source[] = [{ id: 'desktop', name: 'Desktop', kind: 'desktop', url: 'http://127.0.0.1:5600' }]

export const DEFAULT_CONFIG: DayConfig = {
  sources: DEFAULT_SOURCES,
  targets: { focusHours: 8, distractionBudgetMinutes: 60 },
  categories: DEFAULT_CATEGORIES,
  rules: DEFAULT_RULES,
  // password managers and banking never leave the computer by default
  private: { apps: ['^(1password|bitwarden|keepass(xc)?|lastpass|dashlane|keychain access)$'], titles: ['\\b(online banking|password manager|passwords?)\\b'] },
  screenshots: { enabled: false, everySeconds: 60, keepDays: 7 },
  nudges: { enabled: false, afterMinutes: 20, quietMinutes: 30 },
  dayStartHour: 4,
  aiLevel: 'medium',
}

const configFile = () => join(dayRoot(), 'config.json')

export function readConfig(): DayConfig {
  const c = readJson<Partial<DayConfig>>(configFile(), {})
  const h = Number(c.dayStartHour)
  return {
    sources: Array.isArray(c.sources) && c.sources.length ? c.sources : DEFAULT_CONFIG.sources,
    targets: { ...DEFAULT_CONFIG.targets, ...(c.targets ?? {}) },
    categories: Array.isArray(c.categories) && c.categories.length ? c.categories : DEFAULT_CONFIG.categories,
    rules: Array.isArray(c.rules) ? c.rules : DEFAULT_CONFIG.rules,
    private: {
      apps: Array.isArray(c.private?.apps) ? c.private.apps : DEFAULT_CONFIG.private.apps,
      titles: Array.isArray(c.private?.titles) ? c.private.titles : DEFAULT_CONFIG.private.titles,
    },
    screenshots: { ...DEFAULT_CONFIG.screenshots, ...(c.screenshots ?? {}) },
    nudges: { ...DEFAULT_CONFIG.nudges, ...(c.nudges ?? {}) },
    dayStartHour: Number.isInteger(h) && h >= 0 && h <= 12 ? h : DEFAULT_CONFIG.dayStartHour,
    aiLevel: AI_LEVELS.includes(c.aiLevel as AiLevel) ? (c.aiLevel as AiLevel) : DEFAULT_CONFIG.aiLevel,
  }
}

export function writeConfig(c: DayConfig): void {
  writeJson(configFile(), c)
}

/** First start: write the defaults so the file can be edited by hand too. */
export function initConfig(): void {
  ensureDirs()
  if (!existsSync(configFile())) writeConfig(DEFAULT_CONFIG)
}

// —— title caches: "app\u0001normalized title" -> categoryId ——
// title-cache.json = Haiku's answers, kept forever. title-cache-local.json = the local look-alike matcher's answers
// (embed.ts), thrown away whenever the rules or categories change.

const cacheFile = () => join(dayRoot(), 'title-cache.json')
const localCacheFile = () => join(dayRoot(), 'title-cache-local.json')
let cache: Record<string, string> | null = null
let localCache: { rulesHash: string; map: Record<string, string> } | null = null

/** Titles that differ only by counters or numbers share one key: "Inbox (113)", "Docs and 6 more pages", "Order #1042". */
export const normTitle = (title: string) =>
  title
    .replace(/\s+and \d+ more pages?\b/gi, '')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()

export const titleKey = (app: string, title: string) => `${app.toLowerCase().replace(/\.exe$/, '')}\u0001${normTitle(title)}`

export function titleCache(): Record<string, string> {
  if (cache) return cache
  const raw = readJson<Record<string, string>>(cacheFile(), {})
  // older files used the exact title as key: re-key once, a real category beats "other"
  const next: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    const i = k.indexOf('\u0001')
    const nk = i < 0 ? k : titleKey(k.slice(0, i), k.slice(i + 1))
    if (!next[nk] || next[nk] === 'other') next[nk] = v
  }
  cache = next
  if (Object.keys(next).length !== Object.keys(raw).length || Object.keys(raw).some((k) => !(k in next))) writeJson(cacheFile(), next)
  return cache
}

export function addToCache(entries: Record<string, string>): void {
  const c = titleCache()
  Object.assign(c, entries)
  writeJson(cacheFile(), c)
}

export function localTitleCache(rulesHash: string): Record<string, string> {
  localCache ??= readJson(localCacheFile(), { rulesHash, map: {} })
  if (localCache.rulesHash !== rulesHash) localCache = { rulesHash, map: {} }
  return localCache.map
}

export function addToLocalCache(rulesHash: string, entries: Record<string, string>): void {
  Object.assign(localTitleCache(rulesHash), entries)
  writeJson(localCacheFile(), localCache)
}

// —— the user's own labels (key -> categoryId): beat rules and every cache ——

const labelsFile = () => join(dayRoot(), 'title-labels.json')
let labels: Record<string, string> | null = null

export const userLabels = (): Record<string, string> => (labels ??= readJson<Record<string, string>>(labelsFile(), {}))

export function setUserLabel(key: string, categoryId: string | null): void {
  const l = userLabels()
  if (categoryId) l[key] = categoryId
  else delete l[key]
  writeJson(labelsFile(), l)
}

/** Tests only. */
export function resetCacheMemo(): void {
  cache = null
  localCache = null
  labels = null
}

// —— day files ——

const dayFile = (date: string) => join(daysDir(), `${date}.json`)
export const readDay = (date: string): DayFile => readJson<DayFile>(dayFile(date), {})
export function updateDay(date: string, patch: Partial<DayFile>): DayFile {
  const next = { ...readDay(date), ...patch }
  writeJson(dayFile(date), next)
  return next
}

// —— AI call log: sizes and durations only, never content ——

export function logCall(entry: Record<string, unknown>): void {
  try {
    ensureDirs()
    const month = new Date().toISOString().slice(0, 7)
    appendFileSync(join(logsDir(), `ai-${month}.jsonl`), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`)
  } catch {
    // logging never breaks a run
  }
}
