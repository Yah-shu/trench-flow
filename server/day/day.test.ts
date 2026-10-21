// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const tmp = mkdtempSync(join(tmpdir(), 'day-test-'))
process.env.TRENCHFLOW_DIR = tmp
process.env.TRENCHFLOW_NO_EMBED = '1'

vi.mock('./ai.ts', async (original) => ({
  ...(await original<typeof import('./ai.ts')>()),
  overUsageCap: vi.fn(async () => false),
  classifyTitles: vi.fn(),
  describeCards: vi.fn(async () => ({})),
  runClaude: vi.fn(),
  summarizeDay: vi.fn(),
}))

import * as ai from './ai.ts'
import { activeSegments, applyPrivacy, buildCards, cardCategory, compactDay, computeTotals, dedupeAndMerge, maskTitle, matchRule } from './compute.ts'
import { DEFAULT_CATEGORIES, DEFAULT_RULES, normTitle, resetCacheMemo, titleKey } from './store.ts'
import { dayBounds, today } from './service.ts'
import { currentStreak } from './nudge.ts'
import type { SourceData } from './aw.ts'
import type { Segment } from './types.ts'

const DATE = '2026-10-15'
const { start: D0, end: D1 } = dayBounds(DATE)
const at = (h: number, m = 0, s = 0) => D0 + ((h * 60 + m) * 60 + s) * 1000
const ev = (t: number, secs: number, data: Record<string, unknown>) => ({ timestamp: new Date(t).toISOString(), duration: secs, data })
const src = (id: string, window: ReturnType<typeof ev>[], afk: ReturnType<typeof ev>[]): SourceData => ({
  source: { id, name: id, kind: 'desktop', url: 'http://x' },
  online: true,
  lastSeen: null,
  hosts: [{ hostname: id, window, afk, web: [] }],
})

afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('active time', () => {
  it('keeps only window time inside not-AFK', () => {
    const segs = activeSegments(
      [src('desktop', [ev(at(9), 3600, { app: 'Code.exe', title: 'a.ts' })], [ev(at(9), 600, { status: 'not-afk' }), ev(at(9, 10), 1200, { status: 'afk' }), ev(at(9, 30), 600, { status: 'not-afk' })])],
      D0,
      D1,
    )
    expect(segs.map((s) => (s.end - s.start) / 60000)).toEqual([10, 10])
  })

  it('merges same titles and folds fragments under 10 s into the window before', () => {
    const raw: Segment[] = [
      { start: at(9), end: at(9, 5), device: 'd', app: 'a', title: 't' },
      { start: at(9, 5), end: at(9, 5, 5), device: 'd', app: 'b', title: 'x' },
      { start: at(9, 5, 5), end: at(9, 10), device: 'd', app: 'a', title: 't' },
    ]
    const out = dedupeAndMerge(raw, D0, D1)
    // the 5 s fragment keeps its time inside "a", and the two "a" parts become one
    expect(out).toHaveLength(1)
    expect(out[0].app).toBe('a')
    expect(out[0].end - out[0].start).toBe(10 * 60_000)
  })

  it('a day runs from the day start hour to the same hour next morning', () => {
    const b = dayBounds('2026-10-15', 5)
    expect(new Date(b.start).getHours()).toBe(5)
    expect(b.end - b.start).toBe(24 * 3600_000)
    expect(today(new Date(2026, 9, 16, 3, 30), 5)).toBe('2026-10-15')
    expect(today(new Date(2026, 9, 16, 5, 1), 5)).toBe('2026-10-16')
  })

  it('never double counts two devices: the later-started one wins the overlap', () => {
    const segs = activeSegments(
      [
        src('desktop', [ev(at(10), 3600, { app: 'Code.exe', title: 'x' })], []),
        src('mac', [ev(at(10, 30), 600, { app: 'Safari', title: 'y' })], []),
      ],
      D0,
      D1,
    )
    const total = segs.reduce((n, s) => n + s.end - s.start, 0)
    expect(total).toBe(3600_000)
    expect(segs.map((s) => s.device)).toEqual(['desktop', 'mac', 'desktop'])
  })
})

