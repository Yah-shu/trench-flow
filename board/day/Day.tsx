/**
 * #/day — a Dayflow-style view of the day: targets, the day ring, standup, the AI summary, a chat
 * about the day, the timeline (with screenshot replay), top apps, devices and the last 7 days; a
 * right-now banner while a distraction run is going on today. Data from /api/day (server/day/); sample data when the
 * API isn't answering.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Laptop, Monitor, Pencil, RefreshCw, Settings, Smartphone, X } from 'lucide-react'
import './day.css'
import { getSettings, getStreak, getSummary, getWeek, postCard, postLabel, putTargets, refreshSummary } from './api.ts'
import type { CardRating, DayCategory, DayDevice, DaySettings, DayStreak, DaySummary, TimelineItem, WeekDay } from './types.ts'
import { howLabel } from './rules.ts'
import { SettingsPanel } from './SettingsPanel.tsx'
import { Replay } from './Replay.tsx'
import { ChatPanel } from './Chat.tsx'
import { StandupPanel } from './Standup.tsx'
import { streakText } from './live.ts'
import {
  DISTRACTION_COLOR,
  NEUTRAL_COLOR,
  arcPath,
  awaitingAiTitle,
  colorOf,
  dayLabel,
  distractionChip,
  fmtClock,
  fmtHours,
  fmtLong,
  fmtShort,
  todayDate,
  minutesBetween,
  ringArcs,
  shiftDate,
  targetFill,
  weekdayShort,
} from './format.ts'

const POLL_MS = 5 * 60 * 1000
const STREAK_POLL_MS = 60 * 1000
const STREAK_DISMISSED = 'day.streakDismissed'

/* ---------- right now (today only) ---------- */

/** A slim banner while a distraction run is going on; dismissing hides it until the next run. */
function StreakBanner() {
  const [streak, setStreak] = useState<DayStreak | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(STREAK_DISMISSED)
    } catch {
      return null
    }
  })
  useEffect(() => {
    let alive = true
    const tick = () => {
      if (document.visibilityState === 'visible') getStreak().then((s) => alive && setStreak(s))
    }
    tick()
    const t = window.setInterval(tick, STREAK_POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      alive = false
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])
  const text = streakText(streak)
  if (!text || !streak || dismissed === streak.since) return null
  const dismiss = () => {
    setDismissed(streak.since)
    try {
      sessionStorage.setItem(STREAK_DISMISSED, streak.since)
    } catch {
      /* private mode: just this page view then */
    }
  }
  return (
    <div className="day-streak" role="status">
      <span className="day-streak__dot" aria-hidden="true" />
      <span className="day-streak__text">{text}</span>
      <button type="button" className="pl-iconbtn is-quiet day-streak__x" onClick={dismiss} aria-label="Hide until the next distraction run" title="Hide">
        <X size={14} />
      </button>
    </div>
  )
}

/* ---------- targets ---------- */

