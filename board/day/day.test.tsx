// The Day page: duration formatting, ring angles, over-target fills, sample-data fallback, 429,
// card detail writes, settings checks, replay, chat and standup.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { awaitingAiTitle, distractionChip, fmtHours, fmtLong, fmtShort, ringArcs, shiftDate, targetFill } from './format.ts'
import { getSummary, postLabel, putSettings, putTargets, refreshSummary } from './api.ts'
import { aiErrorText, chatHistory, clampIndex, preloadAhead, rangeProblem, streakText } from './live.ts'
import { cleanRule, hourLabel, howLabel, linesProblem, moveItem, parseLines, ruleProblems } from './rules.ts'
import { fixtureSummary } from './fixture.ts'
import { Day, ringSlices } from './Day.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))

describe('durations', () => {
  it('formats short, long and hours', () => {
    expect(fmtShort(0)).toBe('0m')
    expect(fmtShort(47)).toBe('47m')
    expect(fmtShort(60)).toBe('1h')
    expect(fmtShort(582)).toBe('9h 42m')
    expect(fmtLong(739)).toBe('12 hours 19 minutes')
    expect(fmtLong(60)).toBe('1 hour')
    expect(fmtLong(1)).toBe('1 minute')
    expect(fmtLong(0)).toBe('0 minutes')
    expect(fmtHours(582)).toBe('9.7')
    expect(fmtHours(540)).toBe('9')
  })
  it('shifts dates across months', () => {
    expect(shiftDate('2026-10-01', -1)).toBe('2026-09-30')
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('ring angles', () => {
  it('splits the circle by share, minus gaps', () => {
    const a = ringArcs([1, 1, 2], 6)
    expect(a[0]).toEqual({ start: 3, end: 3 + 85.5 })
    expect(a[2]!.end - a[2]!.start).toBeCloseTo(171)
    const covered = a.reduce((s, x) => s + (x!.end - x!.start), 0)
    expect(covered + 3 * 6).toBeCloseTo(360)
  })
  it('skips zeros, fills a lone value, handles empty', () => {
    expect(ringArcs([0, 5, 0])).toEqual([null, { start: 0, end: 360 }, null])
    expect(ringArcs([0, 0])).toEqual([null, null])
  })
  it('groups distractions and neutral time into one slice each', () => {
    const s = ringSlices(fixtureSummary('2026-10-17').categories)
    expect(s.filter((x) => x.id === '_distraction')).toHaveLength(1)
    expect(s.find((x) => x.id === '_distraction')!.minutes).toBe(47)
    expect(s.length).toBeLessThanOrEqual(9)
  })
})

describe('target fill', () => {
  it('fills partially under target', () => {
    expect(targetFill(270, 540)).toMatchObject({ fill: 0.5, marker: 1, over: false })
  })
  it('never clips over 100%: the track stretches and the target becomes a marker', () => {
    const f = targetFill(582, 540)
    expect(f.fill).toBe(1)
    expect(f.over).toBe(true)
    expect(f.marker).toBeCloseTo(540 / 582)
    expect(f.ratio).toBeCloseTo(1.0778, 3)
  })
  it('copes with a zero target', () => {
    expect(targetFill(10, 0)).toMatchObject({ fill: 1, over: false, ratio: 0 })
  })
})

describe('api', () => {
  it('falls back to sample data when the API fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json(404, { error: 'nope' })))
    const r = await getSummary('2026-10-17')
    expect(r.sample).toBe(true)
    expect(r.data.date).toBe('2026-10-17')
  })
  it('uses the API when it answers', async () => {
    const real = { ...fixtureSummary('2026-10-17'), timezone: 'X/Real' }
    vi.stubGlobal('fetch', vi.fn(() => json(200, real)))
    const r = await getSummary('2026-10-17')
    expect(r.sample).toBe(false)
    expect(r.data.timezone).toBe('X/Real')
  })
  it('turns 429 into a quiet wait time', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json(429, { retryAfterSeconds: 90 })))
    expect(await refreshSummary('2026-10-17')).toEqual({ ok: false, retryAfterSeconds: 90 })
  })
})