describe('categories', () => {

  it('totals by kind and context switches', () => {
    const segs: Segment[] = [
      { start: at(9), end: at(10), device: 'd', app: 'Code.exe', title: 'x' },
      { start: at(10), end: at(10, 30), device: 'd', app: 'chrome.exe', title: 'YouTube' },
      { start: at(10, 30), end: at(11), device: 'd', app: 'Discord.exe', title: 'chat' },
    ]
    const t = computeTotals(segs, (s) => matchRule(DEFAULT_RULES, s.app, s.title) ?? 'other', DEFAULT_CATEGORIES)
    expect(t.totals).toEqual({ activeMinutes: 120, focusMinutes: 60, distractionMinutes: 30, neutralMinutes: 30, contextSwitches: 2 })
    expect(t.categories).toHaveLength(DEFAULT_CATEGORIES.length)
    expect(t.topApps[0]).toEqual({ app: 'Code', minutes: 60, categoryId: 'build' })
  })

  it('compactDay stays under the limit', () => {
    const segs: Segment[] = Array.from({ length: 3000 }, (_, i) => ({ start: D0 + i * 20_000, end: D0 + i * 20_000 + 15_000, device: 'd', app: `app${i % 7}`, title: 'T'.repeat(150) + i }))
    expect(compactDay(segs, () => 'other', 12_000).length).toBeLessThanOrEqual(12_000)
  })

  it('compactDay: one line per stretch on the same thing, with minutes per category', () => {
    const segs: Segment[] = [
      { start: at(9), end: at(10, 30), device: 'd', app: 'Code.exe', title: 'service.ts' },
      { start: at(10, 30), end: at(10, 40), device: 'd', app: 'chrome.exe', title: 'cats - YouTube' },
    ]
    const cat = (s: Segment) => (s.app === 'Code.exe' ? 'build' : 'entertainment')
    const lines = compactDay(segs, cat).split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('| build 90m | Code: service.ts (90m)')
    expect(lines[1]).toContain('entertainment 10m')
  })

  it('live cards: one card per stretch, short detours listed as distractions', () => {
    const segs: Segment[] = [
      { start: at(9), end: at(9, 40), device: 'd', app: 'Code.exe', title: 'service.ts' },
      { start: at(9, 40), end: at(9, 43), device: 'd', app: 'chrome.exe', title: 'cats - YouTube' },
      { start: at(9, 43), end: at(10), device: 'd', app: 'Code.exe', title: 'service.ts' },
      { start: at(10), end: at(10, 30), device: 'd', app: 'chrome.exe', title: 'cats - YouTube' },
    ]
    const cat = (s: Segment) => (s.app === 'Code.exe' ? 'build' : 'entertainment')
    const cards = buildCards(segs, cat, DEFAULT_CATEGORIES)
    expect(cards.map((c) => c.categoryId)).toEqual(['build', 'entertainment'])
    expect(cards[0].title).toBe('Code: service.ts')
    expect(cards[0].distractions).toEqual([{ label: 'chrome: cats - YouTube', minutes: 3 }])
    expect(cards[1].distractions).toEqual([])
    expect(cards[0].log?.[0].text).toBe('Code: service.ts')
  })

  it('titles that differ only by numbers share a cache key', () => {
    expect(titleKey('chrome.exe', 'Inbox (113) - Gmail')).toBe(titleKey('Chrome', 'Inbox (7) - Gmail'))
    expect(titleKey('msedge.exe', 'Docs and 6 more pages - Work')).toBe(titleKey('msedge', 'Docs and 2 more pages - Work'))
    expect(normTitle('Order #1042')).toBe('Order ##')
  })

  it('a card takes the category with the most minutes inside it', () => {
    const segs: Segment[] = [
      { start: at(9), end: at(9, 40), device: 'd', app: 'Notes.exe', title: 'Lecture notes' },
      { start: at(9, 40), end: at(10), device: 'd', app: 'chrome.exe', title: 'Instagram' },
    ]
    const card = { start: new Date(at(9)).toISOString(), end: new Date(at(10)).toISOString(), device: 'd', categoryId: 'social' }
    expect(cardCategory(card, segs, (s) => (s.app.startsWith('Notes') ? 'research' : 'social'))).toBe('research')
  })

})

