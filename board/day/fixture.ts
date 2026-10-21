/** Sample data, shown (with a "sample data" badge) only when /api/day is not answering. */
import type { CardRating, DayCategory, Standup, DaySummary, TimelineItem, TimelineWindow, WeekDay } from './types.ts'
import { shiftDate } from './format.ts'

const CATS: Omit<DayCategory, 'minutes'>[] = [
  { id: 'writing', name: 'Docs & writing', kind: 'focus', color: 'sky' },
  { id: 'design', name: 'Design & media', kind: 'focus', color: 'plum' },
  { id: 'research', name: 'Research & reading', kind: 'focus', color: 'leaf' },
  { id: 'data', name: 'Spreadsheets & data', kind: 'focus', color: 'sun' },
  { id: 'build', name: 'Coding & dev', kind: 'focus', color: 'teal' },
  { id: 'admin', name: 'Admin & planning', kind: 'focus', color: 'sand' },
  { id: 'learning', name: 'Learning', kind: 'focus', color: 'rose' },
  { id: 'entertainment', name: 'Entertainment', kind: 'distraction', color: 'coral' },
  { id: 'social', name: 'Social', kind: 'distraction', color: 'coral' },
  { id: 'games', name: 'Games', kind: 'distraction', color: 'coral' },
  { id: 'comms', name: 'Comms', kind: 'neutral', color: 'slate' },
  { id: 'personal', name: 'Personal', kind: 'neutral', color: 'slate' },
  { id: 'other', name: 'Other', kind: 'neutral', color: 'ink' },
]
const MINUTES: Record<string, number> = {
  writing: 148, design: 162, research: 96, data: 54, build: 71, admin: 28, learning: 23,
  entertainment: 31, social: 16, games: 0, comms: 58, personal: 42, other: 10,
}

const BLOCKS: [string, string, string, string, string, string | null][] = [
  ['08:10', '08:52', 'desktop', 'comms', 'Inbox and team messages', 'Cleared email and answered the team chat about the release date.'],
  ['08:52', '10:40', 'desktop', 'design', 'New slides for the client pitch', 'Built three slide drafts in Figma and picked the cover image.'],
  ['10:40', '11:05', 'laptop', 'entertainment', 'YouTube', null],
  ['11:05', '12:40', 'desktop', 'writing', 'Project proposal draft', 'Rewrote the scope section and fixed the timeline wording.'],
  ['12:40', '13:20', 'laptop', 'personal', 'Lunch break', null],
  ['13:20', '14:56', 'desktop', 'research', 'Comparing note-taking apps', 'Read reviews of three note apps and listed what each does best.'],
  ['14:56', '15:50', 'desktop', 'data', 'Monthly budget check', 'Updated the budget sheet and flagged two costs that ran over.'],
  ['15:50', '16:06', 'laptop', 'social', 'Instagram', null],
  ['16:06', '17:17', 'desktop', 'build', 'Personal site: contact form', 'Worked on the contact form of the personal site.'],
  ['17:17', '17:45', 'desktop', 'admin', 'Invoices and planning', 'Sent two invoices and planned next week.'],
  ['17:45', '18:39', 'desktop', 'design', 'Video clips review', 'Went through new clips and flagged two to redo.'],
  ['18:39', '19:02', 'laptop', 'learning', 'Online course notes', 'Read a module on public speaking.'],
  ['19:02', '19:08', 'laptop', 'entertainment', 'Netflix', null],
]

/** Windows inside each block (same order as BLOCKS): app, title, website, minutes, category, how. */
type W = [string, string, string | null, number, string, TimelineWindow['how']]
const WINDOWS: W[][] = [
  [['Chrome', 'Inbox (12) - Mail', 'mail.example.com', 31, 'comms', 'rule'], ['Slack', 'Slack', null, 11, 'comms', 'rule']],
  [
    ['Figma', 'Client pitch – Figma', null, 64, 'design', 'rule'],
    ['Chrome', 'Free stock photos', 'photos.example.com', 28, 'research', 'ai'],
    ['Photoshop', 'pitch-cover-03.psd @ 66%', null, 16, 'design', 'local'],
  ],
  [['Chrome', 'How bridges are built - YouTube', 'youtube.com', 25, 'entertainment', 'rule']],
  [
    ['Word', 'Project proposal.docx', null, 58, 'writing', 'rule'],
    ['Chrome', 'Proposal template – Docs', 'docs.example.com', 31, 'writing', 'you'],
    ['Notepad', 'timeline wording.txt', null, 6, 'writing', 'ai'],
  ],
  [['Spotify', 'Spotify Premium', null, 32, 'personal', 'none'], ['Chrome', 'private', null, 8, 'personal', 'none']],
  [
    ['Chrome', 'Best note-taking apps compared', 'reviews.example.com', 47, 'research', 'ai'],
    ['Chrome', 'Note app forum', 'forum.example.com', 35, 'research', 'rule'],
    ['Chrome', 'Reddit - r/productivity', 'reddit.com', 14, 'social', 'rule'],
  ],
  [['Excel', 'budget-october.xlsx', null, 46, 'data', 'rule'], ['Chrome', 'Bank statements', null, 8, 'data', 'local']],
  [['Chrome', 'Instagram', 'instagram.com', 16, 'social', 'rule']],
  [
    ['Code', 'contact.tsx — my-site', null, 52, 'build', 'rule'],
    ['Windows Terminal', 'npm run dev', null, 12, 'build', 'ai'],
    ['Chrome', 'Contact – my site', 'localhost', 7, 'build', 'you'],
  ],
  [['Chrome', 'Invoices – Billing', 'billing.example.com', 28, 'admin', 'ai']],
  [['Premiere Pro', 'Edit – clips', null, 41, 'design', 'rule'], ['VLC', 'clip_07.mp4', null, 13, 'design', 'local']],
  [['Chrome', 'Public speaking – Module 4', 'courses.example.com', 23, 'learning', 'ai']],
  [['Chrome', 'Netflix', 'netflix.com', 6, 'entertainment', 'rule']],
]
const RATINGS: Record<number, CardRating> = { 1: 'focused', 2: 'distracted', 8: 'focused' }
/** Distracting windows inside focus cards, and the 5-minute log, for a few blocks. */
const DISTRACTIONS: Record<number, { label: string; minutes: number }[]> = {
  1: [{ label: 'youtube.com · cats', minutes: 4 }, { label: 'instagram.com', minutes: 2 }],
  5: [{ label: 'reddit.com · r/funny', minutes: 5 }],
}
const LOGS: Record<number, [string, string][]> = {
  1: [
    ['08:52', 'Client pitch – Figma'], ['08:57', 'Free stock photos'], ['09:07', 'Client pitch – Figma'], ['09:22', 'youtube.com · cats'],
    ['09:27', 'Client pitch – Figma'], ['09:47', 'pitch-cover-03.psd'], ['10:02', 'Client pitch – Figma'], ['10:17', 'instagram.com'],
    ['10:22', 'Free stock photos'], ['10:32', 'Client pitch – Figma'],
  ],
  5: [['13:20', 'Best note-taking apps compared'], ['13:50', 'Note app forum'], ['14:15', 'reddit.com · r/funny'], ['14:20', 'Note app forum']],
  8: [['16:06', 'contact.tsx — my-site'], ['16:31', 'npm run dev'], ['16:41', 'contact.tsx — my-site'], ['17:01', 'Contact – my site']],
}