describe('page', () => {
  it('renders sample data with a badge and a 429 note', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => (init?.method === 'POST' ? json(429, { retryAfterSeconds: 120 }) : json(503, {}))),
    )
    render(<Day date="2026-10-17" />)
    expect(await screen.findByText('sample data')).toBeTruthy()
    expect(screen.getByText('9.7')).toBeTruthy()
    expect(screen.getAllByText('12 hours 19 minutes').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))
    await waitFor(() => expect(screen.getByText(/try again in 2 min/)).toBeTruthy())
  })
})

describe('settings helpers', () => {
  it('points at the rule that is wrong', () => {
    const rows = [
      { categoryId: 'social', app: '', title: '', domain: 'tiktok\.com' },
      { categoryId: 'social', app: ' ', title: '', domain: '' },
      { categoryId: 'games', app: '', title: 'steam(', domain: '' },
      { categoryId: '', app: 'chrome', title: '', domain: '' },
      { categoryId: 'gone', app: 'x', title: '', domain: '' },
    ]
    const p = ruleProblems(rows, new Set(['social', 'games']))
    expect(p[0]).toBeNull()
    expect(p[1]).toMatch(/at least one/)
    expect(p[2]).toMatch(/isn’t a valid pattern/)
    expect(p[3]).toMatch(/Pick a category/)
    expect(p[4]).toMatch(/no longer exists/)
  })
  it('cleans rules and lines for the API', () => {
    expect(cleanRule({ categoryId: 'design', app: ' chrome ', title: '', domain: ' ' })).toEqual({ categoryId: 'design', app: 'chrome' })
    expect(parseLines(' keepass \r\n\n signal\n')).toEqual(['keepass', 'signal'])
    expect(linesProblem('bank\n(oops')).toMatch(/^Line 2:/)
    expect(linesProblem('bank\npass(word)?')).toBeNull()
  })
  it('moves items and labels hours', () => {
    expect(moveItem([1, 2, 3], 0, 1)).toEqual([2, 1, 3])
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3])
    expect(hourLabel(0)).toBe('midnight')
    expect(hourLabel(4)).toBe('4 am')
    expect(hourLabel(12)).toBe('noon')
    expect(howLabel('local')).toBe('look-alike')
    expect(howLabel('none')).toBe('')
  })
})

describe('writes', () => {
  it('shows the server’s own error on a bad settings save', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json(400, { error: 'Rule 2: bad pattern' })))
    await expect(putSettings({ rules: [] })).rejects.toThrow('Rule 2: bad pattern')
  })
  it('turns a dead server into a friendly message', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(postLabel('Chrome', 'YouTube', 'entertainment')).rejects.toThrow(/isn’t answering/)
  })
  it('putTargets sends only the targets', async () => {
    const f = vi.fn((_url: string, _init?: RequestInit) => json(200, {}))
    vi.stubGlobal('fetch', f)
    await putTargets({ focusHours: 8, distractionBudgetMinutes: 45 }, null)
    expect(JSON.parse(String(f.mock.calls[0]![1]!.body))).toEqual({ targets: { focusHours: 8, distractionBudgetMinutes: 45 } })
  })
})