describe('websites and privacy', () => {
  it('a browser window takes the website of the matching tab only', () => {
    const segs = activeSegments(
      [
        {
          ...src('desktop', [ev(at(9), 600, { app: 'chrome.exe', title: 'Example Shop - Products - Google Chrome' }), ev(at(9, 10), 600, { app: 'notepad.exe', title: 'todo.txt' })], []),
          hosts: [
            {
              hostname: 'desktop',
              window: [ev(at(9), 600, { app: 'chrome.exe', title: 'Example Shop - Products - Google Chrome' }), ev(at(9, 10), 600, { app: 'notepad.exe', title: 'todo.txt' })],
              afk: [],
              web: [ev(at(9), 1200, { url: 'https://www.example.com/product', title: 'Example Shop - Products' })],
            },
          ],
        },
      ],
      D0,
      D1,
    )
    expect(segs.map((s) => s.domain ?? null)).toEqual(['example.com', null])
    expect(matchRule([{ categoryId: 'data', domain: 'example\.com' }], 'chrome.exe', 'x', 'example.com')).toBe('data')
    expect(matchRule([{ categoryId: 'data', domain: 'example\.com' }], 'chrome.exe', 'x')).toBeNull()
  })

  it('private windows lose their title; emails and long numbers are masked', () => {
    const segs: Segment[] = [
      { start: at(9), end: at(9, 5), device: 'd', app: 'KeePassXC.exe', title: 'Bank logins.kdbx', domain: 'x.com' },
      { start: at(9, 5), end: at(9, 9), device: 'd', app: 'chrome.exe', title: 'Re: order for jane.doe@example.com - 4111 1111 1111 1111 - 2026-10-20' },
    ]
    const out = applyPrivacy(segs, { apps: ['^keepassxc$'], titles: [] })
    expect(out[0]).toMatchObject({ title: '(private)', private: true })
    expect(out[0].domain).toBeUndefined()
    expect(out[1].title).toBe('Re: order for [email] - [number] - 2026-10-20')
    expect(maskTitle('call 555-123-4567 or 12345678')).toBe('call [number] or [number]')
  })
})

describe('nudges', () => {
  it('a distraction stretch still going on, with short breaks allowed', () => {
    const now = at(10)
    const segs: Segment[] = [
      { start: at(9, 20), end: at(9, 35), device: 'd', app: 'Code.exe', title: 'x' },
      { start: at(9, 35), end: at(9, 50), device: 'd', app: 'chrome.exe', title: 'cats - YouTube' },
      { start: at(9, 50), end: at(9, 51), device: 'd', app: 'Discord.exe', title: 'chat' },
      { start: at(9, 51), end: at(10), device: 'd', app: 'chrome.exe', title: 'more cats - YouTube' },
    ]
    const isD = (s: Segment) => s.app === 'chrome.exe'
    expect(currentStreak(segs, isD, now)).toMatchObject({ minutes: 24, label: 'chrome: cats - YouTube' })
    expect(currentStreak(segs, isD, at(10, 5))).toBeNull()
    expect(currentStreak(segs.slice(0, 1), isD, at(9, 35))).toBeNull()
  })
})

