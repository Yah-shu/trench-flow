/**
 * Haiku calls for Day, on the user's own Claude plan through the local Claude Code CLI:
 * --model haiku, no tools, empty strict MCP config, own short system prompt, isolation settings from
 * ./host.ts, cwd = the empty work folder inside the Day folder, JSON output with a schema, hard timeout.
 * Every call is logged (duration, sizes, tokens, cost) without content. Calls are skipped at >= 93% weekly usage.
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { agentEnv, claudeBin, isolationSettings, readUsage, type UsageReading } from './host.ts'
import { AI_USER } from './defaults.ts'
import { logCall, readConfig, workDir } from './store.ts'
import type { Category } from './types.ts'

export const USAGE_CAP = 93
const USAGE_CACHE_MIN = 10

let usageCache: { at: number; state: UsageReading } | null = null

/** True when the weekly usage is at or over the cap. A failed check (UNKNOWN) does not block these tiny calls. */
export async function overUsageCap(): Promise<boolean> {
  if (process.env.TRENCHFLOW_SKIP_USAGE === '1') return false
  if (!usageCache || Date.now() - usageCache.at > USAGE_CACHE_MIN * 60_000) {
    const state = await readUsage(USAGE_CAP).catch((): UsageReading => ({ state: 'UNKNOWN', weeklyPct: null }))
    usageCache = { at: Date.now(), state }
  }
  const u = usageCache.state
  return u.state === 'STOP' || (typeof u.weeklyPct === 'number' && u.weeklyPct >= USAGE_CAP)
}

export class UsageCapError extends Error {
  constructor() {
    super('weekly usage cap reached')
  }
}

export interface ClaudeCall {
  kind: string
  system: string
  prompt: string
  schema: Record<string, unknown>
  timeoutMs: number
  /** JPEG screenshots (base64), each shown after its label and before the prompt. */
  images?: { label: string; data: string }[]
}

export function claudeArgs(call: Pick<ClaudeCall, 'system' | 'schema' | 'images'>): string[] {
  // images need the stream-json input; the last output line is the same result object as with --output-format json
  const io = call.images?.length ? ['--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'] : ['--output-format', 'json']
  return [
    '-p',
    '--model', 'haiku',
    ...io,
    '--no-session-persistence',
    '--tools', '',
    '--strict-mcp-config',
    '--mcp-config', '{"mcpServers":{}}',
    '--setting-sources', 'project',
    '--settings', isolationSettings(),
    '--permission-mode', 'dontAsk',
    '--disable-slash-commands',
    '--system-prompt', call.system,
    '--json-schema', JSON.stringify(call.schema),
  ]
}