describe('timeline card', () => {
  it('expands a card, rates it and reloads', async () => {
    const day = fixtureSummary('2026-10-17')
    const f = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return json(200, { ok: true })
      if (url.startsWith('/api/day/week')) return json(200, { days: [] })
      return json(200, day)
    })
    vi.stubGlobal('fetch', f)
    render(<Day date="2026-10-17" />)
    const row = await screen.findByRole('button', { name: /New slides for the client pitch/ })
    expect(row.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(row)
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Photoshop')).toBeTruthy()
    expect(screen.getByText('look-alike')).toBeTruthy()
    // Already "Focused" in the sample — pressing it again clears the rating.
    const focused = screen.getByRole('button', { name: 'Focused', pressed: true })
    const before = f.mock.calls.length
    fireEvent.click(focused)
    await waitFor(() => expect(f.mock.calls.length).toBeGreaterThan(before + 1))
    const post = f.mock.calls.find(([, i]) => i?.method === 'POST')!
    expect(post[0]).toBe('/api/day/card?date=2026-10-17')
    expect(JSON.parse(String(post[1]!.body))).toEqual({ id: '2026-10-17-08:52', rating: null })
  })
  it('flags the wrong rule row instead of saving', async () => {
    const day = fixtureSummary('2026-10-17')
    const f = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return json(200, {})
      if (url.startsWith('/api/day/settings')) return json(200, { targets: day.targets, categories: [], sources: [], dayStartHour: 4, rules: [{ categoryId: 'social', domain: 'tiktok\.com' }], private: { apps: [], titles: [] } })
      if (url.startsWith('/api/day/week')) return json(200, { days: [] })
      return json(200, day)
    })
    vi.stubGlobal('fetch', f)
    render(<Day date="2026-10-17" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    expect(await screen.findByDisplayValue('tiktok\.com')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /add rule/i }))
    fireEvent.change(screen.getByLabelText('Rule 2: category'), { target: { value: 'games' } })
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }))
    expect(await screen.findByText(/Rule 2: Fill in at least one/)).toBeTruthy()
    expect(f.mock.calls.some(([, i]) => i?.method === 'PUT')).toBe(false)
  })
})

describe('live cards', () => {
  it('sums distractions into a chip', () => {
    expect(distractionChip([{ minutes: 4 }, { minutes: 2 }])).toBe('distracted 2×, 6m')
    expect(distractionChip([])).toBeNull()
    expect(distractionChip(undefined)).toBeNull()
  })
  it('waits for an AI title today or within ~2h of the card ending', () => {
    const now = Date.parse('2026-10-18T12:00:00Z')
    const old = { summary: null, end: '2026-10-17T20:00:00Z' }
    expect(awaitingAiTitle(old, '2026-10-18', '2026-10-18', now)).toBe(true)
    expect(awaitingAiTitle(old, '2026-10-17', '2026-10-18', now)).toBe(false)
    expect(awaitingAiTitle({ summary: null, end: '2026-10-18T11:00:00Z' }, '2026-10-17', '2026-10-18', now)).toBe(true)
    expect(awaitingAiTitle({ summary: 'Did things', end: '2026-10-18T11:30:00Z' }, '2026-10-18', '2026-10-18', now)).toBe(false)
  })
  it('shows the chip, the log and private windows in the sample', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json(503, {})))
    render(<Day date="2026-10-17" />)
    expect(await screen.findByText('distracted 2×, 6m')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /New slides for the client pitch/ }))
    // Once in Distractions, once in the 5-minute log.
    expect(screen.getAllByText('youtube.com · cats')).toHaveLength(2)
    expect(screen.getByText('pitch-cover-03.psd')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Lunch break/ }))
    expect(screen.getByText('private', { selector: '.day-win__cat' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Auto (Other)' })).toBeTruthy()
  })
})

describe('live helpers', () => {
  it('keeps the replay index in range and preloads ahead', () => {
    expect(clampIndex(-1, 5)).toBe(0)
    expect(clampIndex(9, 5)).toBe(4)
    expect(clampIndex(3, 0)).toBe(0)
    expect(preloadAhead(2, 5)).toEqual([3, 4])
    expect(preloadAhead(4, 5)).toEqual([])
  })
  it('words the right-now banner from 5 minutes', () => {
    expect(streakText(null)).toBeNull()
    expect(streakText({ minutes: 4, label: 'x', since: 'a' })).toBeNull()
    expect(streakText({ minutes: 12, label: 'youtube.com · cats', since: 'a' })).toBe('On distractions for 12 min (mostly youtube.com · cats)')
    expect(streakText({ minutes: 75, label: '', since: 'a' })).toBe('On distractions for 1h 15m')
  })
  it('sends the last 6 turns and words AI errors', () => {
    const turns = Array.from({ length: 9 }, (_, i) => ({ role: 'you' as const, text: String(i) }))
    expect(chatHistory(turns).map((t) => t.text)).toEqual(['3', '4', '5', '6', '7', '8'])
    expect(aiErrorText(429, 'cap', 'answer')).toMatch(/Claude usage/)
    expect(aiErrorText(409, 'busy', 'answer')).toMatch(/last question/)
    expect(aiErrorText(400, '', 'standup')).toMatch(/Nothing was tracked/)
    expect(aiErrorText(500, 'Boom', 'answer')).toBe('Boom')
  })
  it('checks settings ranges', () => {
    expect(rangeProblem('Every', 60, 15, 600)).toBeNull()
    expect(rangeProblem('Every', 10, 15, 600)).toMatch(/15 to 600/)
    expect(rangeProblem('Every', 2.5, 1, 60)).not.toBeNull()
    expect(rangeProblem('Every', NaN, 1, 60)).not.toBeNull()
  })
})

