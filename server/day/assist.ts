/**
 * Chat with your day and the morning standup: two small Haiku calls on top of the day digest (cards + totals +
 * summary, see service.ts dayDigest). Both answer only from the tracked data and are skipped at the usage cap.
 */
import { overUsageCap, runClaude } from './ai.ts'
import { buildWeek, dayDigest, shiftDate } from './service.ts'
import { readConfig, readDay, updateDay } from './store.ts'
import type { Standup } from './types.ts'

type Fail = { error: string; status: 400 | 409 | 429 | 500 }

let chatting = false

/** Haiku sometimes nests a JSON object inside the answer string; turn that back into plain sentences. */
export function plainAnswer(a: string): string {
  const t = a.trim()
  if (!t.startsWith('{')) return a
  try {
    const o = JSON.parse(t) as unknown
    if (o && typeof o === 'object') return Object.values(o as Record<string, unknown>).map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' ')
  } catch {
    // not JSON after all
  }
  return a
}

/** One question about a day (with that week's numbers and the conversation so far). */
export async function askDay(date: string, question: string, history: { role: 'you' | 'day'; text: string }[]): Promise<{ answer: string } | Fail> {
  if (readConfig().aiLevel === 'off') return { error: 'AI is off in Settings', status: 400 }
  if (chatting) return { error: 'still answering the last question', status: 409 }
  if (await overUsageCap()) return { error: 'skipped to save your Claude usage', status: 429 }
  chatting = true
  try {
    const [day, week] = await Promise.all([dayDigest(date), buildWeek(date)])
    const weekLine = week.days.map((d) => `${d.date}: focus ${Math.round(d.focusMinutes)}m, distraction ${Math.round(d.distractionMinutes)}m`).join('; ')
    const earlier = [1, 2, 3, 4, 5, 6]
      .map((i) => shiftDate(date, -i))
      .map((d) => [d, readDay(d).summary?.text] as const)
      .filter(([, t]) => t)
      .map(([d, t]) => `${d}: ${t}`)
      .join('\n')
    const system =
      'You answer questions about one person\'s tracked computer time. Use only the data given; say plainly when it ' +
      "doesn't show something. Be short and concrete (times, minutes, names of sites and tools). Answer only with the JSON; " +
      'its "answer" is plain sentences (no JSON, no lists of keys inside it).'
    const prompt =
      `The day asked about:\n${day.text}\n\nThe 7 days up to it: ${weekLine}\n` +
      (earlier ? `\nEarlier summaries:\n${earlier}\n` : '') +
      (history.length ? `\nConversation so far:\n${history.map((h) => `${h.role === 'you' ? 'Q' : 'A'}: ${h.text}`).join('\n')}\n` : '') +
      `\nQuestion: ${question}`
    const schema = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false }
    const out = await runClaude<{ answer: string }>({ kind: 'chat', system, prompt, schema, timeoutMs: 120_000 })
    return { answer: plainAnswer(out.answer) }
  } catch (err) {
    return { error: (err as Error).message.slice(0, 200), status: 500 }
  } finally {
    chatting = false
  }
}

export const getStandup = (date: string): Standup | null => readDay(date).standup ?? null

let standing = false

/** Yesterday in 2-4 lines, 2-4 suggested priorities for today, and blockers seen in the data. Saved on the day. */
export async function makeStandup(date: string): Promise<{ standup: Standup } | Fail> {
  if (readConfig().aiLevel === 'off') return { error: 'AI is off in Settings', status: 400 }
  if (standing) return { error: 'already writing the standup', status: 409 }
  if (await overUsageCap()) return { error: 'skipped to save your Claude usage', status: 429 }
  standing = true
  try {
    const [yesterday, todaySoFar] = await Promise.all([dayDigest(shiftDate(date, -1)), dayDigest(date)])
    if (!yesterday.active && !todaySoFar.active) return { error: 'nothing tracked yesterday or today yet', status: 400 }
    const system =
      'You write a short personal standup from tracked computer time. Use only the data; never invent tasks. ' +
      'Priorities continue what was started or left unfinished. Blockers only when the data shows them (long stalls, ' +
      'repeated failed attempts, lots of distraction). Answer only with the JSON.'
    const prompt =
      `Yesterday:\n${yesterday.text}\n\n` +
      (todaySoFar.active ? `Today so far:\n${todaySoFar.text}\n\n` : '') +
      'Write: yesterday = 2-4 short lines of what got done; today = 2-4 suggested priorities; blockers = 0-3 short lines.'
    const list = { type: 'array', items: { type: 'string', maxLength: 160 } }
    const schema = {
      type: 'object',
      properties: { yesterday: { ...list, maxItems: 4 }, today: { ...list, maxItems: 4 }, blockers: { ...list, maxItems: 3 } },
      required: ['yesterday', 'today', 'blockers'],
      additionalProperties: false,
    }
    const out = await runClaude<Omit<Standup, 'at'>>({ kind: 'standup', system, prompt, schema, timeoutMs: 120_000 })
    const standup: Standup = { yesterday: out.yesterday.slice(0, 4), today: out.today.slice(0, 4), blockers: out.blockers.slice(0, 3), at: new Date().toISOString() }
    updateDay(date, { standup })
    return { standup }
  } catch (err) {
    return { error: (err as Error).message.slice(0, 200), status: 500 }
  } finally {
    standing = false
  }
}