/** Runs one call and returns structured_output. Throws on timeout, CLI error or missing output. */
export async function runClaude<T>(call: ClaudeCall): Promise<T> {
  // the one door to the AI: with the AI level off nothing ever goes out
  if (readConfig().aiLevel === 'off') throw new Error('AI is off in Settings')
  mkdirSync(workDir(), { recursive: true })
  const t0 = Date.now()
  return new Promise<T>((resolve, reject) => {
    const child = spawn(claudeBin(), claudeArgs(call), { cwd: workDir(), shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: agentEnv({ MAX_THINKING_TOKENS: '0' }) })
    let stdout = ''
    let stderr = ''
    let done = false
    const finish = (ok: boolean, extra: Record<string, unknown>, settle: () => void) => {
      if (done) return
      done = true
      clearTimeout(timer)
      logCall({ kind: call.kind, ok, ms: Date.now() - t0, inChars: call.prompt.length + call.system.length, images: call.images?.length ?? 0, outChars: stdout.length, ...extra })
      settle()
    }
    const timer = setTimeout(() => {
      finish(false, { error: 'timeout' }, () => reject(new Error(`claude timed out after ${Math.round(call.timeoutMs / 1000)} s`)))
      if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => undefined)
      else child.kill()
    }, call.timeoutMs)
    child.stdout.on('data', (d) => (stdout += String(d)))
    child.stderr.on('data', (d) => (stderr += String(d)))
    child.on('error', (err) => finish(false, { error: 'spawn' }, () => reject(new Error(`could not start Claude Code: ${err.message}`))))
    child.on('close', (code) => {
      let r: {
        is_error?: boolean
        result?: string
        structured_output?: T
        total_cost_usd?: number
        usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
      } | null = null
      try {
        r = JSON.parse(stdout.trim().split('\n').pop() ?? '')
      } catch {
        // handled below
      }
      const usage = {
        inputTokens: r?.usage?.input_tokens,
        cacheReadTokens: r?.usage?.cache_read_input_tokens,
        cacheWriteTokens: r?.usage?.cache_creation_input_tokens,
        outputTokens: r?.usage?.output_tokens,
        costUsd: r?.total_cost_usd,
      }
      if (!r || r.is_error || r.structured_output === undefined) {
        const why = (r?.result ?? stderr.trim() ?? '').slice(0, 300) || `exit ${code}`
        finish(false, { ...usage, error: 'failed' }, () => reject(new Error(`claude failed: ${why}`)))
        return
      }
      finish(true, usage, () => resolve(r!.structured_output as T))
    })
    child.stdin.on('error', () => undefined)
    if (!call.images?.length) child.stdin.end(call.prompt)
    else {
      const content = [
        ...call.images.flatMap((im) => [
          { type: 'text', text: im.label },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: im.data } },
        ]),
        { type: 'text', text: call.prompt },
      ]
      child.stdin.end(`${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`)
    }
  })
}

// —— classification ——

export const MAX_TITLES_PER_CALL = 150

export async function classifyTitles(
  items: { app: string; title: string }[],
  categories: { id: string; name: string }[],
  run: typeof runClaude = runClaude,
): Promise<Record<number, string>> {
  const ids = categories.map((c) => c.id)
  const system =
    `You sort computer window titles into time-tracking categories ${AI_USER.classify}. Answer only with the JSON. Use "other" when unsure.`
  const prompt =
    `Categories (id: meaning):\n${categories.map((c) => `${c.id}: ${c.name}`).join('\n')}\n\n` +
    `Classify each window (index | app | title):\n${items.map((it, i) => `${i} | ${it.app.replace(/\.exe$/i, '')} | ${it.title.slice(0, 200)}`).join('\n')}`
  const schema = {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: { type: 'object', properties: { i: { type: 'integer' }, c: { type: 'string', enum: ids } }, required: ['i', 'c'], additionalProperties: false },
      },
    },
    required: ['items'],
    additionalProperties: false,
  }
  const out = await run<{ items: { i: number; c: string }[] }>({ kind: 'classify', system, prompt, schema, timeoutMs: 120_000 })
  const res: Record<number, string> = {}
  for (const x of out?.items ?? []) if (Number.isInteger(x.i) && x.i >= 0 && x.i < items.length && ids.includes(x.c)) res[x.i] = x.c
  return res
}

// —— card titles and summaries (every few hours, small batches) ——

export interface CardInput {
  id: string
  time: string
  category: string
  windows: string
  distractions: string
  /** A couple of screenshots (base64 JPEG) when the window titles say too little. */
  shots?: string[]
}

export interface CardOut {
  title: string
  summary: string
  /** The category that fits what was on screen (only asked for when categories are given). */
  categoryId?: string
}

/**
 * Titles + summaries for live cards, and (with `categories`) the category that fits what was actually on screen.
 * `before` = titles of the cards just before them, for continuity.
 */
