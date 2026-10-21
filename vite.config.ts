import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `bun run dev`: the page on TRENCHFLOW_WEB_PORT (default 7767), the API on TRENCHFLOW_PORT (default 7766).
// `bun run build` writes dist/, which the server serves on its own port.
const web = Number(process.env.TRENCHFLOW_WEB_PORT || 7767)
const api = `http://127.0.0.1:${Number(process.env.TRENCHFLOW_PORT || 7766)}`

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: web,
    strictPort: true,
    proxy: { '/api': { target: api, changeOrigin: true } },
  },
})
