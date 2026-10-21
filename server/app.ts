/**
 * The trench-flow server: the Day API under /api and the built page (dist/), for this computer only.
 *
 * Loopback only. main.ts binds 127.0.0.1, and every request is checked here as well:
 *   - Host must be 127.0.0.1, localhost or [::1] (blocks DNS rebinding: a foreign name pointed at 127.0.0.1);
 *   - an Origin header, when there is one, must be this server's own address or the dev page's (Vite), so another
 *     website open in your browser can't read your day or change your settings.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import pkg from '../package.json' with { type: 'json' }
import { dayRoutes } from './day/routes.ts'

export const VERSION: string = pkg.version
export const DEFAULT_PORT = 7766
export const DEFAULT_WEB_PORT = 7767

const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ')

export interface AppOptions {
  /** The port the server listens on (its own origin is allowed). */
  port?: number
  /** The dev page's port (`bun run dev`), allowed as an origin too. */
  webPort?: number
  /** The built page. */
  distDir?: string
}

export function createApp(o: AppOptions = {}): Hono {
  const port = o.port ?? DEFAULT_PORT
  const webPort = o.webPort ?? DEFAULT_WEB_PORT
  const dist = resolve(o.distDir ?? fileURLToPath(new URL('../dist', import.meta.url)))
  const origins = new Set<string>()
  for (const p of [port, webPort]) for (const h of ['127.0.0.1', 'localhost', '[::1]']) origins.add(`http://${h}:${p}`)

  const app = new Hono()

  app.use('*', async (c, next) => {
    if (!LOOPBACK_HOST.test(c.req.header('host') ?? '')) return c.json({ error: 'forbidden host' }, 403)
    const origin = c.req.header('origin')
    if (origin !== undefined && !origins.has(origin)) return c.json({ error: 'forbidden origin' }, 403)
    await next()
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('X-Frame-Options', 'DENY')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('Content-Security-Policy', CSP)
  })

  app.get('/api/health', (c) => c.json({ ok: true, app: 'trench-flow', version: VERSION }))
  app.route('/api', dayRoutes)
  app.all('/api/*', (c) => c.json({ error: 'not found' }, 404))

  const file = (p: string) => {
    const body = readFileSync(p)
    return new Response(new Uint8Array(body), { headers: { 'content-type': TYPES[extname(p).toLowerCase()] ?? 'application/octet-stream' } })
  }

  app.get('*', (c) => {
    const index = join(dist, 'index.html')
    if (!existsSync(index)) {
      return c.html(
        '<!doctype html><meta charset="utf-8"><title>trench-flow</title><p style="font:16px system-ui;margin:40px">' +
          'The page is not built yet. Run <code>bun run build</code> in the trench-flow folder, then reload.</p>',
        503,
      )
    }
    let rel: string
    try {
      rel = decodeURIComponent(new URL(c.req.url).pathname)
    } catch {
      return c.json({ error: 'bad path' }, 400)
    }
    const p = resolve(dist, `.${rel}`)
    if (p !== dist && !p.startsWith(dist + sep)) return c.json({ error: 'not found' }, 404)
    if (existsSync(p) && statSync(p).isFile()) {
      const res = file(p)
      // Vite's hashed files never change; the page itself is always checked again.
      res.headers.set('cache-control', rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
      return res
    }
    const res = file(index)
    res.headers.set('cache-control', 'no-cache')
    return res
  })

  return app
}
