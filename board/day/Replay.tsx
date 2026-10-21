/**
 * "Replay (N shots)" inside an opened timeline card: the card's screenshots as a flip-book.
 * Shots are fetched when the card opens; no shots → no button. Esc closes, arrows step.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react'
import { getShots, shotUrl } from './api.ts'
import type { DayShot } from './types.ts'
import { fmtClock } from './format.ts'
import { clampIndex, preloadAhead } from './live.ts'

const FLIP_MS = 333 // ~3 shots a second

function Viewer({ shots, title, onClose }: { shots: DayShot[]; title: string; onClose: () => void }) {
  const [i, setI] = useState(0)
  const [playing, setPlaying] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const n = shots.length
  const shot = shots[clampIndex(i, n)]!

  useEffect(() => {
    box.current?.focus()
  }, [])

  // Play flips forward and stops on the last shot.
  useEffect(() => {
    if (!playing) return
    const t = window.setInterval(() => {
      setI((v) => {
        if (v >= n - 1) {
          setPlaying(false)
          return v
        }
        return v + 1
      })
    }, FLIP_MS)
    return () => window.clearInterval(t)
  }, [playing, n])

  // Warm the browser cache for the next couple of shots.
  useEffect(() => {
    for (const k of preloadAhead(i, n)) new Image().src = shotUrl(shots[k]!.file)
  }, [i, n, shots])

  const step = (dir: -1 | 1) => {
    setPlaying(false)
    setI((v) => clampIndex(v + dir, n))
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      step(-1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      step(1)
    } else if (e.key === ' ' && (e.target as HTMLElement).tagName !== 'BUTTON') {
      e.preventDefault()
      setPlaying((p) => !p)
    }
  }

  return (
    <div className="day-replay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="day-replay__box pl-panel" role="dialog" aria-modal="true" aria-label={`Replay: ${title}`} tabIndex={-1} ref={box} onKeyDown={onKey}>
        <div className="pl-panel__head">
          <span className="pl-panel__title day-replay__title">Replay · {title}</span>
          <button type="button" className="pl-iconbtn is-quiet" onClick={onClose} aria-label="Close replay" title="Close (Esc)">
            <X size={16} />
          </button>
        </div>
        <div className="day-replay__stage">
          <img src={shotUrl(shot.file)} alt={`Screenshot at ${fmtClock(shot.t)}: ${shot.app} — ${shot.title}`} loading="lazy" decoding="async" />
        </div>
        <div className="day-replay__controls">
          <button type="button" className="pl-iconbtn" onClick={() => step(-1)} disabled={i <= 0} aria-label="Previous shot" title="Previous (←)">
            <ChevronLeft size={18} />
          </button>
          <button type="button" className="pl-iconbtn" onClick={() => (i >= n - 1 && !playing ? (setI(0), setPlaying(true)) : setPlaying((p) => !p))} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button type="button" className="pl-iconbtn" onClick={() => step(1)} disabled={i >= n - 1} aria-label="Next shot" title="Next (→)">
            <ChevronRight size={18} />
          </button>
          <input
            className="day-replay__scrub"
            type="range"
            min={0}
            max={Math.max(0, n - 1)}
            value={clampIndex(i, n)}
            onChange={(e) => {
              setPlaying(false)
              setI(clampIndex(Number(e.target.value), n))
            }}
            aria-label="Pick a shot"
          />
          <span className="day-muted day-replay__count">
            {clampIndex(i, n) + 1} / {n}
          </span>
        </div>
        <p className="day-replay__cap">
          <b>{fmtClock(shot.t)}</b> · {shot.app}
          <span className="day-replay__wt" title={shot.title}>
            {shot.title}
          </span>
        </p>
      </div>
    </div>
  )
}

export function Replay({ date, start, end, title }: { date: string; start: string; end: string; title: string }) {
  const [shots, setShots] = useState<DayShot[]>([])
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    let alive = true
    getShots(date, start, end).then((s) => alive && setShots(s))
    return () => {
      alive = false
    }
  }, [date, start, end])
  if (shots.length === 0) return null
  return (
    <>
      <button type="button" ref={btn} className="plinth-btn plinth-btn--xs plinth-btn--ghost" onClick={() => setOpen(true)}>
        <span className="plinth-btn__face">
          <Play className="plinth-btn__icon" />
          <span className="plinth-btn__label">
            Replay ({shots.length} {shots.length === 1 ? 'shot' : 'shots'})
          </span>
        </span>
      </button>
      {open && (
        <Viewer
          shots={shots}
          title={title}
          onClose={() => {
            setOpen(false)
            btn.current?.focus()
          }}
        />
      )}
    </>
  )
}
