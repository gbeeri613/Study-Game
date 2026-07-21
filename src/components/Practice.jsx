import { useEffect, useMemo, useRef, useState } from 'react'
import {
  activeQuestions,
  applyFilters,
  buildSession,
  configToFilters,
  selectSessionQuestions,
  displayToOriginal,
} from '../lib/session.js'
import { courseLabel } from '../data/labels.js'
import { sessionPoints } from '../lib/points.js'
import { IconX, IconCheck, IconChevronLeft } from './Icons.jsx'
import TagBar from './TagBar.jsx'

// Hebrew letter prefixes for options (א, ב, ג, ...)
const HEB_LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט', 'י']

// Pre-session answer bucket for a question (captured before this session
// changes it), used to detect "turnarounds".
function prevBucket(q) {
  if (q.answered_at == null) return 'unanswered'
  return q.correct ? 'correct' : 'incorrect'
}

export default function Practice({ db, dispatch, config, overrideQuestionIds, onComplete, onExit }) {
  // Build the session ONCE at mount. Either a fixed set of ids (mistakes review)
  // or a learning-dense slice of the filtered pool, capped to config.count.
  // Questions are shuffled for display; option order is shuffled per question.
  const session = useMemo(() => {
    let pool
    if (overrideQuestionIds && overrideQuestionIds.length) {
      const idset = new Set(overrideQuestionIds)
      // A question can get hidden between finishing a session and reviewing its
      // mistakes, so filter here too rather than trusting the id list.
      pool = activeQuestions(db.questions).filter((q) => idset.has(q.id))
    } else {
      const matching = applyFilters(db.questions, configToFilters(config))
      pool = selectSessionQuestions(matching, config.count)
    }
    return buildSession(pool, { order: 'shuffle', shuffleOptions: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startRef = useRef(Date.now())
  // First-attempt outcome per answered question, in answer order:
  // { id, correct, prev }.
  const outcomesRef = useRef([])

  const [idx, setIdx] = useState(0)
  const [selectedSlot, setSelectedSlot] = useState(null)
  const [attempted, setAttempted] = useState(false)

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

  function buildResult() {
    const outcomes = outcomesRef.current
    const answered = outcomes.length
    const firstTryCorrect = outcomes.filter((o) => o.correct).length
    let bestRun = 0
    let run = 0
    for (const o of outcomes) {
      if (o.correct) {
        run += 1
        if (run > bestRun) bestRun = run
      } else {
        run = 0
      }
    }
    const turnarounds = outcomes.filter((o) => o.correct && o.prev !== 'correct').length
    const mistakeIds = outcomes.filter((o) => !o.correct).map((o) => o.id)
    return {
      total: session.length,
      answered,
      firstTryCorrect,
      bestRun,
      turnarounds,
      mistakeIds,
      pointsEarned: sessionPoints(outcomes),
      elapsedMs: Date.now() - startRef.current,
      completed: answered >= session.length,
      config,
    }
  }

  function finish() {
    onComplete(buildResult())
  }

  // The X button quits early: show a summary for what was answered, or bail
  // straight home if nothing was attempted yet.
  function quit() {
    if (outcomesRef.current.length === 0) onExit()
    else finish()
  }

  function goNext() {
    if (atEnd) {
      finish()
      return
    }
    setIdx((i) => i + 1)
    setSelectedSlot(null)
    setAttempted(false)
  }

  // Tagging is optional and never touches answer state. `next` is a tag value,
  // or null to retract. TagBar owns the confirmation UI; this just persists.
  function handleTag(next) {
    if (next === null) {
      dispatch({ type: 'CLEAR_TAG', id: liveQuestion.id })
      return
    }
    dispatch({ type: 'TAG_QUESTION', id: liveQuestion.id, tag: next })
  }

  function pick(displaySlot) {
    if (pickedCorrect) return // solved — options are locked
    const originalIndex = displayToOriginal(item, displaySlot)
    const correct = originalIndex === liveQuestion.answer
    setSelectedSlot(displaySlot)
    // Only the first attempt is recorded — later picks never overwrite it.
    if (!attempted) {
      setAttempted(true)
      outcomesRef.current.push({ id: liveQuestion.id, correct, prev: prevBucket(item.question) })
      dispatch({ type: 'RECORD_ANSWER', id: liveQuestion.id, choice: originalIndex, correct })
    }
  }

  // Keyboard: number keys pick an option (until solved); Enter/Space advance
  // once any answer has been picked.
  useEffect(() => {
    function onKey(e) {
      if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return
      if (!item) return
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
  }, [item, selectedSlot, attempted, liveQuestion, idx, atEnd])

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

  const hasExpl =
    Array.isArray(liveQuestion.option_explanations) &&
    liveQuestion.option_explanations.length === liveQuestion.options.length

  // Progress fills as answers land, not just on navigation.
  const progress = ((idx + (attempted ? 1 : 0)) / session.length) * 100

  return (
    <div className="practice">
      <div className="practice-header">
        <button className="btn btn-ghost btn-icon" onClick={quit} aria-label="סיום התרגול">
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
          {/* Available as soon as an attempt is recorded — including on a wrong
              pick, where the runner deliberately doesn't reveal the answer.
              That moment is exactly when a user wants to challenge a question. */}
          {attempted && (
            <TagBar
              myTag={liveQuestion.my_tag ?? null}
              tagRewarded={!!liveQuestion.tag_rewarded}
              onChange={handleTag}
            />
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
