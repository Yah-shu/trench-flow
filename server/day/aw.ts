/**
 * ActivityWatch reader. Each source is one aw-server (this computer, or another device's ActivityWatch reachable over a private network). A source that
 * does not answer is reported offline; nothing here throws.
 *
 * Browser tabs come from the aw-watcher-web extension (bucket type "web.tab.current", data.url + data.title). Its
 * buckets are attached to the host with the same hostname, or to the only host of that server (the extension
 * reports "unknown" unless its hostname is set).
 */
import type { Source } from './types.ts'

export interface AwEvent {
  timestamp: string
  duration: number
  data: Record<string, unknown>
}

interface AwBucket {
  id: string
  type: string
  hostname: string
  last_updated?: string
}

export interface SourceData {
  source: Source
  online: boolean
  lastSeen: string | null
  /** Window, AFK and browser-tab events per host on that server. */
  hosts: { hostname: string; window: AwEvent[]; afk: AwEvent[]; web: AwEvent[] }[]
}

const TIMEOUT = 8_000

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

const base = (u: string) => u.replace(/\/+$/, '')

export async function readSource(source: Source, start: Date, end: Date): Promise<SourceData> {
  const out: SourceData = { source, online: false, lastSeen: null, hosts: [] }
  let buckets: Record<string, AwBucket>
  try {
    buckets = await getJson<Record<string, AwBucket>>(`${base(source.url)}/api/0/buckets/`)
    out.online = true
  } catch {
    return out
  }
  const list = Object.values(buckets)
  const hosts = [...new Set(list.map((b) => b.hostname))]
  const q = `start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}&limit=-1`
  const events = async (b?: AwBucket) => {
    if (!b) return []
    try {
      return await getJson<AwEvent[]>(`${base(source.url)}/api/0/buckets/${encodeURIComponent(b.id)}/events?${q}`)
    } catch {
      return []
    }
  }
  const windowHosts = hosts.filter((h) => list.some((b) => b.hostname === h && b.type === 'currentwindow'))
  const webBuckets = list.filter((b) => b.type === 'web.tab.current')
  for (const hostname of windowHosts) {
    const win = list.find((b) => b.hostname === hostname && b.type === 'currentwindow')
    const afk = list.find((b) => b.hostname === hostname && b.type === 'afkstatus')
    const web = webBuckets.filter((b) => b.hostname === hostname || (windowHosts.length === 1 && !windowHosts.includes(b.hostname)))
    for (const b of [win, afk]) {
      if (b?.last_updated && (!out.lastSeen || b.last_updated > out.lastSeen)) out.lastSeen = new Date(b.last_updated).toISOString()
    }
    const [w, a, ...tabs] = await Promise.all([events(win), events(afk), ...web.map((b) => events(b))])
    out.hosts.push({ hostname, window: w, afk: a, web: tabs.flat() })
  }
  return out
}
