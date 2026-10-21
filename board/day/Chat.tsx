/** "Ask about your day": a small chat over the selected day (POST /api/day/chat). History lives here, per date. */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Send } from 'lucide-react'
import { ApiError, postChat } from './api.ts'
import type { ChatTurn } from './types.ts'
import { CHAT_MAX, aiErrorText, chatHistory } from './live.ts'

const SUGGESTIONS = ['Where did my time go?', 'When was I most focused?', 'What distracted me most?']

export function ChatPanel({ date, sample }: { date: string; sample: boolean }) {
  // One conversation per date, kept while the page is open.
  const [byDate, setByDate] = useState<Record<string, ChatTurn[]>>({})
  const [text, setText] = useState('')
  const [thinking, setThinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const list = useRef<HTMLOListElement>(null)
  const turns = byDate[date] ?? []

  useEffect(() => {
    setError(null)
  }, [date])
  useEffect(() => {
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns.length, thinking])

  async function ask(q: string) {
    const question = q.trim().slice(0, CHAT_MAX)
    if (!question || thinking) return
    const forDate = date
    const history = chatHistory(turns)
    setByDate((m) => ({ ...m, [forDate]: [...(m[forDate] ?? []), { role: 'you', text: question }] }))
    setText('')
    setError(null)
    setThinking(true)
    try {
      const answer = await postChat(forDate, question, history)
      setByDate((m) => ({ ...m, [forDate]: [...(m[forDate] ?? []), { role: 'day', text: answer || 'I don’t have an answer for that one.' }] }))
    } catch (e) {
      const err = e as ApiError
      setError(sample && !err.status ? 'Questions work once the tracker server is running.' : aiErrorText(err.status ?? 0, err.message, 'answer'))
    } finally {
      setThinking(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void ask(text)
  }
  // Enter sends; Shift+Enter makes a new line.
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void ask(text)
    }
  }

  return (
    <section className="pl-press day-chat">
      <div className="pl-panel">
        <div className="pl-panel__head">
          <span className="pl-panel__title">Ask about your day</span>
        </div>
        <div className="pl-panel__body day-chat__body">
          {turns.length === 0 && !thinking ? (
            <div className="day-chat__chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="plinth-btn plinth-btn--xs plinth-btn--ghost" onClick={() => void ask(s)}>
                  <span className="plinth-btn__face">
                    <span className="plinth-btn__label">{s}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <ol className="day-chat__list" ref={list} aria-live="polite">
              {turns.map((t, i) => (
                <li key={i} className={`day-chat__msg is-${t.role}`}>
                  <span className="day-chat__who">{t.role === 'you' ? 'You' : 'Your day'}</span>
                  <span className="day-chat__text">{t.text}</span>
                </li>
              ))}
              {thinking && <li className="day-chat__msg is-day is-thinking">thinking…</li>}
            </ol>
          )}
          <form className="day-chat__form" onSubmit={onSubmit}>
            <textarea
              className="studio-input day-chat__input"
              rows={1}
              value={text}
              maxLength={CHAT_MAX}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              placeholder="Ask anything about this day…"
              aria-label="Your question"
            />
            <button type="submit" className="plinth-btn plinth-btn--sm" disabled={thinking || !text.trim()}>
              <span className="plinth-btn__face">
                <Send className="plinth-btn__icon" />
                <span className="plinth-btn__label">Send</span>
              </span>
            </button>
          </form>
          {error && <p className="day-edit__error">{error}</p>}
        </div>
      </div>
    </section>
  )
}
