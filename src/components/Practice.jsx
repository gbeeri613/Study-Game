import { useEffect, useMemo, useState } from 'react'
import { applyFilters, buildSession, displayToOriginal, originalToDisplay } from '../lib/session.js'
import { courseLabel } from '../data/labels.js'

// Hebrew letter prefixes for options (א, ב, ג, ...)
const HEB_LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט', 'י']

export default function Practice({ db, dispatch, config, onExit }) {
  // Build the session ONCE (stable order + option permutations) from the
  // questions matching the filters at start time.
  const session = useMemo(() => {
    const matching = applyFilters(db.questions, config)
    return buildSession(matching, config)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [idx, setIdx] = useState(0)
  // reveal is per-question: null until the user picks. Stores the display slot
  // the user tapped this round.
  const [revealSlot, setRevealSlot] = useState(null)

  const item = session[idx]
  // Live question (state may have been updated by a prior answer this session).
  const liveQuestion = useMemo(() => {
    if (!item) return null
    return db.questions.find((q) => q.id === item.question.id) || item.question
  }, [db.questions, item])

  const atEnd = idx >= session.length - 1

  function goNext() {
    if (!atEnd) {
      setIdx((i) => i + 1)
      setRevealSlot(null)
    }
  }
  function goPrev() {
    if (idx > 0) {
      setIdx((i) => i - 1)
      setRevealSlot(null)
    }
  }

  function pick(displaySlot) {
    if (revealSlot !== null) return // already answered this round
    const originalIndex = displayToOriginal(item, displaySlot)
    const correct = originalIndex === liveQuestion.answer
    setRevealSlot(displaySlot)
    dispatch({ type: 'RECORD_ANSWER', id: liveQuestion.id, choice: originalIndex, correct })
  }

  // Keyboard: number keys pick an option; Enter/Space advance after reveal.
  useEffect(() => {
    function onKey(e) {
      if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return
      if (!item) return
      if (e.key >= '1' && e.key <= '9') {
        const slot = Number(e.key) - 1
        if (slot < liveQuestion.options.length) {
          e.preventDefault()
          pick(slot)
        }
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (revealSlot !== null) {
          e.preventDefault()
          goNext()
        }
      } else if (e.key === 'ArrowLeft') {
        // RTL: left arrow = next
        goNext()
      } else if (e.key === 'ArrowRight') {
        goPrev()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, revealSlot, liveQuestion, idx, atEnd])

  if (session.length === 0) {
    return (
      <div className="card">
        <p>אין שאלות תואמות לסינון.</p>
        <button className="btn" onClick={onExit}>חזרה</button>
      </div>
    )
  }

  const revealed = revealSlot !== null
  const chosenOriginal = revealed ? displayToOriginal(item, revealSlot) : null
  const correctDisplaySlot = originalToDisplay(item, liveQuestion.answer)
  const hasExpl =
    Array.isArray(liveQuestion.option_explanations) &&
    liveQuestion.option_explanations.length === liveQuestion.options.length

  return (
    <div className="practice">
      <div className="practice-header">
        <button className="btn btn-ghost" onClick={onExit}>← סיום</button>
        <span className="progress-pill">
          {idx + 1} / {session.length}
        </span>
      </div>

      <div className="card question-card">
        <div className="question-meta">
          {liveQuestion.course != null && <span className="chip">{courseLabel(liveQuestion.course)}</span>}
          {liveQuestion.unit != null && liveQuestion.unit !== '' && <span className="chip">יחידה {liveQuestion.unit}</span>}
          {liveQuestion.topic && <span className="chip chip-topic">{liveQuestion.topic}</span>}
          {liveQuestion.answered_at && (
            <span className={`chip ${liveQuestion.correct ? 'chip-ok' : 'chip-bad'}`}>
              {liveQuestion.correct ? 'נענתה נכון' : 'נענתה שגוי'}
            </span>
          )}
        </div>

        <h2 className="question-text">{liveQuestion.question}</h2>

        <ul className="options">
          {item.order.map((originalIndex, displaySlot) => {
            const text = liveQuestion.options[originalIndex]
            let cls = 'option'
            if (revealed) {
              if (originalIndex === liveQuestion.answer) cls += ' option-correct'
              else if (displaySlot === revealSlot) cls += ' option-wrong'
              else cls += ' option-dim'
            }
            return (
              <li key={originalIndex}>
                <button
                  className={cls}
                  onClick={() => pick(displaySlot)}
                  disabled={revealed}
                >
                  <span className="option-letter">{HEB_LETTERS[displaySlot] || displaySlot + 1}</span>
                  <span className="option-text">{text}</span>
                  {revealed && originalIndex === liveQuestion.answer && <span className="mark">✓</span>}
                  {revealed && displaySlot === revealSlot && originalIndex !== liveQuestion.answer && (
                    <span className="mark">✗</span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>

        {revealed && (
          <div className={`reveal ${chosenOriginal === liveQuestion.answer ? 'reveal-ok' : 'reveal-bad'}`}>
            <div className="reveal-headline">
              {chosenOriginal === liveQuestion.answer ? 'תשובה נכונה! 🎉' : 'תשובה שגויה'}
            </div>

            {hasExpl ? (
              <div className="expl-list">
                {/* Correct option explanation first, emphasized */}
                <div className="expl expl-correct">
                  <span className="expl-badge">התשובה הנכונה — {HEB_LETTERS[correctDisplaySlot]}</span>
                  <p>{liveQuestion.option_explanations[liveQuestion.answer]}</p>
                </div>

                {/* Why the wrong options are wrong — the pedagogical core */}
                <div className="expl-wrongs">
                  <div className="expl-wrongs-title">למה האפשרויות האחרות שגויות</div>
                  {item.order.map((originalIndex, displaySlot) => {
                    if (originalIndex === liveQuestion.answer) return null
                    const isYourPick = displaySlot === revealSlot
                    return (
                      <div key={originalIndex} className={`expl ${isYourPick ? 'expl-yourpick' : ''}`}>
                        <span className="expl-badge">
                          {HEB_LETTERS[displaySlot]}{isYourPick ? ' — הבחירה שלך' : ''}
                        </span>
                        <p>{liveQuestion.option_explanations[originalIndex]}</p>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <p className="expl-fallback">
                {chosenOriginal === liveQuestion.answer
                  ? 'בחרת נכון.'
                  : `התשובה הנכונה היא ${HEB_LETTERS[correctDisplaySlot]}.`}
              </p>
            )}

            {liveQuestion.explanation && (
              <div className="expl expl-general">
                <span className="expl-badge">הסבר כללי</span>
                <p>{liveQuestion.explanation}</p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="practice-nav">
        <button className="btn" onClick={goPrev} disabled={idx === 0}>
          הקודמת
        </button>
        {revealed && !atEnd && (
          <button className="btn btn-primary" onClick={goNext}>
            הבאה →
          </button>
        )}
        {revealed && atEnd && (
          <button className="btn btn-primary" onClick={onExit}>
            סיום התרגול
          </button>
        )}
        {!revealed && (
          <button className="btn" onClick={goNext} disabled={atEnd}>
            דלג
          </button>
        )}
      </div>
    </div>
  )
}
