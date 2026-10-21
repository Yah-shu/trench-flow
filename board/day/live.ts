/** Pure helpers for the live bits of the Day page: replay, the right-now banner, chat, standup, settings ranges. */
import type { ChatTurn, DayStreak } from './types.ts'
import { fmtShort } from './format.ts'

/** Keep a shot index inside 0…n-1 (0 when there are no shots). */
export function clampIndex(i: number, n: number): number {
  if (n <= 0) return 0
  return Math.min(n - 1, Math.max(0, Math.round(i)))
}

/** The next few indexes to preload after `i` (never past the end). */
export function preloadAhead(i: number, n: number, ahead = 2): number[] {
  const out: number[] = []
  for (let k = 1; k <= ahead && i + k < n; k++) out.push(i + k)
  return out
}

/** Banner shows from 5 minutes of distraction in a row. */
export const STREAK_MIN = 5

/** "On distractions for 12 min (mostly youtube.com · cats)", or null when there's nothing to say. */
export function streakText(s: DayStreak | null): string | null {
  if (!s || s.minutes < STREAK_MIN) return null
  const m = Math.round(s.minutes)
  return `On distractions for ${m < 60 ? `${m} min` : fmtShort(m)}${s.label ? ` (mostly ${s.label})` : ''}`
}

/** What goes up with a chat question: the last 6 turns. */
export function chatHistory(turns: ChatTurn[], keep = 6): ChatTurn[] {
  return turns.slice(-keep)
}

export const CHAT_MAX = 500

/** Friendly wording for the AI endpoints' failures (chat and standup). */
export function aiErrorText(status: number, message: string, what: 'answer' | 'standup'): string {
  if (status === 409) return what === 'answer' ? 'Still working on the last question — try again in a moment.' : 'Already writing it — give it a few seconds.'
  if (status === 429) return 'Paused to save your Claude usage — try again later.'
  if (status === 400 && what === 'standup') return message || 'Nothing was tracked yesterday, so there’s nothing to write yet.'
  return message
}

/** null when `v` is a whole number in min…max, else a plain message for that field. */
export function rangeProblem(label: string, v: number, min: number, max: number): string | null {
  return Number.isInteger(v) && v >= min && v <= max ? null : `${label}: pick a whole number from ${min} to ${max}.`
}
