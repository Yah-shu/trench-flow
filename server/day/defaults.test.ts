// @vitest-environment node
// The default categories and rules a fresh install starts with (defaults.ts).
import { describe, expect, it } from 'vitest'
import { matchRule } from './compute.ts'
import { DEFAULT_CATEGORIES, DEFAULT_RULES } from './defaults.ts'

describe('default rules', () => {
  it('sort the usual windows', () => {
    expect(matchRule(DEFAULT_RULES, 'Code.exe', 'app.ts - my-project')).toBe('build')
    expect(matchRule(DEFAULT_RULES, 'steam.exe', 'Steam')).toBe('games')
    expect(matchRule(DEFAULT_RULES, 'VALORANT-Win64-Shipping.exe', 'VALORANT')).toBe('games')
    expect(matchRule(DEFAULT_RULES, 'Discord.exe', 'general')).toBe('comms')
    expect(matchRule(DEFAULT_RULES, 'Figma.exe', 'Untitled')).toBe('design')
    expect(matchRule(DEFAULT_RULES, 'WINWORD.EXE', 'Report.docx - Word')).toBe('writing')
    expect(matchRule(DEFAULT_RULES, 'chrome.exe', 'Budget 2026 - Google Sheets')).toBe('data')
    expect(matchRule(DEFAULT_RULES, 'chrome.exe', 'Week board - Trello')).toBe('admin')
    expect(matchRule(DEFAULT_RULES, 'chrome.exe', 'Photosynthesis - Wikipedia')).toBe('research')
    expect(matchRule(DEFAULT_RULES, 'chrome.exe', 'Intro to Statistics - Coursera')).toBe('learning')
    expect(matchRule(DEFAULT_RULES, 'chrome.exe', 'Home / X')).toBeNull()
    expect(matchRule(DEFAULT_RULES, 'chrome.exe', 'Instagram')).toBe('social')
    expect(matchRule(DEFAULT_RULES, 'chrome.exe', 'funny cats - YouTube')).toBe('entertainment')
    expect(matchRule(DEFAULT_RULES, 'Finder', 'Downloads')).toBe('personal')
    expect(matchRule(DEFAULT_RULES, 'chrome.exe', 'random page')).toBeNull()
  })

  it('video names and loose words do not decide', () => {
    expect(matchRule(DEFAULT_RULES, 'chrome.exe', 'Discord Memes - YouTube')).toBe('entertainment')
    expect(matchRule(DEFAULT_RULES, 'chrome.exe', 'How To Use Pivot Tables In Excel - YouTube')).toBe('learning')
    expect(matchRule(DEFAULT_RULES, 'chrome.exe', 'Weekly team call - Mail')).toBe('comms')
  })

  it('every rule points at a category that exists, and every pattern compiles', () => {
    const ids = new Set(DEFAULT_CATEGORIES.map((c) => c.id))
    expect(ids.has('other')).toBe(true)
    for (const r of DEFAULT_RULES) {
      expect(ids.has(r.categoryId)).toBe(true)
      for (const p of [r.app, r.title, r.domain]) if (p) expect(() => new RegExp(p, 'i')).not.toThrow()
    }
  })
})
