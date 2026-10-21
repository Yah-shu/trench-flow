/**
 * /api/day client (server/day/). When the API isn't there (not built yet, server down), the
 * reads fall back to fixture.ts and say so with `sample: true`, so the page shows a badge.
 */
import { fixtureStandup, fixtureSummary, fixtureWeek } from './fixture.ts'
import { rememberDayStart } from './format.ts'
import type { CardRating, ChatTurn, DaySettings, DayShot, DayStreak, DaySummary, DayTargets, Standup, WeekDay } from './types.ts'

export interface Loaded<T> {
  data: T
  sample: boolean
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

export async function getSummary(date: string): Promise<Loaded<DaySummary>> {
  try {
    const data = await getJson<DaySummary>(`/api/day/summary?date=${encodeURIComponent(date)}`)
    rememberDayStart(data.dayStartHour)
    return { data, sample: false }
  } catch {
    return { data: fixtureSummary(date), sample: true }
  }
}

export async function getWeek(end: string): Promise<Loaded<WeekDay[]>> {
  try {
    const w = await getJson<{ days: WeekDay[] }>(`/api/day/week?end=${encodeURIComponent(end)}`)
    return { data: w.days ?? [], sample: false }
  } catch {
    return { data: fixtureWeek(end), sample: true }
  }
}

export type RefreshResult = { ok: true; status: string } | { ok: false; retryAfterSeconds: number } | { ok: false; error: string }

/** Ask for a new AI summary. 429 comes back as a wait time, not an error. */
export async function refreshSummary(date: string): Promise<RefreshResult> {
  try {
    const res = await fetch(`/api/day/summary/refresh?date=${encodeURIComponent(date)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date }),
    })
    const body = (await res.json().catch(() => ({}))) as { status?: string; retryAfterSeconds?: number; error?: string }
    if (res.status === 429) return { ok: false, retryAfterSeconds: Math.max(1, Math.round(body.retryAfterSeconds ?? 60)) }
    if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` }
    return { ok: true, status: body.status ?? 'running' }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function getSettings(): Promise<DaySettings> {
  return getJson<DaySettings>('/api/day/settings')
}

/**
 * Every write goes through here: a network failure or a server error becomes one friendly
 * message (the server's own `{ error }` when it sends one), so the page can just show it.
 */
/** A failed write; `status` is 0 when the server didn't answer at all. */
export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

const NOT_ANSWERING = 'The tracker server isn’t answering, so this can’t be saved right now.'

async function send<T>(method: 'POST' | 'PUT', url: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    throw new ApiError(NOT_ANSWERING, 0)
  }
  const out = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) {
    if (out.error) throw new ApiError(out.error, res.status)
    throw new ApiError(res.status === 404 || res.status >= 500 ? NOT_ANSWERING : `Couldn’t save (HTTP ${res.status})`, res.status)
  }
  return out
}

/** Only the targets go up — PUT takes any subset, so rules saved elsewhere are never overwritten. */
export async function putTargets(targets: DayTargets, _current?: DaySettings | null): Promise<DaySettings> {
  return putSettings({ targets })
}

/** Save any part of the settings; the server answers with the whole lot. */
export async function putSettings(patch: Partial<DaySettings>): Promise<DaySettings> {
  return send<DaySettings>('PUT', '/api/day/settings', patch)
}

/** Label a window (and its look-alikes that differ only by numbers) everywhere; null removes your label. */
export async function postLabel(app: string, title: string, categoryId: string | null): Promise<void> {
  await send('POST', '/api/day/label', { app, title, categoryId })
}

/** Rate a timeline card or pin its category; null clears that field. */
export async function postCard(date: string, id: string, patch: { rating?: CardRating | null; categoryId?: string | null }): Promise<void> {
  await send('POST', `/api/day/card?date=${encodeURIComponent(date)}`, { id, ...patch })
}

/** Screenshots between two times (empty when there are none, or the server is down). */
export async function getShots(date: string, from: string, to: string): Promise<DayShot[]> {
  try {
    const q = new URLSearchParams({ date, from, to })
    const r = await getJson<{ shots?: DayShot[] }>(`/api/day/shots?${q}`)
    return r.shots ?? []
  } catch {
    return []
  }
}

export const shotUrl = (file: string): string => `/api/day/shot?f=${encodeURIComponent(file)}`

/** The distraction run going on right now; null when there isn't one (or no server). */
export async function getStreak(): Promise<DayStreak | null> {
  try {
    return (await getJson<{ streak: DayStreak | null }>('/api/day/streak')).streak ?? null
  } catch {
    return null
  }
}

/** Ask a question about the day. Throws ApiError (409 busy, 429 usage cap). */
export async function postChat(date: string, question: string, history: ChatTurn[]): Promise<string> {
  const r = await send<{ answer?: string }>('POST', `/api/day/chat?date=${encodeURIComponent(date)}`, { question, history })
  return r.answer ?? ''
}

export async function getStandup(date: string): Promise<Loaded<Standup | null>> {
  try {
    const r = await getJson<{ standup: Standup | null }>(`/api/day/standup?date=${encodeURIComponent(date)}`)
    return { data: r.standup ?? null, sample: false }
  } catch {
    return { data: fixtureStandup(date), sample: true }
  }
}

/** Write (or rewrite) the standup. Throws ApiError (400 nothing tracked, 409, 429). */
export async function postStandup(date: string): Promise<Standup | null> {
  const r = await send<{ standup?: Standup | null }>('POST', `/api/day/standup?date=${encodeURIComponent(date)}`, {})
  return r.standup ?? null
}
