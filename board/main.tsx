/**
 * trench-flow's page: the Day view and nothing else.
 *
 *   #/day          today
 *   #/day/<date>   that day (YYYY-MM-DD)
 */
import { StrictMode, startTransition, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../theme/plinth.css'
import './app.css'
import { Day } from './day/Day.tsx'

function useHash(): string {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onChange = () => startTransition(() => setHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
}

/** `#/day/2026-10-17` → '2026-10-17'; `#/day` (or anything else) → undefined, i.e. today. */
export function dateOf(hash: string): string | undefined {
  const m = /^#\/day\/(\d{4}-\d{2}-\d{2})$/.exec(hash)
  return m ? m[1] : undefined
}

function App() {
  const hash = useHash()
  useEffect(() => {
    if (!/^#\/day(\/|$)/.test(hash)) window.location.replace('#/day')
  }, [hash])
  const date = dateOf(hash)
  return (
    <div className="pl-shell tf-shell">
      <main className="pl-content tf-content">
        <Day key={date ?? 'today'} date={date} />
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