describe('replay, chat and standup', () => {
  const day = fixtureSummary('2026-10-17')
  const shots = [
    { t: '2026-10-17T08:53:00.000Z', file: 'a.jpg', app: 'Figma', title: 'Client pitch – Figma' },
    { t: '2026-10-17T08:54:00.000Z', file: 'b.jpg', app: 'Photoshop', title: 'pitch-cover-03.psd' },
  ]
  function api(over: (url: string, init?: RequestInit) => Promise<Response> | undefined = () => undefined) {
    const f = vi.fn((url: string, init?: RequestInit) => {
      const o = over(url, init)
      if (o) return o
      if (url.startsWith('/api/day/shots')) return json(200, { shots })
      if (url.startsWith('/api/day/standup')) return json(200, { standup: null })
      if (url.startsWith('/api/day/week')) return json(200, { days: [] })
      return json(200, day)
    })
    vi.stubGlobal('fetch', f)
    return f
  }

  it('replays a card’s shots with arrow keys and Esc', async () => {
    api()
    render(<Day date="2026-10-17" />)
    fireEvent.click(await screen.findByRole('button', { name: /New slides for the client pitch/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Replay (2 shots)' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.querySelector('img')!.getAttribute('src')).toBe('/api/day/shot?f=a.jpg')
    fireEvent.keyDown(dialog, { key: 'ArrowRight' })
    expect(dialog.querySelector('img')!.getAttribute('src')).toBe('/api/day/shot?f=b.jpg')
    expect(screen.getByText('2 / 2')).toBeTruthy()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('answers a suggestion chip and words the usage cap', async () => {
    let calls = 0
    const f = api((url) => (url.startsWith('/api/day/chat') ? (++calls === 1 ? json(200, { answer: 'Mostly on design.' }) : json(429, { error: 'cap' })) : undefined))
    render(<Day date="2026-10-17" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Where did my time go?' }))
    expect(await screen.findByText('Mostly on design.')).toBeTruthy()
    const post = f.mock.calls.find(([u]) => u.startsWith('/api/day/chat'))!
    expect(JSON.parse(String(post[1]!.body))).toEqual({ question: 'Where did my time go?', history: [] })
    const box = screen.getByLabelText('Your question')
    fireEvent.change(box, { target: { value: 'And after lunch?' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await screen.findByText(/Claude usage/)).toBeTruthy()
    const second = f.mock.calls.filter(([u]) => u.startsWith('/api/day/chat'))[1]!
    expect(JSON.parse(String(second[1]!.body)).history).toHaveLength(2)
  })

  it('writes a standup on demand and hides empty blockers', async () => {
    api((url, init) =>
      url.startsWith('/api/day/standup') && init?.method === 'POST'
        ? json(200, { standup: { yesterday: ['Shipped the Day page'], today: ['Replay'], blockers: [], at: '2026-10-17T08:05:00.000Z' } })
        : undefined,
    )
    render(<Day date="2026-10-17" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Write my standup' }))
    expect(await screen.findByText('Shipped the Day page')).toBeTruthy()
    expect(screen.queryByText('Blockers')).toBeNull()
    expect(screen.getByRole('button', { name: 'Rewrite' })).toBeTruthy()
  })
})