describe('claude call', () => {
  it('uses haiku, no tools, empty strict MCP config, json output', () => {
    const a = ai.claudeArgs({ system: 's', schema: {} })
    const flag = (f: string) => a[a.indexOf(f) + 1]
    expect(flag('--model')).toBe('haiku')
    expect(flag('--tools')).toBe('')
    expect(flag('--output-format')).toBe('json')
    expect(a).toContain('--strict-mcp-config')
    expect(flag('--mcp-config')).toBe('{"mcpServers":{}}')
  })

  it('classifyTitles keeps only valid answers', async () => {
    const real = await vi.importActual<typeof import('./ai.ts')>('./ai.ts')
    const run = vi.fn(async () => ({ items: [{ i: 0, c: 'research' }, { i: 1, c: 'nope' }, { i: 9, c: 'ads' }] })) as never
    const res = await real.classifyTitles([{ app: 'a', title: 'x' }, { app: 'b', title: 'y' }], DEFAULT_CATEGORIES, run)
    expect(res).toEqual({ 0: 'research' })
  })

  it('describeCards asks for a category and keeps only valid ones', async () => {
    const real = await vi.importActual<typeof import('./ai.ts')>('./ai.ts')
    const run = vi.fn(async () => ({
      items: [
        { id: 'd@1', title: 'Reading about sourdough', summary: 's', categoryId: 'research' },
        { id: 'd@2', title: 'Something', summary: 's', categoryId: 'nope' },
      ],
    })) as never
    const card = (id: string) => ({ id, time: '09:00-09:30', category: 'Other', windows: 'x', distractions: '', shots: ['AAAA'] })
    const res = await real.describeCards([card('d@1'), card('d@2')], [], DEFAULT_CATEGORIES, run)
    expect(res['d@1'].categoryId).toBe('research')
    expect(res['d@2']).toEqual({ title: 'Something', summary: 's' })
    const call = (run as any).mock.calls[0][0]
    expect(call.images).toHaveLength(2)
    expect(call.schema.properties.items.items.required).toContain('categoryId')
  })

  it('a card the AI read fills in only the time nothing else sorted', async () => {
    const { screenCategories } = await import('./service.ts')
    const t = (h: number) => new Date(at(h)).toISOString()
    const onScreen = screenCategories({ a: { start: t(9), end: t(10), device: 'desktop', title: 'x', summary: 'y', categoryId: 'research' } }, new Set(['research', 'other']))
    const seg = (h: number, device = 'desktop') => ({ start: at(h), end: at(h) + 60_000, device, app: 'a', title: 'b' })
    expect(onScreen(seg(9.5))).toBe('research')
    expect(onScreen(seg(9.5, 'mac'))).toBeNull()
    expect(onScreen(seg(10.5))).toBeNull()
  })
})

