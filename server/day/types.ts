export type CategoryKind = 'focus' | 'distraction' | 'neutral'

export interface Category {
  id: string
  name: string
  kind: CategoryKind
  /** Color token name for the UI (coral, ink, sky, sun, leaf, plum, sand, slate, ...). */
  color: string
}

export interface Rule {
  categoryId: string
  app?: string
  title?: string
  /** Website pattern, matched against the domain the browser extension reports (e.g. "tiktok\.com"). */
  domain?: string
}

/** Apps and window titles (patterns) whose titles never leave this computer. */
export interface PrivateList {
  apps: string[]
  titles: string[]
}

/** Smart screenshots (Windows and macOS): a small shot of the screen in front every `everySeconds`, kept `keepDays` days. */
export interface ScreenshotSettings {
  enabled: boolean
  everySeconds: number
  keepDays: number
}

/** A desktop notification after `afterMinutes` of distraction in a row, then quiet for `quietMinutes`. */
export interface NudgeSettings {
  enabled: boolean
  afterMinutes: number
  quietMinutes: number
}

export interface Source {
  id: string
  name: string
  kind: string
  url: string
}

export interface Targets {
  focusHours: number
  distractionBudgetMinutes: number
}

export interface DayConfig {
  sources: Source[]
  targets: Targets
  categories: Category[]
  rules: Rule[]
  private: PrivateList
  screenshots: ScreenshotSettings
  nudges: NudgeSettings
  /** Local hour a day starts (0-12), so a night that runs past midnight stays one day. */
  dayStartHour: number
  /** How much the AI does (and spends): off = rules and look-alikes only, no AI calls at all. See service.ts LEVELS. */
  aiLevel: AiLevel
}

export type AiLevel = 'off' | 'low' | 'medium' | 'high'
export const AI_LEVELS: AiLevel[] = ['off', 'low', 'medium', 'high']

/** One stretch of active time on one device, in epoch ms. */
export interface Segment {
  start: number
  end: number
  device: string
  app: string
  title: string
  /** Website of the active browser tab (aw-watcher-web), when the window is that tab. */
  domain?: string
  /** Matched the private list: the title is already replaced. */
  private?: boolean
}

export interface Card {
  start: string
  end: string
  device: string
  categoryId: string
  title: string
  summary: string | null
  /** Distracting windows inside a non-distraction card, biggest first (live cards only). */
  distractions?: { label: string; minutes: number }[]
  /** Main window per 5 minutes, repeats removed (live cards only). */
  log?: { at: string; text: string }[]
}

export interface DaySummary {
  text: string
  highlights: string[]
  biggestTimeSink: { label: string; minutes: number }
}

export type SummaryStatus = 'none' | 'fresh' | 'stale' | 'running' | 'skipped-usage-cap' | 'error'

export interface DayStats {
  activeMinutes: number
  focusMinutes: number
  distractionMinutes: number
  byCategory: Record<string, number>
}

export interface DayFile {
  cards?: Card[]
  summary?: DaySummary | null
  summaryStatus?: SummaryStatus
  summaryUpdatedAt?: string | null
  summaryError?: string | null
  lastManualAt?: string | null
  /** When the scheduler made its one automatic attempt. */
  autoTried?: string
  /** Stats of a finished day (cached for the week view). */
  stats?: DayStats
  statsAt?: string
  /** AI titles + summaries of live cards, by card id (matched to cards by overlap). */
  /** AI text per card; categoryId = what the screenshots and titles say it was (fills in time no rule or title answer sorted). */
  cardText?: Record<string, { start: string; end: string; device: string; title: string; summary: string; categoryId?: string }>
  /** When card titles were last written. */
  cardsAiAt?: string
  /** The user's edits per card id: rating and a hand-set category. */
  cardEdits?: Record<string, CardEdit>
  /** Morning standup made from the day before (and the morning so far). */
  standup?: Standup
  /** Hash of what the last summary was made from; an unchanged day is not sent to the AI again. */
  summaryInputHash?: string
}

export interface DeviceState {
  id: string
  name: string
  kind: string
  online: boolean
  lastSeen: string | null
  activeMinutes: number
}

export type Rating = 'focused' | 'neutral' | 'distracted'

export interface CardEdit {
  rating?: Rating
  categoryId?: string
}

export interface Standup {
  yesterday: string[]
  today: string[]
  blockers: string[]
  at: string
}