function FocusBar({ day }: { day: DaySummary }) {
  const focusCats = day.categories.filter((c) => c.kind === 'focus' && c.minutes > 0)
  const target = day.targets.focusHours * 60
  const f = targetFill(day.totals.focusMinutes, target)
  return (
    <div className="day-target">
      <div className="day-target__head">
        <span className="day-target__name">Focus</span>
        <span className="day-target__value">
          <b>{fmtHours(day.totals.focusMinutes)}</b> / {fmtHours(target)} hr {f.ratio >= 1 ? 'fulfilled' : ''}
          {f.over && <span className="pl-badge pl-badge--ok">{Math.round(f.ratio * 100)}%</span>}
        </span>
      </div>
      <div className="day-bar" role="img" aria-label={`Focus ${fmtShort(day.totals.focusMinutes)} of a ${fmtShort(target)} target`}>
        <div className="day-bar__fill" style={{ width: `${f.fill * 100}%` }}>
          {focusCats.map((c) => (
            <span key={c.id} className="day-bar__seg" style={{ flexGrow: c.minutes, background: colorOf(c.color) }} title={`${c.name}: ${fmtShort(c.minutes)}`} />
          ))}
        </div>
        {f.over && <span className="day-bar__marker" style={{ left: `${f.marker * 100}%` }} title={`Target ${fmtShort(target)}`} />}
      </div>
      <ul className="day-legend">
        {focusCats.map((c) => (
          <li key={c.id}>
            <span className="day-swatch" style={{ background: colorOf(c.color) }} />
            {c.name} <span className="day-legend__min">{fmtShort(c.minutes)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function DistractionBar({ day }: { day: DaySummary }) {
  const budget = day.targets.distractionBudgetMinutes
  const used = day.totals.distractionMinutes
  const f = targetFill(used, budget)
  return (
    <div className="day-target">
      <div className="day-target__head">
        <span className="day-target__name">Distraction budget</span>
        <span className="day-target__value">
          <b>{fmtShort(used)}</b> / {fmtShort(budget)}
          {f.over && <span className="pl-badge pl-badge--bad">over by {fmtShort(used - budget)}</span>}
        </span>
      </div>
      <div className="day-bar" role="img" aria-label={`Distractions ${fmtShort(used)} of a ${fmtShort(budget)} budget`}>
        <div className="day-bar__fill" style={{ width: `${f.fill * 100}%` }}>
          <span className="day-bar__seg" style={{ flexGrow: 1, background: DISTRACTION_COLOR }} />
        </div>
        {f.over && <span className="day-bar__marker" style={{ left: `${f.marker * 100}%` }} title={`Budget ${fmtShort(budget)}`} />}
      </div>
    </div>
  )
}

function TargetsEditor({ day, onSaved, onClose }: { day: DaySummary; onSaved: () => void; onClose: () => void }) {
  const [settings, setSettings] = useState<DaySettings | null>(null)
  const [hours, setHours] = useState(String(day.targets.focusHours))
  const [budget, setBudget] = useState(String(day.targets.distractionBudgetMinutes))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    getSettings()
      .then((s) => {
        setSettings(s)
        setHours(String(s.targets.focusHours))
        setBudget(String(s.targets.distractionBudgetMinutes))
      })
      .catch(() => setError('The tracker server isn’t answering, so targets can’t be saved yet.'))
  }, [])
  async function save(e: FormEvent) {
    e.preventDefault()
    const h = Number(hours)
    const b = Number(budget)
    if (!(h > 0 && h <= 24) || !(b >= 0 && b <= 1440)) return setError('Focus 0.5–24 hours, budget 0–1440 minutes.')
    setBusy(true)
    try {
      await putTargets({ focusHours: h, distractionBudgetMinutes: Math.round(b) }, settings)
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="day-edit" onSubmit={save}>
      <label className="day-edit__field">
        <span>Focus hours a day</span>
        <input className="studio-input" type="number" min={0.5} max={24} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} />
      </label>
      <label className="day-edit__field">
        <span>Distraction budget (minutes)</span>
        <input className="studio-input" type="number" min={0} max={1440} step={5} value={budget} onChange={(e) => setBudget(e.target.value)} />
      </label>
      <div className="day-edit__actions">
        <button type="submit" className="plinth-btn plinth-btn--sm" disabled={busy}>
          <span className="plinth-btn__face">
            <span className="plinth-btn__label">{busy ? 'Saving…' : 'Save'}</span>
          </span>
        </button>
        <button type="button" className="plinth-btn plinth-btn--sm plinth-btn--ghost" onClick={onClose}>
          <span className="plinth-btn__face">
            <span className="plinth-btn__label">Cancel</span>
          </span>
        </button>
      </div>
      {error && <p className="day-edit__error">{error}</p>}
    </form>
  )
}

function Targets({ day, sample, onSaved }: { day: DaySummary; sample: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  return (
    <section className="pl-press day-targets">
      <div className="pl-panel">
        <div className="pl-panel__head">
          <span className="pl-panel__title">Today’s targets</span>
          <button type="button" className="pl-iconbtn is-quiet" onClick={() => setEditing((v) => !v)} aria-label={editing ? 'Close target settings' : 'Edit targets'} title={editing ? 'Close' : 'Edit targets'}>
            {editing ? <X size={16} /> : <Pencil size={16} />}
          </button>
        </div>
        <div className="pl-panel__body day-targets__body">
          {editing && <TargetsEditor day={day} onSaved={onSaved} onClose={() => setEditing(false)} />}
          {editing && sample && <p className="day-muted">Showing sample data — saving works once the tracker server is running.</p>}
          <FocusBar day={day} />
          <DistractionBar day={day} />
        </div>
      </div>
    </section>
  )
}

/* ---------- the ring ---------- */

export interface RingSlice {
  id: string
  label: string
  minutes: number
  color: string
}

/** Focus categories one by one, then distractions and neutral time as one slice each. */
export function ringSlices(categories: DayCategory[]): RingSlice[] {
  const focus = categories.filter((c) => c.kind === 'focus' && c.minutes > 0).map((c) => ({ id: c.id, label: c.name, minutes: c.minutes, color: colorOf(c.color) }))
  const dist = categories.filter((c) => c.kind === 'distraction').reduce((s, c) => s + c.minutes, 0)
  const neut = categories.filter((c) => c.kind === 'neutral').reduce((s, c) => s + c.minutes, 0)
  return [
    ...focus,
    ...(dist > 0 ? [{ id: '_distraction', label: 'Distractions', minutes: dist, color: DISTRACTION_COLOR }] : []),
    ...(neut > 0 ? [{ id: '_neutral', label: 'Comms, personal & other', minutes: neut, color: NEUTRAL_COLOR }] : []),
  ]
}

function Ring({ day }: { day: DaySummary }) {
  const slices = ringSlices(day.categories)
  const arcs = ringArcs(slices.map((s) => s.minutes), 7)
  const [hover, setHover] = useState<string | null>(null)
  const hovered = slices.find((s) => s.id === hover)
  const total = day.totals.activeMinutes
  const S = 240
  const R = 96
  return (
    <section className="pl-press day-ring">
      <div className="pl-panel">
        <div className="pl-panel__head">
          <span className="pl-panel__title">Your day so far</span>
          <span className="day-muted">{day.totals.contextSwitches} switches</span>
        </div>
        <div className="pl-panel__body day-ring__body">
          <div className="day-ring__chart">
            <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label={`Total ${fmtLong(total)}. ${slices.map((s) => `${s.label} ${fmtShort(s.minutes)}`).join(', ')}`}>
              <circle cx={S / 2} cy={S / 2} r={R} fill="none" stroke="var(--pl-paper-deep)" strokeWidth={30} />
              {slices.map((s, i) => {
                const a = arcs[i]
                if (!a) return null
                return (
                  <path
                    key={s.id}
                    d={arcPath(S / 2, R, a)}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={hover === s.id ? 34 : 30}
                    strokeLinecap="round"
                    onMouseEnter={() => setHover(s.id)}
                    onMouseLeave={() => setHover(null)}
                  >
                    <title>{`${s.label}: ${fmtShort(s.minutes)}`}</title>
                  </path>
                )
              })}
            </svg>
            <div className="day-ring__center" aria-hidden="true">
              {hovered ? (
                <>
                  <span className="day-ring__eyebrow">{hovered.label}</span>
                  <span className="day-ring__total">{fmtShort(hovered.minutes)}</span>
                </>
              ) : (
                <>
                  <span className="day-ring__eyebrow">Total</span>
                  <span className="day-ring__total">{fmtLong(total)}</span>
                </>
              )}
            </div>
          </div>
          <ul className="day-legend day-legend--col">
            {slices.map((s) => (
              <li key={s.id} onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover(null)} className={hover === s.id ? 'is-hover' : ''}>
                <span className="day-swatch" style={{ background: s.color }} />
                {s.label} <span className="day-legend__min">{fmtShort(s.minutes)}</span>
              </li>
            ))}
            {!slices.length && <li className="day-muted">Nothing tracked yet.</li>}
          </ul>
        </div>
      </div>
    </section>
  )
}

/* ---------- summary ---------- */

function SummaryPanel({ day, sample, onRefreshed }: { day: DaySummary; sample: boolean; onRefreshed: () => void }) {
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function refresh() {
    setBusy(true)
    setNote(null)
    const r = await refreshSummary(day.date)
    setBusy(false)
    if (r.ok) {
      setNote('Writing a new summary…')
      window.setTimeout(onRefreshed, 20_000)
    } else if ('retryAfterSeconds' in r) {
      const m = Math.ceil(r.retryAfterSeconds / 60)
      setNote(`Just refreshed — try again in ${r.retryAfterSeconds < 60 ? `${r.retryAfterSeconds}s` : `${m} min`}.`)
    } else {
      setNote(sample ? 'Refresh works once the tracker server is running.' : `Couldn’t refresh: ${r.error}`)
    }
  }
  const s = day.summary
  const status = day.summaryStatus
  return (
    <section className="pl-press day-summary">
      <div className="pl-panel">
        <div className="pl-panel__head">
          <span className="pl-panel__title">Summary</span>
          <span className="day-summary__tools">
            {status === 'stale' && <span className="pl-badge pl-badge--quiet">out of date</span>}
            {status === 'running' && <span className="pl-badge pl-badge--info">writing…</span>}
            {status === 'error' && <span className="pl-badge pl-badge--bad">failed</span>}
            <button type="button" className="plinth-btn plinth-btn--xs plinth-btn--ghost" onClick={refresh} disabled={busy || status === 'running'}>
              <span className="plinth-btn__face">
                <RefreshCw className="plinth-btn__icon" />
                <span className="plinth-btn__label">Refresh</span>
              </span>
            </button>
          </span>
        </div>
        <div className="pl-panel__body">
          {s ? (
            <>
              <p className="day-summary__text">{s.text}</p>
              {s.highlights.length > 0 && (
                <ul className="day-summary__hl">
                  {s.highlights.slice(0, 3).map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              )}
              {s.biggestTimeSink && (
                <p className="day-summary__sink">
                  Biggest time sink: <b>{s.biggestTimeSink.label}</b> · {fmtShort(s.biggestTimeSink.minutes)}
                </p>
              )}
            </>
          ) : status === 'skipped-usage-cap' ? (
            <p className="day-muted">Skipped to save your Claude usage.</p>
          ) : status === 'running' ? (
            <p className="day-muted">Writing the summary…</p>
          ) : status === 'error' ? (
            <p className="day-muted">The summary didn’t work this time. Press Refresh to try again.</p>
          ) : (
            <p className="day-muted">The summary is written when your day ends (or press Refresh). Cards get AI titles every couple of hours.</p>
          )}
          {note && <p className="day-note">{note}</p>}
          {s && day.summaryUpdatedAt && <p className="day-muted day-summary__when">Written {fmtClock(day.summaryUpdatedAt)}</p>}
        </div>
      </div>
    </section>
  )
}

/* ---------- timeline, apps, devices, week ---------- */

const RATINGS: { id: CardRating; label: string }[] = [
  { id: 'focused', label: 'Focused' },
  { id: 'neutral', label: 'Neutral' },
  { id: 'distracted', label: 'Distracted' },
]

/** One card opened up: rate it, pin its category, and re-file the windows inside it. */
function CardDetail({ day, item, onChanged }: { day: DaySummary; item: TimelineItem; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cat = new Map(day.categories.map((c) => [c.id, c]))
  const windows = item.windows ?? []
  const distractions = item.distractions ?? []
  const log = item.log ?? []

  async function write(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="day-tl__detail">
      <div className="day-tl__controls">
        <div className="day-rate" role="group" aria-label="How did this go?">
          {RATINGS.map((r) => {
            const on = item.rating === r.id
            return (
              <button
                key={r.id}
                type="button"
                className={`plinth-btn plinth-btn--xs ${on ? 'plinth-btn--ink' : 'plinth-btn--ghost'}`}
                aria-pressed={on}
                disabled={busy}
                onClick={() => void write(() => postCard(day.date, item.id, { rating: on ? null : r.id }))}
              >
                <span className="plinth-btn__face">
                  <span className="plinth-btn__label">{r.label}</span>
                </span>
              </button>
            )
          })}
        </div>
        <label className="day-tl__cat">
          <span>Category</span>
          <select
            className="studio-select"
            value={item.categoryLocked ? item.categoryId : ''}
            disabled={busy}
            onChange={(e) => void write(() => postCard(day.date, item.id, { categoryId: e.target.value || null }))}
          >
            <option value="">Auto ({cat.get(item.autoCategoryId ?? item.categoryId)?.name ?? 'Other'})</option>
            {day.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {item.categoryLocked && <span className="pl-badge pl-badge--info">set by you</span>}
        </label>
        <Replay date={day.date} start={item.start} end={item.end} title={item.title} />
      </div>

      {distractions.length > 0 && (
        <div className="day-mini">
          <span className="day-mini__h">Distractions</span>
          <ul className="day-mini__list">
            {distractions.map((d, i) => (
              <li key={i}>
                <span className="day-mini__text" title={d.label}>
                  {d.label}
                </span>
                <span className="day-mini__min">{fmtShort(d.minutes)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {log.length > 0 && (
        <div className="day-mini">
          <span className="day-mini__h">Timeline</span>
          <ol className="day-mini__list day-mini__list--log">
            {log.map((l, i) => (
              <li key={i}>
                <span className="day-mini__at">{fmtClock(l.at)}</span>
                <span className="day-mini__text" title={l.text}>
                  {l.text}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {windows.length > 0 ? (
        <ul className="day-win">
          {windows.map((w) => {
            const hint = howLabel(w.how)
            return (
              <li key={`${w.app}|${w.title}`} className="day-win__item">
                <span className="day-win__main">
                  <span className="day-win__app">{w.app}</span>
                  <span className="day-win__title" title={w.title}>
                    {w.title}
                  </span>
                  {w.domain && <span className="day-win__domain">{w.domain}</span>}
                </span>
                <span className="day-win__min">{fmtShort(w.minutes)}</span>
                {w.private ? (
                  <span className="day-win__cat day-muted" title="A private window: its title stays on this computer, so it can’t be re-filed here.">
                    private
                  </span>
                ) : (
                  <span className="day-win__cat">
                    <select
                      className="studio-select"
                      value={w.categoryId}
                      disabled={busy}
                      aria-label={`Category for ${w.app}: ${w.title}`}
                      onChange={(e) => void write(() => postLabel(w.app, w.title, e.target.value))}
                    >
                      {!cat.has(w.categoryId) && <option value={w.categoryId}>{w.categoryId}</option>}
                      {day.categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    {hint && (
                      <span className="day-win__how" title={w.how === 'local' ? 'Filed like a similar window you labelled' : `Filed by ${hint === 'you' ? 'you' : `the ${hint}`}`}>
                        {hint}
                      </span>
                    )}
                    {w.how === 'you' && (
                      <button type="button" className="day-linkbtn" disabled={busy} onClick={() => void write(() => postLabel(w.app, w.title, null))}>
                        undo
                      </button>
                    )}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="day-muted">No window details for this block.</p>
      )}
      {windows.length > 0 && <p className="day-muted day-win__note">Changing a window’s category files it (and look-alikes that only differ by numbers) there from now on.</p>}
      {error && <p className="day-edit__error">{error}</p>}
    </div>
  )
}

function Timeline({ day, today, onChanged }: { day: DaySummary; today: string; onChanged: () => void }) {
  const cat = new Map(day.categories.map((c) => [c.id, c]))
  const dev = new Map(day.devices.map((d) => [d.id, d.name]))
  const items = [...day.timeline].sort((a, b) => b.start.localeCompare(a.start))
  const [open, setOpen] = useState<string | null>(null)
  return (
    <section className="pl-press day-timeline">
      <div className="pl-panel">
        <div className="pl-panel__head">
          <span className="pl-panel__title">Timeline</span>
          <span className="day-muted">{items.length} blocks</span>
        </div>
        <ol className="day-tl">
          {items.length === 0 && <li className="pl-empty">Tracking starts once the tracker is running on this device.</li>}
          {items.map((t, i) => {
            const c = cat.get(t.categoryId)
            const chip = distractionChip(t.distractions)
            const key = t.id ?? `${t.start}-${i}`
            const isOpen = open === key
            const detailId = `day-tl-${i}`
            return (
              <li key={key} className={`day-tl__item is-${c?.kind ?? 'neutral'} ${isOpen ? 'is-open' : ''}`}>
                <button type="button" className="day-tl__row" aria-expanded={isOpen} aria-controls={isOpen ? detailId : undefined} onClick={() => setOpen(isOpen ? null : key)}>
                  <span className="day-tl__time">
                    {fmtClock(t.start)}
                    <span>{fmtShort(minutesBetween(t.start, t.end))}</span>
                  </span>
                  <span className="day-tl__bar" style={{ background: c?.kind === 'neutral' ? NEUTRAL_COLOR : colorOf(c?.color) }} />
                  <span className="day-tl__main">
                    <span className="day-tl__title">{t.title}</span>
                    {t.summary && <span className="day-tl__sum">{t.summary}</span>}
                    {awaitingAiTitle(t, day.date, today) && <span className="day-tl__later">AI title later</span>}
                    <span className="day-tl__meta">
                      {c?.name ?? 'Other'} · {dev.get(t.device) ?? t.device}
                      {chip && <span className="day-tl__distracted">{chip}</span>}
                      {t.rating && <span className={`day-tl__rated is-${t.rating}`}>{RATINGS.find((r) => r.id === t.rating)?.label}</span>}
                    </span>
                  </span>
                  <ChevronDown size={16} className="day-tl__chev" aria-hidden="true" />
                </button>
                {isOpen && (
                  <div id={detailId}>
                    <CardDetail day={day} item={t} onChanged={onChanged} />
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      </div>
    </section>
  )
}

function TopApps({ day }: { day: DaySummary }) {
  const cat = new Map(day.categories.map((c) => [c.id, c]))
  const max = Math.max(1, ...day.topApps.map((a) => a.minutes))
  return (
    <section className="pl-press day-apps">
      <div className="pl-panel">
        <div className="pl-panel__head">
          <span className="pl-panel__title">Top apps</span>
        </div>
        <div className="pl-panel__body">
          {day.topApps.length === 0 && <p className="day-muted">No apps tracked yet.</p>}
          <ul className="day-apps__list">
            {day.topApps.slice(0, 6).map((a) => {
              const c = cat.get(a.categoryId)
              return (
                <li key={a.app} title={`${a.app}: ${fmtShort(a.minutes)} (${c?.name ?? 'Other'})`}>
                  <span className="day-apps__name">{a.app}</span>
                  <span className="day-apps__track">
                    <span style={{ width: `${(a.minutes / max) * 100}%`, background: c?.kind === 'neutral' ? NEUTRAL_COLOR : colorOf(c?.color) }} />
                  </span>
                  <span className="day-apps__min">{fmtShort(a.minutes)}</span>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </section>
  )
}

function DeviceChip({ d }: { d: DayDevice }) {
  const Icon = d.kind === 'mac' ? Laptop : d.kind === 'phone' ? Smartphone : Monitor
  const seen = d.lastSeen ? `last seen ${fmtClock(d.lastSeen)}` : 'never seen'
  return (
    <span className={`day-device ${d.online ? 'is-online' : ''}`} title={d.online ? `${d.name}: online` : `${d.name}: offline, ${seen}`}>
      <Icon size={14} />
      {d.name}
      <span className="day-device__dot" aria-hidden="true" />
      <span className="day-device__state">{d.online ? 'online' : 'offline'}</span>
      <span className="day-device__min">{fmtShort(d.activeMinutes)}</span>
    </span>
  )
}

function Week({ days, today, selected, focusTarget }: { days: WeekDay[]; today: string; selected: string; focusTarget: number }) {
  const max = Math.max(1, focusTarget, ...days.map((d) => d.focusMinutes + d.distractionMinutes))
  const H = 72
  return (
    <section className="pl-press day-week">
      <div className="pl-panel">
        <div className="pl-panel__head">
          <span className="pl-panel__title">Last 7 days</span>
          <span className="day-week__key">
            <span className="day-swatch" style={{ background: 'var(--pl-ink)' }} /> focus
            <span className="day-swatch" style={{ background: DISTRACTION_COLOR }} /> distraction
          </span>
        </div>
        <div className="pl-panel__body">
          <div className="day-week__cols" style={{ height: H + 34 }}>
            {days.map((d) => (
              <a
                key={d.date}
                href={`#/day/${d.date}`}
                className={`day-week__col ${d.date === selected ? 'is-on' : ''}`}
                title={`${dayLabel(d.date, today)}: focus ${fmtShort(d.focusMinutes)}, distraction ${fmtShort(d.distractionMinutes)}`}
                aria-label={`${dayLabel(d.date, today)}: focus ${fmtShort(d.focusMinutes)}, distraction ${fmtShort(d.distractionMinutes)}`}
              >
                <span className="day-week__stack" style={{ height: H }}>
                  <span className="day-week__target" style={{ bottom: `${(focusTarget / max) * 100}%` }} />
                  <span className="day-week__d" style={{ height: `${(d.distractionMinutes / max) * 100}%` }} />
                  <span className="day-week__f" style={{ height: `${(d.focusMinutes / max) * 100}%` }} />
                </span>
                <span className="day-week__h">{fmtHours(d.focusMinutes)}h</span>
                <span className="day-week__lbl">{weekdayShort(d.date)}</span>
              </a>
            ))}
          </div>
          <p className="day-muted day-week__note">Dashed line: the {fmtHours(focusTarget)} hr focus target.</p>
        </div>
      </div>
    </section>
  )
}

/* ---------- the page ---------- */

export function Day({ date: dateProp }: { date?: string }) {
  const today = todayDate()
  const date = dateProp && /^\d{4}-\d{2}-\d{2}$/.test(dateProp) ? dateProp : today
  const [day, setDay] = useState<DaySummary | null>(null)
  const [week, setWeek] = useState<WeekDay[]>([])
  const [sample, setSample] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const alive = useRef(true)

  const load = useCallback(async () => {
    const [s, w] = await Promise.all([getSummary(date), getWeek(date)])
    if (!alive.current) return
    setDay(s.data)
    setWeek(w.data)
    setSample(s.sample)
  }, [date])

  useEffect(() => {
    alive.current = true
    setDay(null)
    void load()
    const tick = () => {
      if (document.visibilityState === 'visible') void load()
    }
    const t = window.setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      alive.current = false
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [load])

  const go = (d: string) => {
    window.location.hash = d === today ? '#/day' : `#/day/${d}`
  }

  return (
    <div className="pl-page day">
      <header className="day-head">
        <div className="day-head__title">
          <span className="pl-eyebrow">Your day</span>
          <h1 className="day-h1">
            {dayLabel(date, today)}
            {sample && <span className="pl-badge pl-badge--warn day-sample">sample data</span>}
          </h1>
        </div>
        <div className="day-head__nav">
          <button type="button" className="pl-iconbtn" onClick={() => go(shiftDate(date, -1))} aria-label="Previous day" title="Previous day">
            <ChevronLeft size={18} />
          </button>
          <button type="button" className="plinth-btn plinth-btn--sm plinth-btn--ghost" onClick={() => go(today)} disabled={date === today}>
            <span className="plinth-btn__face">
              <span className="plinth-btn__label">Today</span>
            </span>
          </button>
          <button type="button" className="pl-iconbtn" onClick={() => go(shiftDate(date, 1))} disabled={date >= today} aria-label="Next day" title="Next day">
            <ChevronRight size={18} />
          </button>
          <button
            type="button"
            className="pl-iconbtn"
            onClick={() => setSettingsOpen((v) => !v)}
            aria-expanded={settingsOpen}
            aria-controls="day-settings"
            aria-label={settingsOpen ? 'Close settings' : 'Settings'}
            title={settingsOpen ? 'Close settings' : 'Settings'}
          >
            {settingsOpen ? <X size={18} /> : <Settings size={18} />}
          </button>
        </div>
      </header>

      {settingsOpen && day && <SettingsPanel day={day} sample={sample} onSaved={() => void load()} onClose={() => setSettingsOpen(false)} />}

      {day && (
        <div className="day-devices">
          {day.devices.map((d) => (
            <DeviceChip key={d.id} d={d} />
          ))}
          {day.devices.length === 0 && <span className="day-muted">Tracking starts once the tracker is running on this device.</span>}
        </div>
      )}

      {date === today && <StreakBanner />}

      {!day ? (
        <p className="pl-empty">Loading…</p>
      ) : (
        <div className="day-grid">
          <div className="day-col">
            <Targets day={day} sample={sample} onSaved={() => void load()} />
            <Ring day={day} />
            <Week days={week} today={today} selected={date} focusTarget={day.targets.focusHours * 60} />
          </div>
          <div className="day-col">
            <StandupPanel date={date} />
            <SummaryPanel day={day} sample={sample} onRefreshed={() => void load()} />
            <ChatPanel date={date} sample={sample} />
            <TopApps day={day} />
            <Timeline day={day} today={today} onChanged={() => void load()} />
          </div>
        </div>
      )}
    </div>
  )
}
