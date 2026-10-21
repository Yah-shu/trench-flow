/**
 * How trench-flow starts the Claude Code CLI, and the weekly usage check that stops the AI near your plan's cap.
 *
 * The CLI runs on your own Claude login (whatever `claude` is signed in to). It is started with:
 *   - claudeBin(): CLAUDE_BIN if set, else the usual install places, else `claude` on PATH;
 *   - isolationSettings(): your personal CLAUDE.md files are not loaded into these small calls;
 *   - agentEnv(): this process's environment, with claude.ai connectors turned off for the call.
 *
 * readUsage() asks Anthropic's usage endpoint for the plan's weekly figure, with the OAuth token Claude Code keeps in
 * ~/.claude/.credentials.json (CLAUDE_CONFIG_DIR moves that folder). The token is read for that one request, sent
 * only to api.anthropic.com, and never logged or stored. When the file isn't there (macOS keeps it in the Keychain),
 * the answer is UNKNOWN and the AI carries on as normal; TRENCHFLOW_SKIP_USAGE=1 skips the check entirely.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

export interface UsageReading {
  state: 'OK' | 'WARN' | 'STOP' | 'UNKNOWN'
  weeklyPct: number | null
}

const fwd = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')

/** Where the Claude Code CLI is: CLAUDE_BIN, the native and npm install places, then PATH. */
export function claudeBin(): string {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN
  const home = homedir()
  const win = process.platform === 'win32'
  const exe = win ? 'claude.exe' : 'claude'
  const places = [
    join(home, '.local', 'bin', exe),
    join(home, '.claude', 'local', exe),
    ...(win ? [join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')] : ['/opt/homebrew/bin/claude', '/usr/local/bin/claude']),
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean).map((d) => join(d, exe)),
  ]
  return places.find((p) => existsSync(p)) ?? 'claude'
}

/** JSON for --settings: personal instruction files are not loaded into these calls. */
export function isolationSettings(extra: { claudeMdExcludes?: string[]; [key: string]: unknown } = {}): string {
  const h = fwd(homedir())
  return JSON.stringify({ ...extra, claudeMdExcludes: [`${h}/.claude/**`, `${h}/CLAUDE.md`, ...(extra.claudeMdExcludes ?? [])] })
}

/** The child's environment: ours plus `extra`, with claude.ai connectors off. */
export function agentEnv(extra: Record<string, string> = {}, base: Record<string, string | undefined> = process.env): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries({ ...base, ...extra })) if (value !== undefined) env[key] = value
  env.ENABLE_CLAUDEAI_MCP_SERVERS = 'false'
  return env
}

const credentialsFile = () => join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), '.credentials.json')

/** Reads the weekly figure out of the usage endpoint's answer: { seven_day: { utilization } }. */
export function parseUsageBody(body: unknown, capPct: number, softPct = 80): UsageReading {
  const week = (body as { seven_day?: { utilization?: unknown } } | null)?.seven_day?.utilization
  const pct = typeof week === 'number' ? week : typeof week === 'string' && week.trim() !== '' ? Number(week) : NaN
  if (!Number.isFinite(pct)) return { state: 'UNKNOWN', weeklyPct: null }
  return { state: pct >= capPct ? 'STOP' : pct >= softPct ? 'WARN' : 'OK', weeklyPct: pct }
}

/** The Claude plan's weekly usage now. Any failure is UNKNOWN. */
export async function readUsage(capPct: number, fetchImpl: typeof fetch = fetch): Promise<UsageReading> {
  let token: string | undefined
  try {
    token = (JSON.parse(readFileSync(credentialsFile(), 'utf8')) as { claudeAiOauth?: { accessToken?: string } }).claudeAiOauth?.accessToken
  } catch {
    return { state: 'UNKNOWN', weeklyPct: null }
  }
  if (!token) return { state: 'UNKNOWN', weeklyPct: null }
  try {
    const res = await fetchImpl('https://api.anthropic.com/api/oauth/usage', {
      headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'trench-flow-usage-check' },
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) return { state: 'UNKNOWN', weeklyPct: null }
    return parseUsageBody(await res.json(), capPct)
  } catch {
    return { state: 'UNKNOWN', weeklyPct: null }
  }
}
