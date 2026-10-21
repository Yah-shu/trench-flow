/**
 * The Day page's settings (gear in the header): how much the AI does, when the day starts, the category rules, the
 * private apps/titles, screenshots and nudges. One Save for everything → PUT /api/day/settings with just those parts.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react'
import { getSettings, putSettings } from './api.ts'
import type { AiLevel, DaySettings, DaySummary, NudgeSettings, ShotSettings } from './types.ts'
import { rangeProblem } from './live.ts'
import { cleanRule, hourLabel, linesProblem, moveItem, parseLines, ruleProblems, toDraft, type RuleDraft } from './rules.ts'

const HOURS = Array.from({ length: 13 }, (_, h) => h)

/** What each level does, in the words the picker shows (server/day/service.ts LEVELS has the numbers). */
export const AI_LEVEL_TEXT: { id: AiLevel; name: string; what: string }[] = [
  { id: 'off', name: 'Off', what: 'No AI at all, free. Your rules, your labels and the local look-alike matcher sort the day; no card titles, summary, chat or standup.' },
  { id: 'low', name: 'Low', what: 'Window titles only, no screenshots. Cards named every 2 hours. About 10–20k Haiku tokens a day.' },
  { id: 'medium', name: 'Medium', what: 'Screenshots only for cards whose titles say too little. Cards named every hour. About 25–40k tokens a day.' },
  { id: 'high', name: 'High', what: 'Every card is read from 2–4 screenshots, which also sort what titles can’t. Cards named every 30 minutes. About 50–80k tokens a day.' },
]
const SHOTS_DEFAULT: ShotSettings = { enabled: false, everySeconds: 60, keepDays: 7 }
const NUDGES_DEFAULT: NudgeSettings = { enabled: false, afterMinutes: 15, quietMinutes: 30 }

/** Number boxes are edited as text so a half-typed value doesn't jump around. */
type Nums<T> = { [K in keyof T]: T[K] extends number ? string : T[K] }
const asText = <T extends object>(o: T): Nums<T> => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? String(v) : v])) as Nums<T>

const isBlank = (d: RuleDraft) => !d.categoryId && !d.app.trim() && !d.title.trim() && !d.domain.trim()

