/** The Day page's data — the /api/day contract (server/day/, built separately). */

export type CategoryKind = 'focus' | 'distraction' | 'neutral'
export type SummaryStatus = 'none' | 'fresh' | 'stale' | 'running' | 'skipped-usage-cap' | 'error'

export interface DayDevice {
  id: string
  name: string
  kind: 'desktop' | 'mac' | 'phone'
  online: boolean
  lastSeen: string | null
  activeMinutes: number
}

export interface DayCategory {
  id: string
  name: string
  kind: CategoryKind
  /** A colour token: coral, ink, sky, sun, leaf, plum, sand, slate, teal, rose. */
  color: string
  minutes: number
}

export interface DayTargets {
  focusHours: number
  distractionBudgetMinutes: number
}

/** How a window got its category: a rule, the AI, a look-alike of a labelled window, you, or nothing yet. */
export type CategoryHow = 'rule' | 'ai' | 'local' | 'you' | 'none'
export type CardRating = 'focused' | 'neutral' | 'distracted'

export interface TimelineWindow {
  app: string
  title: string
  domain: string | null
  minutes: number
  categoryId: string
  how: CategoryHow
  /** A private window: its title never left this computer, so it can't be labelled. */
  private: boolean
}

export interface TimelineItem {
  /** Stable within a day — what POST /api/day/card points at. */
  id: string
  start: string
  end: string
  device: string
  categoryId: string
  title: string
  /** null until the AI has described the card; `title` is the main window label until then. */
  summary: string | null
  /** The biggest windows inside the card, biggest first, up to 8. */
  windows: TimelineWindow[]
  rating: CardRating | null
  /** True when the user picked the card's category by hand. */
  categoryLocked: boolean
  /** What "Auto" would pick — shown in the card's category select even when it's locked. */
  autoCategoryId: string
  /** Distracting windows inside a non-distraction card. */
  distractions?: { label: string; minutes: number }[]
  /** The main window per 5 minutes, repeats removed (up to 24 lines). */
  log?: { at: string; text: string }[]
}

export interface DaySummary {
  date: string
  generatedAt: string
  timezone: string
  devices: DayDevice[]
  totals: {
    activeMinutes: number
    focusMinutes: number
    distractionMinutes: number
    neutralMinutes: number
    contextSwitches: number
  }
  targets: DayTargets
  categories: DayCategory[]
  timeline: TimelineItem[]
  topApps: { app: string; minutes: number; categoryId: string }[]
  summary: { text: string; highlights: string[]; biggestTimeSink: { label: string; minutes: number } | null } | null
  summaryStatus: SummaryStatus
  summaryUpdatedAt: string | null
  /** Local hour the day starts (a late night counts to the day before). */
  dayStartHour?: number
}

export interface WeekDay {
  date: string
  activeMinutes: number
  focusMinutes: number
  distractionMinutes: number
  byCategory: Record<string, number>
}

/** A category rule: case-insensitive patterns, first match wins; `app` ignores a trailing .exe. */
export interface DayRule {
  categoryId: string
  app?: string
  title?: string
  domain?: string
}

/** Apps / window titles whose titles never leave this computer (one pattern each). */
export interface DayPrivate {
  apps: string[]
  titles: string[]
}

/** Small screenshots of the window in front, kept on this computer. */
export interface ShotSettings {
  enabled: boolean
  /** 15–600 */
  everySeconds: number
  /** 1–60 */
  keepDays: number
}

/** A desktop notification after a run of distraction. */
export interface NudgeSettings {
  enabled: boolean
  /** 5–240 */
  afterMinutes: number
  /** 5–480 */
  quietMinutes: number
}

export interface DaySettings {
  targets: DayTargets
  categories: unknown
  sources: unknown
  dayStartHour: number
  rules: DayRule[]
  private: DayPrivate
  screenshots: ShotSettings
  nudges: NudgeSettings
  /** How much the AI does; older servers don't send it. */
  aiLevel?: AiLevel
}

export type AiLevel = 'off' | 'low' | 'medium' | 'high'

/** One screenshot (about one a minute while active). `file` goes to /api/day/shot?f=. */
export interface DayShot {
  t: string
  file: string
  app: string
  title: string
}

/** The distraction run going on right now (today only). */
export interface DayStreak {
  minutes: number
  label: string
  since: string
}

export interface ChatTurn {
  role: 'you' | 'day'
  text: string
}

export interface Standup {
  yesterday: string[]
  today: string[]
  blockers: string[]
  at: string
}