describe('routes', () => {
  let app: import('hono').Hono
  const now = Date.now()
  const iso = (t: number) => new Date(t).toISOString()

  beforeAll(async () => {
    const { dayRoutes } = await import('./routes.ts')
    const { Hono } = await import('hono')
    app = new Hono().route('/api', dayRoutes)
  })

  beforeEach(() => {
    resetCacheMemo()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url)
      if (!u.startsWith('http://127.0.0.1:5600')) throw new Error('offline')
      if (u.endsWith('/api/0/buckets/')) {
        return Response.json({
          'aw-watcher-window_H': { id: 'aw-watcher-window_H', type: 'currentwindow', hostname: 'H', last_updated: iso(now) },
          'aw-watcher-afk_H': { id: 'aw-watcher-afk_H', type: 'afkstatus', hostname: 'H', last_updated: iso(now) },
        })
      }
      if (u.includes('aw-watcher-window_H')) {
        return Response.json([
          { timestamp: iso(at(9)), duration: 3600, data: { app: 'Code.exe', title: 'service.ts - my-app' } },
          { timestamp: iso(at(10)), duration: 1800, data: { app: 'chrome.exe', title: 'Some unknown page' } },
        ])
      }
      if (u.includes('aw-watcher-afk_H')) return Response.json([{ timestamp: iso(at(8)), duration: 4 * 3600, data: { status: 'not-afk' } }])
      throw new Error('offline')
    }))
  })

  it('GET /summary works and an offline source does not crash', async () => {
    await app.request('/api/day/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sources: [{ id: 'desktop', name: 'Desktop', kind: 'desktop', url: 'http://127.0.0.1:5600' }, { id: 'mac', name: 'MacBook', kind: 'laptop', url: 'http://nope.invalid:5600' }] }),
    })
    vi.mocked(ai.classifyTitles).mockResolvedValue({ 0: 'research' })
    const res = await app.request(`/api/day/summary?date=${DATE}`)
    expect(res.status).toBe(200)
    const j = (await res.json()) as any
    expect(j.devices.map((d: { online: boolean }) => d.online)).toEqual([true, false])
    expect(j.totals.activeMinutes).toBeGreaterThan(0)
    expect(j.categories.length).toBe(DEFAULT_CATEGORIES.length)
    expect(j.summaryStatus).toBe('none')
    expect(Array.isArray(j.timeline)).toBe(true)
  })

  it('refresh: 202 then 429 within 30 min', async () => {
    vi.mocked(ai.classifyTitles).mockResolvedValue({})
    vi.mocked(ai.summarizeDay).mockResolvedValue({
      cards: [{ start: '09:00', end: '09:30', device: 'desktop', categoryId: 'build', title: 'Built Day', summary: 'Wrote the backend' }],
      summary: { text: 'A day.', highlights: ['a', 'b', 'c'], biggestTimeSink: { label: 'YouTube', minutes: 30 } },
    })
    const r1 = await app.request(`/api/day/summary/refresh?date=${DATE}`, { method: 'POST' })
    expect(r1.status).toBe(202)
    const r2 = await app.request(`/api/day/summary/refresh?date=${DATE}`, { method: 'POST' })
    expect([202, 429]).toContain(r2.status)
    await vi.waitFor(async () => {
      const j = (await (await app.request(`/api/day/summary?date=${DATE}`)).json()) as any
      expect(j.summaryStatus).toBe('fresh')
      expect(j.summary.highlights).toHaveLength(3)
    })
    const r3 = await app.request(`/api/day/summary/refresh?date=${DATE}`, { method: 'POST' })
    expect(r3.status).toBe(429)
    expect(((await r3.json()) as any).retryAfterSeconds).toBeGreaterThan(0)
  })

  it('usage cap marks the summary skipped', async () => {
    vi.mocked(ai.overUsageCap).mockResolvedValue(true)
    const d = '2026-10-10'
    expect((await app.request(`/api/day/summary/refresh?date=${d}`, { method: 'POST' })).status).toBe(202)
    await vi.waitFor(async () => {
      const j = (await (await app.request(`/api/day/summary?date=${d}`)).json()) as any
      expect(j.summaryStatus).toBe('skipped-usage-cap')
    })
  })

  it('week returns 7 days', async () => {
    const j = (await (await app.request(`/api/day/week?end=${DATE}`)).json()) as any
    expect(j.days).toHaveLength(7)
    expect(j.days[6].date).toBe(DATE)
    expect(j.days[0]).toHaveProperty('byCategory')
  })

  it('settings validate', async () => {
    const put = (body: unknown) => app.request('/api/day/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    expect((await put({ targets: { focusHours: 30 } })).status).toBe(400)
    expect((await put({ sources: [{ id: 'x', name: 'X', kind: 'k', url: 'file:///c' }] })).status).toBe(400)
    expect((await put({ categories: [{ id: 'a', name: 'A', kind: 'focus', color: 'sky' }] })).status).toBe(400)
    const ok = await put({ targets: { focusHours: 6, distractionBudgetMinutes: 45 } })
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as any).targets).toEqual({ focusHours: 6, distractionBudgetMinutes: 45 })
    const g = (await (await app.request('/api/day/settings')).json()) as any
    expect(g.targets.focusHours).toBe(6)
    expect(Array.isArray(g.rules)).toBe(true)
    expect(g.private.apps.length).toBeGreaterThan(0)
    expect((await put({ rules: [{ categoryId: 'build', app: '(' }] })).status).toBe(400)
    expect((await put({ rules: [{ categoryId: 'build' }] })).status).toBe(400)
    const r = await put({ rules: [{ categoryId: 'research', domain: 'example\.com' }], private: { apps: ['keepass'], titles: [] } })
    expect(r.status).toBe(200)
    const j = (await r.json()) as any
    expect(j.rules).toEqual([{ categoryId: 'research', domain: 'example\.com' }])
    expect(j.private).toEqual({ apps: ['keepass'], titles: [] })
  })

  it('chat, standup and screenshot settings', async () => {
    const post = (url: string, body: unknown) => app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    vi.mocked(ai.overUsageCap).mockResolvedValue(false)
    expect((await post(`/api/day/chat?date=${DATE}`, { question: '' })).status).toBe(400)
    vi.mocked(ai.runClaude).mockResolvedValueOnce({ answer: 'About 60 minutes of building.' } as never)
    const r = await post(`/api/day/chat?date=${DATE}`, { question: 'How long did I build?', history: [{ role: 'you', text: 'hi' }, { role: 'x', text: 'bad' }] })
    expect(r.status).toBe(200)
    expect(((await r.json()) as any).answer).toContain('60')
    const prompt = (vi.mocked(ai.runClaude).mock.calls.at(-1)![0] as any).prompt as string
    expect(prompt).toContain('How long did I build?')
    expect(prompt).not.toContain('bad')
    vi.mocked(ai.runClaude).mockResolvedValueOnce({ yesterday: ['a'], today: ['b'], blockers: [] } as never)
    const st = await post(`/api/day/standup?date=${DATE}`, {})
    expect(st.status).toBe(200)
    const g = (await (await app.request(`/api/day/standup?date=${DATE}`)).json()) as any
    expect(g.standup.today).toEqual(['b'])
    const put = (body: unknown) => app.request('/api/day/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    expect((await put({ screenshots: { everySeconds: 5 } })).status).toBe(400)
    expect((await put({ nudges: { afterMinutes: 1 } })).status).toBe(400)
    const ok = (await (await put({ screenshots: { enabled: true, keepDays: 3 }, nudges: { enabled: true } })).json()) as any
    expect(ok.screenshots).toEqual({ enabled: true, everySeconds: 60, keepDays: 3 })
    expect(ok.nudges.enabled).toBe(true)
  })

  it('AI level: validated, and off blocks every AI call', async () => {
    const put = (body: unknown) => app.request('/api/day/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    expect(((await (await app.request('/api/day/settings')).json()) as any).aiLevel).toBe('medium')
    expect((await put({ aiLevel: 'extreme' })).status).toBe(400)
    expect(((await (await put({ aiLevel: 'off' })).json()) as any).aiLevel).toBe('off')
    const r = await app.request(`/api/day/chat?date=${DATE}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'hi' }) })
    expect(r.status).toBe(400)
    const real = await vi.importActual<typeof import('./ai.ts')>('./ai.ts')
    await expect(real.runClaude({ kind: 't', system: 's', prompt: 'p', schema: {}, timeoutMs: 1000 })).rejects.toThrow('AI is off')
    await put({ aiLevel: 'medium' })
  })

  it('label and card edits', async () => {
    const post = (url: string, body: unknown) => app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    expect((await post('/api/day/label', { app: 'chrome.exe', title: 'Some unknown page', categoryId: 'nope' })).status).toBe(400)
    expect((await post('/api/day/label', { app: 'chrome.exe', title: 'Some unknown page', categoryId: 'research' })).status).toBe(200)
    expect((await post(`/api/day/card?date=${DATE}`, { id: 'desktop@x', rating: 'bad' })).status).toBe(400)
    expect((await post(`/api/day/card?date=${DATE}`, { id: 'desktop@x', rating: 'focused', categoryId: 'learning' })).status).toBe(200)
    const j = (await (await app.request(`/api/day/summary?date=${DATE}`)).json()) as any
    // the AI cards from the refresh test don't cover 10:00, so check the label through the totals
    expect(j.categories.find((c: any) => c.id === 'research').minutes).toBe(30)
    expect(j.timeline.every((t: any) => typeof t.id === 'string' && 'rating' in t && 'categoryLocked' in t)).toBe(true)
  })
})

describe('chat answers', () => {
  it('a JSON object inside the answer becomes plain sentences', async () => {
    const { plainAnswer } = await import('./assist.ts')
    expect(plainAnswer('{"a": "Little distraction.", "b": "Most focused 12:25-13:10."}')).toBe('Little distraction. Most focused 12:25-13:10.')
    expect(plainAnswer('Just text.')).toBe('Just text.')
  })
})