export function SettingsPanel({ day, sample, onSaved, onClose }: { day: DaySummary; sample: boolean; onSaved: () => void; onClose: () => void }) {
  const [loaded, setLoaded] = useState<DaySettings | null>(null)
  const [offline, setOffline] = useState(false)
  const [startHour, setStartHour] = useState(day.dayStartHour ?? 4)
  const [aiLevel, setAiLevel] = useState<AiLevel>('medium')
  const [rows, setRows] = useState<RuleDraft[]>([])
  const [privApps, setPrivApps] = useState('')
  const [privTitles, setPrivTitles] = useState('')
  const [problems, setProblems] = useState<(string | null)[]>([])
  const [privProblem, setPrivProblem] = useState<{ apps: string | null; titles: string | null }>({ apps: null, titles: null })
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [shots, setShots] = useState(asText(SHOTS_DEFAULT))
  const [nudges, setNudges] = useState(asText(NUDGES_DEFAULT))

  // Fill the form from what the server has.
  function seed(s: DaySettings) {
    setLoaded(s)
    setStartHour(s.dayStartHour ?? 4)
    setAiLevel(s.aiLevel ?? 'medium')
    setRows((s.rules ?? []).map((r) => toDraft(r)))
    setPrivApps((s.private?.apps ?? []).join('\n'))
    setPrivTitles((s.private?.titles ?? []).join('\n'))
    setShots(asText({ ...SHOTS_DEFAULT, ...s.screenshots }))
    setNudges(asText({ ...NUDGES_DEFAULT, ...s.nudges }))
    setProblems([])
  }

  useEffect(() => {
    let alive = true
    getSettings()
      .then((s) => alive && seed(s))
      .catch(() => alive && setOffline(true))
    return () => {
      alive = false
    }
  }, [])

  const edit = (key: number, patch: Partial<RuleDraft>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
    setNote(null)
  }
  const move = (i: number, dir: -1 | 1) => {
    setRows((rs) => moveItem(rs, i, dir))
    setProblems((ps) => moveItem(ps, i, dir))
  }
  const remove = (i: number) => {
    setRows((rs) => rs.filter((_, j) => j !== i))
    setProblems((ps) => ps.filter((_, j) => j !== i))
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNote(null)
    // Rows left completely empty are just dropped; anything half-filled must be fixed first.
    const kept = rows.filter((r) => !isBlank(r))
    const ps = ruleProblems(kept, new Set(day.categories.map((c) => c.id)))
    const pp = { apps: linesProblem(privApps), titles: linesProblem(privTitles) }
    setRows(kept)
    setProblems(ps)
    setPrivProblem(pp)
    const bad = ps.findIndex(Boolean)
    if (bad >= 0) return setError(`Rule ${bad + 1} needs a fix before saving.`)
    if (pp.apps || pp.titles) return setError('A private pattern needs a fix before saving.')
    const screenshots = { enabled: shots.enabled, everySeconds: Number(shots.everySeconds), keepDays: Number(shots.keepDays) }
    const nudge = { enabled: nudges.enabled, afterMinutes: Number(nudges.afterMinutes), quietMinutes: Number(nudges.quietMinutes) }
    const range =
      rangeProblem('Screenshot every … seconds', screenshots.everySeconds, 15, 600) ??
      rangeProblem('Keep screenshots for … days', screenshots.keepDays, 1, 60) ??
      rangeProblem('Nudge after … minutes', nudge.afterMinutes, 5, 240) ??
      rangeProblem('Stay quiet for … minutes', nudge.quietMinutes, 5, 480)
    if (range) return setError(range)
    setBusy(true)
    try {
      const s = await putSettings({
        dayStartHour: startHour,
        ...(loaded?.aiLevel ? { aiLevel } : {}),
        rules: kept.map(cleanRule),
        private: { apps: parseLines(privApps), titles: parseLines(privTitles) },
        screenshots,
        nudges: nudge,
      })
      seed(s)
      setNote('Saved. The day is being re-sorted with the new settings.')
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const canSave = !!loaded && !busy

  return (
    <section className="pl-press day-settings" id="day-settings">
      <form className="pl-panel" onSubmit={save}>
        <div className="pl-panel__head">
          <span className="pl-panel__title">Settings</span>
          <button type="button" className="pl-iconbtn is-quiet" onClick={onClose} aria-label="Close settings" title="Close">
            <X size={16} />
          </button>
        </div>
        <div className="pl-panel__body day-set">
          {offline && (
            <p className="day-note day-set__offline">
              {sample ? 'Showing sample data — ' : ''}The tracker server isn’t answering, so settings can’t be loaded or saved yet.
            </p>
          )}

          <div className="day-set__section">
            <h3 className="day-set__h">AI level</h3>
            <div className="day-levels" role="radiogroup" aria-label="AI level">
              {AI_LEVEL_TEXT.map((lv) => (
                <label key={lv.id} className={`day-level ${aiLevel === lv.id ? 'is-on' : ''}`}>
                  <input type="radio" name="ai-level" value={lv.id} checked={aiLevel === lv.id} onChange={() => setAiLevel(lv.id)} disabled={!loaded?.aiLevel} />
                  <span className="day-level__name">{lv.name}</span>
                  <span className="day-muted day-level__what">{lv.what}</span>
                </label>
              ))}
            </div>
            <p className="day-muted day-set__help">AI runs on your own Claude plan (Haiku, the smallest model) and stops by itself when your weekly usage is nearly used up.</p>
          </div>

          <div className="day-set__section">
            <h3 className="day-set__h">Day starts at</h3>
            <label className="day-set__inline">
              <select className="studio-select" value={startHour} onChange={(e) => setStartHour(Number(e.target.value))} aria-label="Day starts at" disabled={!loaded}>
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
              <span className="day-muted">
                {startHour === 0 ? 'Days split at midnight.' : `Late nights count to the previous day: anything before ${hourLabel(startHour)} belongs to the day before.`}
              </span>
            </label>
          </div>

          <div className="day-set__section">
            <h3 className="day-set__h">Rules</h3>
            <p className="day-muted day-set__help">
              Rules put windows into a category. Rules are checked top to bottom; the first match wins. Each box is a pattern (capitals don’t matter) — fill in at least one. Use <code>|</code> for “or”, e.g. <code>netflix|hulu</code>; a dot in a website needs a backslash, e.g. <code>tiktok\.com</code>.
            </p>
            {rows.length > 0 && (
              <div className="day-rules__head" aria-hidden="true">
                <span>Category</span>
                <span>App</span>
                <span>Window title</span>
                <span>Website</span>
              </div>
            )}
            <ol className="day-rules">
              {rows.map((r, i) => {
                const problem = problems[i]
                const n = i + 1
                return (
                  <li key={r.key} className={`day-rule ${problem ? 'is-bad' : ''}`}>
                    <div className="day-rule__row">
                      <select className="studio-select" value={r.categoryId} onChange={(e) => edit(r.key, { categoryId: e.target.value })} aria-label={`Rule ${n}: category`} aria-invalid={problem ? true : undefined}>
                        <option value="">Pick a category…</option>
                        {day.categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                        {r.categoryId && !day.categories.some((c) => c.id === r.categoryId) && <option value={r.categoryId}>{r.categoryId}</option>}
                      </select>
                      <input className="studio-input" value={r.app} onChange={(e) => edit(r.key, { app: e.target.value })} placeholder="chrome" aria-label={`Rule ${n}: app`} aria-invalid={problem ? true : undefined} />
                      <input className="studio-input" value={r.title} onChange={(e) => edit(r.key, { title: e.target.value })} placeholder="youtube" aria-label={`Rule ${n}: window title`} aria-invalid={problem ? true : undefined} />
                      <input className="studio-input" value={r.domain} onChange={(e) => edit(r.key, { domain: e.target.value })} placeholder="tiktok\.com" aria-label={`Rule ${n}: website`} aria-invalid={problem ? true : undefined} />
                      <span className="day-rule__tools">
                        <button type="button" className="pl-iconbtn is-quiet" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move rule ${n} up`} title="Move up">
                          <ArrowUp size={14} />
                        </button>
                        <button type="button" className="pl-iconbtn is-quiet" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label={`Move rule ${n} down`} title="Move down">
                          <ArrowDown size={14} />
                        </button>
                        <button type="button" className="pl-iconbtn is-quiet" onClick={() => remove(i)} aria-label={`Delete rule ${n}`} title="Delete">
                          <Trash2 size={14} />
                        </button>
                      </span>
                    </div>
                    {problem && <p className="day-edit__error">Rule {n}: {problem}</p>}
                  </li>
                )
              })}
            </ol>
            {rows.length === 0 && <p className="day-muted">No rules yet — the AI sorts everything on its own.</p>}
            <div>
              <button type="button" className="plinth-btn plinth-btn--xs plinth-btn--ghost" onClick={() => setRows((rs) => [...rs, toDraft()])} disabled={!loaded}>
                <span className="plinth-btn__face">
                  <Plus className="plinth-btn__icon" />
                  <span className="plinth-btn__label">Add rule</span>
                </span>
              </button>
            </div>
          </div>

          <div className="day-set__section">
            <h3 className="day-set__h">Private</h3>
            <p className="day-muted day-set__help">These never leave this computer: their titles are hidden from the AI and replaced with “private”. One pattern per line.</p>
            <div className="day-set__two">
              <label className="day-edit__field">
                <span>Apps</span>
                <textarea className="studio-input day-set__area" value={privApps} onChange={(e) => setPrivApps(e.target.value)} placeholder={'keepass\nsignal'} rows={4} aria-invalid={privProblem.apps ? true : undefined} disabled={!loaded} />
                {privProblem.apps && <span className="day-edit__error">{privProblem.apps}</span>}
              </label>
              <label className="day-edit__field">
                <span>Window titles</span>
                <textarea className="studio-input day-set__area" value={privTitles} onChange={(e) => setPrivTitles(e.target.value)} placeholder={'bank\npassword'} rows={4} aria-invalid={privProblem.titles ? true : undefined} disabled={!loaded} />
                {privProblem.titles && <span className="day-edit__error">{privProblem.titles}</span>}
              </label>
            </div>
          </div>

          <div className="day-set__section">
            <h3 className="day-set__h">Screenshots</h3>
            <label className="day-set__check">
              <input type="checkbox" checked={shots.enabled} onChange={(e) => setShots({ ...shots, enabled: e.target.checked })} disabled={!loaded} />
              <span>
                Take a small screenshot of the window in front every{' '}
                <input
                  className="studio-input day-set__num"
                  type="number"
                  min={15}
                  max={600}
                  step={5}
                  value={shots.everySeconds}
                  onChange={(e) => setShots({ ...shots, everySeconds: e.target.value })}
                  aria-label="Screenshot every … seconds"
                  disabled={!loaded}
                />{' '}
                seconds
              </span>
            </label>
            <p className="day-muted day-set__help">
              Kept on this computer for{' '}
              <input
                className="studio-input day-set__num"
                type="number"
                min={1}
                max={60}
                value={shots.keepDays}
                onChange={(e) => setShots({ ...shots, keepDays: e.target.value })}
                aria-label="Keep screenshots for … days"
                disabled={!loaded}
              />{' '}
              days. How many the AI looks at depends on the AI level; nothing is taken while you’re away or in private apps.
            </p>
          </div>

          <div className="day-set__section">
            <h3 className="day-set__h">Nudges</h3>
            <label className="day-set__check">
              <input type="checkbox" checked={nudges.enabled} onChange={(e) => setNudges({ ...nudges, enabled: e.target.checked })} disabled={!loaded} />
              <span>Nudge me when I drift off</span>
            </label>
            <div className="day-set__inline">
              <span>
                after{' '}
                <input
                  className="studio-input day-set__num"
                  type="number"
                  min={5}
                  max={240}
                  value={nudges.afterMinutes}
                  onChange={(e) => setNudges({ ...nudges, afterMinutes: e.target.value })}
                  aria-label="Nudge after … minutes"
                  disabled={!loaded}
                />{' '}
                minutes of distraction in a row,
              </span>
              <span>
                then stay quiet for{' '}
                <input
                  className="studio-input day-set__num"
                  type="number"
                  min={5}
                  max={480}
                  value={nudges.quietMinutes}
                  onChange={(e) => setNudges({ ...nudges, quietMinutes: e.target.value })}
                  aria-label="Stay quiet for … minutes"
                  disabled={!loaded}
                />{' '}
                minutes
              </span>
            </div>
            <p className="day-muted day-set__help">A desktop notification (Windows or macOS). Works from window titles only.</p>
          </div>

          <div className="day-set__actions">
            <button type="submit" className="plinth-btn plinth-btn--sm" disabled={!canSave}>
              <span className="plinth-btn__face">
                <span className="plinth-btn__label">{busy ? 'Saving…' : 'Save settings'}</span>
              </span>
            </button>
            <button type="button" className="plinth-btn plinth-btn--sm plinth-btn--ghost" onClick={onClose}>
              <span className="plinth-btn__face">
                <span className="plinth-btn__label">Close</span>
              </span>
            </button>
            {note && <span className="day-muted">{note}</span>}
          </div>
          {error && <p className="day-edit__error">{error}</p>}
        </div>
      </form>
    </section>
  )
}
