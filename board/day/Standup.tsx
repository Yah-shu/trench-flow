/** The Standup panel: Yesterday / Today / Blockers written from yesterday's activity (/api/day/standup). */
import { useEffect, useState } from 'react'
import { ApiError, getStandup, postStandup } from './api.ts'
import type { Standup } from './types.ts'
import { fmtClock } from './format.ts'
import { aiErrorText } from './live.ts'

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="day-standup__sec">
      <span className="day-mini__h">{title}</span>
      <ul className="day-summary__hl">
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  )
}

export function StandupPanel({ date }: { date: string }) {
  const [standup, setStandup] = useState<Standup | null>(null)
  const [sample, setSample] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoaded(false)
    setError(null)
    getStandup(date).then((r) => {
      if (!alive) return
      setStandup(r.data)
      setSample(r.sample)
      setLoaded(true)
    })
    return () => {
      alive = false
    }
  }, [date])

  async function write() {
    setBusy(true)
    setError(null)
    try {
      const s = await postStandup(date)
      if (s) setStandup(s)
      setSample(false)
    } catch (e) {
      const err = e as ApiError
      setError(sample && !err.status ? 'Writing works once the tracker server is running.' : aiErrorText(err.status ?? 0, err.message, 'standup'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="pl-press day-standup">
      <div className="pl-panel">
        <div className="pl-panel__head">
          <span className="pl-panel__title">Standup</span>
          {standup && (
            <span className="day-summary__tools">
              <span className="day-muted">{busy ? 'rewriting…' : `written ${fmtClock(standup.at)}`}</span>
              <button type="button" className="day-linkbtn" onClick={() => void write()} disabled={busy}>
                Rewrite
              </button>
            </span>
          )}
        </div>
        <div className="pl-panel__body">
          {!loaded ? (
            <p className="day-muted">Loading…</p>
          ) : standup ? (
            <div className="day-standup__body">
              <Section title="Yesterday" items={standup.yesterday} />
              <Section title="Today" items={standup.today} />
              {standup.blockers.length > 0 && <Section title="Blockers" items={standup.blockers} />}
            </div>
          ) : (
            <div className="day-standup__empty">
              <button type="button" className="plinth-btn plinth-btn--sm" onClick={() => void write()} disabled={busy}>
                <span className="plinth-btn__face">
                  <span className="plinth-btn__label">{busy ? 'Writing…' : 'Write my standup'}</span>
                </span>
              </button>
              <span className="day-muted">From yesterday’s activity — takes about 10 s.</span>
            </div>
          )}
          {error && <p className="day-edit__error day-standup__error">{error}</p>}
        </div>
      </div>
    </section>
  )
}
