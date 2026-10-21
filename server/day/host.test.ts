// @vitest-environment node
// The Claude CLI helpers and the weekly usage check. Nothing here reaches the network or starts `claude`.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { agentEnv, claudeBin, isolationSettings, parseUsageBody, readUsage } from './host.ts'

const dir = mkdtempSync(join(tmpdir(), 'tf-host-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('claude cli', () => {
  it('CLAUDE_BIN wins', () => {
    const before = process.env.CLAUDE_BIN
    process.env.CLAUDE_BIN = '/some/claude'
    expect(claudeBin()).toBe('/some/claude')
    process.env.CLAUDE_BIN = before
  })
  it('turns connectors off and keeps personal instructions out', () => {
    expect(agentEnv({ A: '1' }, { B: '2', C: undefined })).toEqual({ A: '1', B: '2', ENABLE_CLAUDEAI_MCP_SERVERS: 'false' })
    const s = JSON.parse(isolationSettings()) as { claudeMdExcludes: string[] }
    expect(s.claudeMdExcludes.some((p) => p.endsWith('/.claude/**'))).toBe(true)
    expect(s.claudeMdExcludes.some((p) => p.endsWith('/CLAUDE.md'))).toBe(true)
  })
})

describe('weekly usage', () => {
  it('reads the weekly figure against the cap', () => {
    expect(parseUsageBody({ seven_day: { utilization: 41 } }, 93)).toEqual({ state: 'OK', weeklyPct: 41 })
    expect(parseUsageBody({ seven_day: { utilization: 85 } }, 93)).toEqual({ state: 'WARN', weeklyPct: 85 })
    expect(parseUsageBody({ seven_day: { utilization: 93 } }, 93)).toEqual({ state: 'STOP', weeklyPct: 93 })
    expect(parseUsageBody({ five_hour: { utilization: 10 } }, 93)).toEqual({ state: 'UNKNOWN', weeklyPct: null })
    expect(parseUsageBody(null, 93).state).toBe('UNKNOWN')
  })

  it('no login file: unknown, and nothing is asked', async () => {
    process.env.CLAUDE_CONFIG_DIR = join(dir, 'none')
    const f = vi.fn()
    expect(await readUsage(93, f as never)).toEqual({ state: 'UNKNOWN', weeklyPct: null })
    expect(f).not.toHaveBeenCalled()
  })

  it('with a login: asks the usage endpoint once, with the token', async () => {
    process.env.CLAUDE_CONFIG_DIR = dir
    writeFileSync(join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'tok' } }))
    const f = vi.fn(async () => Response.json({ seven_day: { utilization: 95 } }))
    expect(await readUsage(93, f as never)).toEqual({ state: 'STOP', weeklyPct: 95 })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/api/oauth/usage')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    const failing = vi.fn(async () => new Response('no', { status: 401 }))
    expect((await readUsage(93, failing as never)).state).toBe('UNKNOWN')
    delete process.env.CLAUDE_CONFIG_DIR
  })
})