function at(date: string, hm: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi] = hm.split(':').map(Number)
  return new Date(y!, m! - 1, d!, h, mi).toISOString()
}

export function fixtureSummary(date: string): DaySummary {
  const categories = CATS.map((c) => ({ ...c, minutes: MINUTES[c.id] ?? 0 }))
  const sum = (k: string) => categories.filter((c) => c.kind === k).reduce((s, c) => s + c.minutes, 0)
  const focus = sum('focus')
  const distraction = sum('distraction')
  const neutral = sum('neutral')
  const timeline: TimelineItem[] = BLOCKS.map(([s, e, device, categoryId, title, summary], i) => ({
    id: `${date}-${s}`, start: at(date, s), end: at(date, e), device, categoryId, title, summary,
    windows: (WINDOWS[i] ?? []).map(([app, wt, domain, minutes, cat, how]) => ({ app, title: wt, domain, minutes, categoryId: cat, how, private: wt === 'private' })),
    rating: RATINGS[i] ?? null,
    // Lunch was filed under Personal by hand, so the sample shows the "set by you" badge.
    categoryLocked: i === 4,
    autoCategoryId: i === 4 ? 'other' : categoryId,
    ...(DISTRACTIONS[i] ? { distractions: DISTRACTIONS[i] } : {}),
    ...(LOGS[i] ? { log: LOGS[i]!.map(([hm, text]) => ({ at: at(date, hm), text })) } : {}),
  }))
  return {
    date,
    generatedAt: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    devices: [
      { id: 'desktop', name: 'Desktop', kind: 'desktop', online: true, lastSeen: new Date().toISOString(), activeMinutes: 560 },
      { id: 'laptop', name: 'Laptop', kind: 'mac', online: false, lastSeen: at(date, '19:08'), activeMinutes: 179 },
    ],
    totals: { activeMinutes: focus + distraction + neutral, focusMinutes: focus, distractionMinutes: distraction, neutralMinutes: neutral, contextSwitches: 84 },
    targets: { focusHours: 9, distractionBudgetMinutes: 60 },
    categories,
    timeline,
    topApps: [
      { app: 'Chrome', minutes: 251, categoryId: 'research' },
      { app: 'Figma', minutes: 188, categoryId: 'design' },
      { app: 'VS Code', minutes: 71, categoryId: 'build' },
      { app: 'Gmail', minutes: 58, categoryId: 'comms' },
      { app: 'YouTube', minutes: 31, categoryId: 'entertainment' },
    ],
    summary: {
      text: 'A strong making day: most of the morning went into the pitch slides and the proposal, the afternoon into research and numbers. Distractions stayed under budget.',
      highlights: ['Three pitch slide drafts built', 'Proposal scope rewritten', 'Budget sheet brought up to date'],
      biggestTimeSink: { label: 'Design & media', minutes: 162 },
    },
    summaryStatus: 'fresh',
    summaryUpdatedAt: new Date().toISOString(),
  }
}

export function fixtureWeek(end: string): WeekDay[] {
  const shape = [0.82, 1.04, 0.66, 0.95, 0.4, 0.88, 1]
  return shape.map((k, i) => {
    const date = shiftDate(end, i - 6)
    const focus = Math.round(582 * k)
    const distraction = Math.round(47 * (1.4 - k * 0.6))
    return { date, activeMinutes: focus + distraction + Math.round(110 * k), focusMinutes: focus, distractionMinutes: distraction, byCategory: {} }
  })
}

export function fixtureStandup(date: string): Standup {
  return {
    yesterday: ['Built three slide drafts for the client pitch', 'Rewrote the proposal scope', 'Updated the budget sheet'],
    today: ['Pick the final pitch cover', 'Finish the timeline section of the proposal'],
    blockers: ['Waiting on the client for the brand colours'],
    at: at(date, '08:05'),
  }
}