export async function describeCards(
  cards: CardInput[],
  before: string[],
  categories: Category[] = [],
  run: typeof runClaude = runClaude,
): Promise<Record<string, CardOut>> {
  const system =
    'You name and describe blocks of computer activity for a personal time-tracking diary. Use only what the window ' +
    'titles, websites and screenshots show; name the concrete things (products, stores, tools, people, sites). Never invent. Answer only with the JSON.'
  const catIds = categories.map((c) => c.id)
  const prompt =
    (before.length ? `Earlier blocks today: ${before.join(' | ')}\n\n` : '') +
    `For each block write a title of 3-8 words that starts with what was done (${AI_USER.titleExample}) ` +
    'and a summary of 1-2 sentences (<= 200 chars) saying what was worked on; mention distractions only if listed.\n' +
    (catIds.length
      ? `Also pick categoryId: the category that best fits what the block was really spent on (the screenshots win over the ` +
        `guessed category when they disagree). Categories: ${categories.map((c) => `${c.id} = ${c.name}${c.kind ? ` (${c.kind})` : ''}`).join(', ')}.\n`
      : '') +
    `\nBlocks (id | local time | guessed category | main windows with minutes | distractions):\n` +
    cards.map((c) => `${c.id} | ${c.time} | ${c.category} | ${c.windows} | ${c.distractions || '-'}`).join('\n')
  const ids = cards.map((c) => c.id)
  const item: Record<string, unknown> = { id: { type: 'string', enum: ids }, title: { type: 'string', maxLength: 60 }, summary: { type: 'string', maxLength: 200 } }
  if (catIds.length) item.categoryId = { type: 'string', enum: catIds }
  const schema = {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: { type: 'object', properties: item, required: Object.keys(item), additionalProperties: false },
      },
    },
    required: ['items'],
    additionalProperties: false,
  }
  const images = cards.flatMap((c) => (c.shots ?? []).map((data, i) => ({ label: `Screenshot ${i + 1} of block ${c.id}:`, data })))
  const withShots = images.length
    ? `${prompt}\n\nBlocks come with screenshots (shown above, labelled with the block id): use them to say what was actually on screen.`
    : prompt
  const out = await run<{ items: { id: string; title: string; summary: string; categoryId?: string }[] }>({ kind: 'cards', system, prompt: withShots, schema, timeoutMs: 240_000, images })
  const res: Record<string, CardOut> = {}
  for (const x of out?.items ?? []) {
    if (!ids.includes(x.id) || !x.title) continue
    res[x.id] = { title: x.title.slice(0, 60), summary: (x.summary ?? '').slice(0, 200), ...(x.categoryId && catIds.includes(x.categoryId) ? { categoryId: x.categoryId } : {}) }
  }
  return res
}

// —— day summary ——

export interface SummaryOut {
  /** Older summaries also wrote the cards; live cards replaced that (kept optional for old day files). */
  cards?: { start: string; end: string; device: string; categoryId?: string; title: string; summary: string }[]
  summary: { text: string; highlights: string[]; biggestTimeSink: { label: string; minutes: number } }
}

export async function summarizeDay(
  o: { date: string; compact: string; categories: { id: string; name: string; kind: string }[]; devices: string[]; totalsLine: string },
  run: typeof runClaude = runClaude,
): Promise<SummaryOut> {
  const system =
    `You turn one day of computer activity into a short work diary ${AI_USER.summary}. Be concrete (name the ` +
    'stores, products, tools and sites seen), honest about distractions, never invent activity. Answer only with the JSON.'
  const prompt =
    `Date ${o.date}. Devices: ${o.devices.join(', ')}. Totals: ${o.totalsLine}\n` +
    `Categories: ${o.categories.map((c) => `${c.id} (${c.name}, ${c.kind})`).join('; ')}\n\n` +
    'Write a day summary: text of 3-5 sentences, exactly 3 highlights, and the biggest time sink (label + minutes).\n\n' +
    `The day's blocks (local start-end device | category | title | what happened | distractions):\n${o.compact}`
  const schema = {
    type: 'object',
    properties: {
      summary: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          highlights: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 },
          biggestTimeSink: { type: 'object', properties: { label: { type: 'string' }, minutes: { type: 'number' } }, required: ['label', 'minutes'], additionalProperties: false },
        },
        required: ['text', 'highlights', 'biggestTimeSink'],
        additionalProperties: false,
      },
    },
    required: ['summary'],
    additionalProperties: false,
  }
  return run<SummaryOut>({ kind: 'summary', system, prompt, schema, timeoutMs: 240_000 })
}
