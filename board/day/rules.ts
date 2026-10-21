/** Pure helpers for the Day settings (rules, private patterns, day start) and the card detail. */
import type { CategoryHow, DayRule } from './types.ts'

/** A rule while it's being edited: plain strings, plus a key so rows keep focus when they move. */
export interface RuleDraft {
  key: number
  categoryId: string
  app: string
  title: string
  domain: string
}

let nextKey = 1
export function toDraft(r: Partial<DayRule> = {}): RuleDraft {
  return { key: nextKey++, categoryId: r.categoryId ?? '', app: r.app ?? '', title: r.title ?? '', domain: r.domain ?? '' }
}

/** Back to the API shape: trimmed, empty patterns left out. */
export function cleanRule(d: Pick<RuleDraft, 'categoryId' | 'app' | 'title' | 'domain'>): DayRule {
  const r: DayRule = { categoryId: d.categoryId }
  const app = d.app.trim()
  const title = d.title.trim()
  const domain = d.domain.trim()
  if (app) r.app = app
  if (title) r.title = title
  if (domain) r.domain = domain
  return r
}

/** null when the pattern is fine, otherwise a plain-English reason. Same flags as the server ('i'). */
export function patternProblem(p: string): string | null {
  try {
    new RegExp(p, 'i')
    return null
  } catch {
    return `“${p}” isn’t a valid pattern`
  }
}

/** One message per row (null = fine), so the editor can point at the wrong one. */
export function ruleProblems(rows: Pick<RuleDraft, 'categoryId' | 'app' | 'title' | 'domain'>[], categoryIds?: Set<string>): (string | null)[] {
  return rows.map((d) => {
    if (!d.categoryId) return 'Pick a category.'
    if (categoryIds && !categoryIds.has(d.categoryId)) return 'That category no longer exists — pick another.'
    const r = cleanRule(d)
    if (!r.app && !r.title && !r.domain) return 'Fill in at least one of App, Window title or Website.'
    for (const p of [r.app, r.title, r.domain]) {
      const bad = p && patternProblem(p)
      if (bad) return `${bad}.`
    }
    return null
  })
}

/** Textarea → patterns: one per line, blanks dropped. */
export function parseLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

/** The first bad line in a one-pattern-per-line box, e.g. "Line 2: “(” isn’t a valid pattern". */
export function linesProblem(text: string): string | null {
  for (const [i, l] of text.split(/\r?\n/).entries()) {
    const t = l.trim()
    const bad = t && patternProblem(t)
    if (bad) return `Line ${i + 1}: ${bad}.`
  }
  return null
}

/** Move one item up (-1) or down (+1); out-of-range moves leave the list as it is. */
export function moveItem<T>(list: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return list
  const out = [...list]
  ;[out[i], out[j]] = [out[j]!, out[i]!]
  return out
}

/** "midnight", "4 am", "noon" — for the day-start select (0–12). */
export function hourLabel(h: number): string {
  if (h === 0) return 'midnight'
  if (h === 12) return 'noon'
  return h < 12 ? `${h} am` : `${h - 12} pm`
}

/** The tiny hint next to a window's category: where it came from. */
export function howLabel(how: CategoryHow): string {
  return { rule: 'rule', ai: 'AI', local: 'look-alike', you: 'you', none: '' }[how] ?? ''
}
