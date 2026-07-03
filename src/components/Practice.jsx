import { useEffect, useMemo, useState } from 'react'
import { applyFilters, buildSession, displayToOriginal } from '../lib/session.js'
import { courseLabel } from '../data/labels.js'
import { IconX, IconCheck, IconChevronLeft } from './Icons.jsx'

// Hebrew letter prefixes for options (א, ב, ג, ...)
const HEB_LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט', 'י']

// Animated score ring for the session summary.
function ScoreRing({ pct }) {
  const R = 52
  const C = 2 * Math.PI * R
  return (
    <div className="score-ring">
      <svg viewBox="0 0 120 120">
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#4d8dff" />
            <stop offset="100%" stopColor="#8b6cf6" />
          </linearGradient>
        </defs>
        <circle className="ring-track" cx="60" cy="60" r={R} />
        <circle
          className="ring-fill"
          cx="60"
          cy="60"
          r={R}
          stroke="url(#ring-grad)"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - pct / 100)}
          style={{ '--ring-c': C }}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <div className="score-ring-label">
        <span className="score-pct">{pct}%</span>
      </div>
    </div>
  )
}

function summaryTitle(pct) {
  if (pct >= 90) return 'מעולה!'
  if (pct >= 75) return 'כל הכבוד!'
  if (pct >= 50) return 'עבודה טובה!'
  return 'ממשיכים לתרגל!'
}

