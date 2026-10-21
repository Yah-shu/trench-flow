/**
 * Local look-alike matcher (no AI tokens): a small embedding model (all-MiniLM-L6-v2, 8-bit, ~23 MB, runs on the
 * CPU through transformers.js) turns "app: title" into a vector. A new title takes the category of its closest
 * labelled titles when they are close enough and agree; everything else still goes to Haiku.
 *
 * Labelled examples = titles a title rule decided + Haiku's cached answers. Labels are looked up fresh on every
 * use, so a changed rule relabels its examples. App-only rules (e.g. "any window of this browser = research") are not examples:
 * they say nothing about what the title means.
 *
 * Tested 2026-10-20 on 142 real labelled titles (leave-one-out): at similarity 0.85 it answered 39% of them
 * and 95% of those answers were right. Vectors are stored in vectors.json (newest 5,000), the model in models/.
 * If the model can't load (offline first run, missing package), this stays off for an hour and Haiku does it all.
 */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { matchRuleDetail } from './compute.ts'
import { dayRoot, normTitle, readJson, titleKey, userLabels, writeJson } from './store.ts'
import type { DayConfig } from './types.ts'

const MODEL = 'Xenova/all-MiniLM-L6-v2'
export const MIN_SIM = 0.85
const K = 5
const AGREE = 0.6
const MAX_VECTORS = 5000

type Extract = (texts: string[], o: { pooling: 'mean'; normalize: boolean }) => Promise<{ tolist(): number[][] }>

let extractor: Promise<Extract> | null = null
let offUntil = 0

async function model(): Promise<Extract | null> {
  if (process.env.TRENCHFLOW_NO_EMBED === '1' || Date.now() < offUntil) return null
  extractor ??= (async () => {
    const t = await import('@huggingface/transformers')
    t.env.cacheDir = join(dayRoot(), 'models')
    return (await t.pipeline('feature-extraction', MODEL, { dtype: 'q8' })) as unknown as Extract
  })()
  try {
    return await extractor
  } catch (err) {
    extractor = null
    offUntil = Date.now() + 60 * 60_000
    console.error('[day] local matcher off for an hour:', (err as Error).message)
    return null
  }
}

// —— vector store: key -> { app, title, last used, base64 float32 } ——

interface Stored { a: string; t: string; d?: string; u: number; v: string }
const vecFile = () => join(dayRoot(), 'vectors.json')
let store: Record<string, Stored> | null = null
const decoded = new Map<string, Float32Array>()

const vecOf = (k: string) => {
  let v = decoded.get(k)
  if (!v && store?.[k]) {
    const b = Buffer.from(store[k].v, 'base64')
    v = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
    decoded.set(k, v)
  }
  return v
}

type Item = { app: string; title: string; domain?: string }

const textOf = (it: Item) => `${it.app.replace(/\.exe$/i, '')}: ${normTitle(it.title)}${it.domain ? ` (${it.domain})` : ''}`

/** Makes sure every item has a vector (only new ones go through the model). False when the model is unavailable. */
async function ensureVectors(items: Item[]): Promise<boolean> {
  store ??= readJson<Record<string, Stored>>(vecFile(), {})
  const now = Date.now()
  const missing = new Map<string, Item>()
  for (const it of items) {
    const k = titleKey(it.app, it.title)
    if (store[k]) store[k].u = now
    else if (!missing.has(k)) missing.set(k, it)
  }
  if (!missing.size) return true
  const fe = await model()
  if (!fe) return false
  const list = [...missing.entries()]
  for (let i = 0; i < list.length; i += 64) {
    const part = list.slice(i, i + 64)
    const out = (await fe(part.map(([, it]) => textOf(it)), { pooling: 'mean', normalize: true })).tolist()
    part.forEach(([k, it], j) => {
      const v = Float32Array.from(out[j])
      decoded.set(k, v)
      store![k] = { a: it.app, t: it.title, ...(it.domain ? { d: it.domain } : {}), u: now, v: Buffer.from(v.buffer).toString('base64') }
    })
  }
  const keys = Object.keys(store)
  if (keys.length > MAX_VECTORS) {
    for (const k of keys.sort((x, y) => store![x].u - store![y].u).slice(0, keys.length - MAX_VECTORS)) {
      delete store[k]
      decoded.delete(k)
    }
  }
  writeJson(vecFile(), store)
  return true
}

/** Changes whenever the rules or the category list change; the local answers are thrown away then. */
export const rulesHash = (cfg: Pick<DayConfig, 'rules' | 'categories'>) =>
  createHash('sha1').update(JSON.stringify([cfg.rules, cfg.categories.map((c) => c.id)])).digest('hex').slice(0, 16)

const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/**
 * Answers what it can for `todo` from look-alikes among the labelled examples. `seen` = today's titles, so titles
 * that rules label become examples. Returns key -> category for the confident ones only.
 */
export async function matchLocally(
  todo: Item[],
  seen: Item[],
  cfg: Pick<DayConfig, 'rules' | 'categories'>,
  aiCache: Record<string, string>,
): Promise<Record<string, string>> {
  if (!todo.length) return {}
  const valid = new Set(cfg.categories.map((c) => c.id))
  const mine = userLabels()
  const labelOf = (app: string, title: string, domain?: string) => {
    const k = titleKey(app, title)
    if (mine[k] && valid.has(mine[k])) return mine[k]
    const r = matchRuleDetail(cfg.rules, app, title, domain)
    if (r) return r.byTitle && valid.has(r.categoryId) ? r.categoryId : null
    const c = aiCache[k]
    return c && c !== 'other' && valid.has(c) ? c : null
  }
  const fresh = seen.filter((s) => labelOf(s.app, s.title, s.domain))
  if (!(await ensureVectors([...todo, ...fresh]))) return {}
  const examples: { k: string; v: Float32Array; label: string }[] = []
  for (const [k, s] of Object.entries(store ?? {})) {
    const label = labelOf(s.a, s.t, s.d)
    const v = label ? vecOf(k) : undefined
    if (label && v) examples.push({ k, v, label })
  }
  const out: Record<string, string> = {}
  for (const it of todo) {
    const k = titleKey(it.app, it.title)
    const q = vecOf(k)
    if (!q) continue
    const near = examples
      .filter((e) => e.k !== k)
      .map((e) => ({ s: dot(q, e.v), label: e.label }))
      .filter((e) => e.s >= MIN_SIM)
      .sort((a, b) => b.s - a.s)
      .slice(0, K)
    if (!near.length) continue
    const votes = new Map<string, number>()
    for (const n of near) votes.set(n.label, (votes.get(n.label) ?? 0) + n.s)
    const [best, w] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]
    if (w / near.reduce((n, e) => n + e.s, 0) >= AGREE) out[k] = best
  }
  return out
}

/** Tests only. */
export function resetEmbedMemo(): void {
  store = null
  decoded.clear()
  offUntil = 0
}
