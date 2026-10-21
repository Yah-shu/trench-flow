import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

// Browser APIs jsdom doesn't have (skipped in the server tests, which run in node).
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })),
  )
}

if (typeof window !== 'undefined' && typeof globalThis.ResizeObserver !== 'function') {
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
}