export default function Practice({ db, dispatch, config, onExit }) {
  // Build the session ONCE (stable order + option permutations) from the
  // questions matching the filters at start time.
  const session = useMemo(() => {
    const matching = applyFilters(db.questions, config)
    return buildSession(matching, {
      order: config.shuffleQuestions ? 'shuffle' : 'sequential',
      shuffleOptions: config.shuffleOptions,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [idx, setIdx] = useState(0)
  // Per-question interaction state:
  //  - selectedSlot: the display slot currently shown as picked (null before the
  //    first pick).
  //  - attempted: whether the FIRST guess this session was already recorded. The
  //    first pick is what gets saved; picking again afterwards gives feedback
  //    without changing the recorded correct/incorrect.
  const [selectedSlot, setSelectedSlot] = useState(null)
  const [attempted, setAttempted] = useState(false)
  // First-attempt results for the end-of-session summary.
  const [firstTryCorrect, setFirstTryCorrect] = useState(0)
  const [done, setDone] = useState(false)

  const item = session[idx]
  // Live question (state may have been updated by a prior answer this session).
  const liveQuestion = useMemo(() => {
    if (!item) return null
    return db.questions.find((q) => q.id === item.question.id) || item.question
  }, [db.questions, item])

  const atEnd = idx >= session.length - 1

  const picked = selectedSlot !== null
  const pickedOriginal = picked ? displayToOriginal(item, selectedSlot) : null
  const pickedCorrect = picked && pickedOriginal === liveQuestion?.answer

  function goNext() {
    if (atEnd) {
      setDone(true)
      return
    }
    setIdx((i) => i + 1)
    setSelectedSlot(null)
    setAttempted(false)
  }

  function pick(displaySlot) {
    if (pickedCorrect) return // solved — options are locked
    const originalIndex = displayToOriginal(item, displaySlot)
    const correct = originalIndex === liveQuestion.answer
    setSelectedSlot(displaySlot)
    // Only the first attempt is recorded — later picks never overwrite it.
    if (!attempted) {
      setAttempted(true)
      if (correct) setFirstTryCorrect((n) => n + 1)
      dispatch({ type: 'RECORD_ANSWER', id: liveQuestion.id, choice: originalIndex, correct })
    }
  }

  // Keyboard: number keys pick an option (until solved); Enter/Space advance once
  // any answer has been picked.
  useEffect(() => {
    function onKey(e) {
      if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return
      if (!item) return
      if (done) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onExit()
        }
        return
      }
      if (e.key >= '1' && e.key <= '9') {
        const slot = Number(e.key) - 1
        if (!pickedCorrect && slot < liveQuestion.options.length) {
          e.preventDefault()
          pick(slot)
        }
      } else if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowLeft') {
        // RTL: left arrow = next
        if (attempted) {
          e.preventDefault()
          goNext()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, selectedSlot, attempted, liveQuestion, idx, atEnd, done])

  if (session.length === 0) {
    return (
      <div className="card empty-state">
        <h2>אין שאלות תואמות לסינון</h2>
        <div className="empty-actions">
          <button className="btn" onClick={onExit}>
            חזרה
          </button>
        </div>
      </div>
    )
  }

  // End-of-session summary.
  if (done) {
    const pct = Math.round((firstTryCorrect / session.length) * 100)
    return (
      <div className="card summary-card">
        <ScoreRing pct={pct} />
        <h2 className="summary-title">{summaryTitle(pct)}</h2>
        <p className="summary-sub">
          ענית נכון על <strong>{firstTryCorrect}</strong> מתוך{' '}
          <strong>{session.length}</strong> שאלות בניסיון הראשון
        </p>
        <button className="btn btn-primary" onClick={onExit}>
          חזרה למסך הבחירה
        </button>
      </div>
    )
  }

  const hasExpl =
    Array.isArray(liveQuestion.option_explanations) &&
    liveQuestion.option_explanations.length === liveQuestion.options.length

  // Progress fills as answers land, not just on navigation.
  const progress = ((idx + (attempted ? 1 : 0)) / session.length) * 100

  return (
    <div className="practice">
      <div className="practice-header">
        <button className="btn btn-ghost btn-icon" onClick={onExit} aria-label="סיום התרגול">
          <IconX size={19} />
        </button>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <h2 className="practice-title">
          {idx + 1} <span className="practice-title-total">/ {session.length}</span>
        </h2>
      </div>

      <div className="card question-card" key={liveQuestion.id}>
        <div className="question-meta">
          {liveQuestion.course != null && (
            <span className="chip">{courseLabel(liveQuestion.course)}</span>
          )}
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
            const isCorrect = originalIndex === liveQuestion.answer
            const isYourPick = displaySlot === selectedSlot
            let cls = 'option'
            if (pickedCorrect) {
              // Solved: reveal the (chosen) correct option, dim the rest.
              if (isCorrect) cls += ' option-correct'
              else cls += ' option-dim'
            } else if (isYourPick) {
              // Wrong pick: mark only your choice — never reveal the answer.
              cls += ' option-wrong'
            }
            return (
              <li key={originalIndex}>
                <button
                  className={cls}
                  onClick={() => pick(displaySlot)}
                  disabled={pickedCorrect}
                >
                  <span className="option-letter">
                    {HEB_LETTERS[displaySlot] || displaySlot + 1}
                  </span>
                  <span className="option-text">{text}</span>
                  {pickedCorrect && isCorrect && (
                    <span className="mark">
                      <IconCheck size={20} />
                    </span>
                  )}
                  {!pickedCorrect && isYourPick && (
                    <span className="mark">
                      <IconX size={20} />
                    </span>
                  )}
                </button>
                {/* Explanation for the currently selected option: the correct
                    one once solved, or the wrong one you just tried. */}
                {hasExpl && isYourPick && (
                  <p className={`opt-expl ${isCorrect ? 'opt-expl-correct' : 'opt-expl-wrong'}`}>
                    {liveQuestion.option_explanations[originalIndex]}
                  </p>
                )}
              </li>
            )
          })}
        </ul>

        {picked && !pickedCorrect && (
          <p className="answer-note">
            ניתן לבחור תשובה נוספת. בכל מקרה שאלה זו תישמר בסטטוס ״נענתה לא נכון״.
          </p>
        )}

        {pickedCorrect && !hasExpl && <p className="expl-fallback">בחרת נכון.</p>}

        {pickedCorrect && liveQuestion.explanation && (
          <div className="expl-general">
            <span className="expl-badge">הסבר כללי</span>
            <p>{liveQuestion.explanation}</p>
          </div>
        )}
      </div>

      <div className="practice-nav">
        <button className="btn btn-primary" onClick={goNext} disabled={!attempted}>
          {atEnd ? 'סיום התרגול' : 'לשאלה הבאה'}
          <IconChevronLeft size={18} />
        </button>
      </div>
    </div>
  )
}
