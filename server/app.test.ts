// @vitest-environment node
// The server shell: loopback-only checks, health, and the built page with its fallback.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const tmp = mkdtempSync(join(tmpdir(), 'tf-app-'))
process.env.TRENCHFLOW_DIR = join(tmp, 'data')
process.env.TRENCHFLOW_NO_EMBED = '1'
const dist = join(tmp, 'dist')
mkdirSync(join(dist, 'assets'), { recursive: true })
writeFileSync(join(dist, 'index.html'), '<!doctype html><title>page</title>')
writeFileSync(join(dist, 'assets', 'a.js'), 'console.log(1)')

let app: import('hono').Hono
beforeAll(async () => {
  const { createApp } = await import('./app.ts')
  app = createApp({ port: 7766, webPort: 7767, distDir: dist })
})
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const get = (path: string, headers: Record<string, string> = {}) => app.request(`http://127.0.0.1:7766${path}`, { headers: { host: '127.0.0.1:7766', ...headers } })

describe('loopback only', () => {
  it('refuses a foreign Host (DNS rebinding)', async () => {
    expect((await get('/api/health', { host: 'evil.example:7766' })).status).toBe(403)
    expect((await get('/api/health', { host: 'localhost:7766' })).status).toBe(200)
  })
  it('refuses another website as Origin, allows its own and the dev page', async () => {
    expect((await get('/api/day/settings', { origin: 'https://evil.example' })).status).toBe(403)
    expect((await get('/api/day/settings', { origin: 'http://127.0.0.1:9999' })).status).toBe(403)
    expect((await get('/api/day/settings', { origin: 'http://127.0.0.1:7766' })).status).toBe(200)
    expect((await get('/api/day/settings', { origin: 'http://localhost:7767' })).status).toBe(200)
  })
  it('a write from another site is refused before it runs', async () => {
    const r = await app.request('http://127.0.0.1:7766/api/day/settings', {
      method: 'PUT',
      headers: { host: '127.0.0.1:7766', origin: 'https://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ aiLevel: 'high' }),
    })
    expect(r.status).toBe(403)
    const s = (await (await get('/api/day/settings')).json()) as { aiLevel: string }
    expect(s.aiLevel).toBe('medium')
  })
})

describe('page', () => {
  it('health names the app', async () => {
    const r = await get('/api/health')
    expect(await r.json()).toMatchObject({ ok: true, app: 'trench-flow' })
    expect(r.headers.get('x-frame-options')).toBe('DENY')
  })
  it('serves the page, its files, and the page for unknown paths', async () => {
    expect(await (await get('/')).text()).toContain('<title>page</title>')
    const js = await get('/assets/a.js')
    expect(js.headers.get('content-type')).toContain('javascript')
    expect(js.headers.get('cache-control')).toContain('immutable')
    expect(await (await get('/day/2026-10-17')).text()).toContain('<title>page</title>')
    expect((await get('/api/nope')).status).toBe(404)
  })
  it('never serves files outside the page folder', async () => {
    const r = await get('/%2e%2e/%2e%2e/package.json')
    expect(await r.text()).not.toContain('"name"')
  })
})
