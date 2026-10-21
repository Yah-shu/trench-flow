import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    restoreMocks: true,
    clearMocks: true,
    // The AI is mocked in every test and the local look-alike model is never loaded.
    // CLAUDE_BIN points nowhere, so even a test that forgot its mock could never start the real Claude Code CLI.
    env: { TRENCHFLOW_NO_EMBED: '1', TRENCHFLOW_SKIP_USAGE: '1', CLAUDE_BIN: 'no-claude-in-tests' },
  },
})
