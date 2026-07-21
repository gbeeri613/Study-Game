import { useEffect, useState } from 'react'
import TagBar from './TagBar.jsx'
import { IconSparkles } from './Icons.jsx'
import { ONBOARDING_REWARD } from '../lib/points.js'

// One-time interactive intro to question tagging, shown on Home (never
// mid-practice, so it's obvious the demo below operates on a MOCK question —
// tapping its tags writes nothing anywhere).
//
// The demo embeds the real <TagBar>, not a lookalike, so it can never drift
// from the control the app actually ships. `tagRewarded` is pinned true so the
// demo's thank-you never promises +2 points the mock tap doesn't grant.
//
// First-time (profile.onboarded_at == null): Complete pays ONBOARDING_REWARD
// once, Skip (or dismissing the overlay) marks it seen with no points — either
// way it won't auto-appear again. Re-opened from the account menu it is
// read-only: same demo, a single close button, no RPC calls, no points.
const DEMO_QUESTION = {
  question: 'איזו שיטת מחקר מתאימה ביותר לבחינת קשר סיבתי?',
  options: ['ניסוי מבוקר', 'מחקר מתאמי', 'תצפית משתתפת'],
  answer: 0,
}

const HEB_LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו']

export default function OnboardingModal({ firstTime, onComplete, onSkip, onClose }) {
  // The user's demo tag — local state only, never persisted.
  const [demoTag, setDemoTag] = useState(null)
  // Once they've tagged (even if later retracted), keep the reinforcement line.
  const [demoDone, setDemoDone] = useState(false)
  // Completion affirmation phase: show the +10 thank-you, then auto-close.
  const [finished, setFinished] = useState(false)

  useEffect(() => {
    if (!finished) return
    const t = setTimeout(onClose, 1600)
    return () => clearTimeout(t)
  }, [finished, onClose])

  function handleDemoTag(tag) {
    setDemoTag(tag)
    if (tag) setDemoDone(true)
  }

  function complete() {
    onComplete()
    setFinished(true)
  }

  // Dismissing counts as Skip the first time (so it won't nag again); on a
  // re-open it's just a close.
  const dismiss = firstTime ? onSkip : onClose

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={() => !finished && dismiss()}
    >
      <div
        className="modal modal-onboarding"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboard-title"
        onClick={(e) => e.stopPropagation()}
      >
        {finished ? (
          <div className="onboard-finish">
            <span className="modal-icon modal-icon-accent">
              <IconSparkles size={26} />
            </span>
            <p className="onboard-finish-text">
              תודה! קיבלתם {ONBOARDING_REWARD} נק׳ 🎉
            </p>
          </div>
        ) : (
          <>
            <h3 id="onboard-title">עזרו לשפר את מאגר השאלות</h3>
            <p className="onboard-intro">
              השאלות נוצרות ע״י בינה מלאכותית ולפעמים יש טעויות. אתם יכולים לתייג
              את החריגות — לא צריך לתייג כל שאלה.
            </p>

            <p className="onboard-prompt">נסו לתייג את השאלה לדוגמה:</p>

            {/* A mock, already-answered question card with the REAL tag control
                in its meta row — exactly where it lives in practice. */}
            <div className="onboard-demo">
              <div className="question-meta">
                <span className="chip">שאלה לדוגמה</span>
                <span className="chip chip-ok">נענתה נכון</span>
                <TagBar myTag={demoTag} tagRewarded onChange={handleDemoTag} />
              </div>
              <p className="onboard-demo-q">{DEMO_QUESTION.question}</p>
              <ul className="options">
                {DEMO_QUESTION.options.map((text, i) => (
                  <li key={i}>
                    <div
                      className={`option ${i === DEMO_QUESTION.answer ? 'option-correct' : 'option-dim'}`}
                    >
                      <span className="option-letter">{HEB_LETTERS[i]}</span>
                      <span className="option-text">{text}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <p className={`onboard-tip${demoDone ? ' onboard-tip-on' : ''}`} aria-live="polite">
              {demoDone
                ? 'מעולה! ככה מדווחים. שימו לב: ״שגויה״ = טעות עובדתית, לא שאלה קשה.'
                : ' '}
            </p>

            <div className="modal-actions">
              {firstTime ? (
                <>
                  <button className="btn btn-ghost" onClick={onSkip}>
                    אולי אחר כך
                  </button>
                  <button className="btn btn-primary" onClick={complete}>
                    סיום (+{ONBOARDING_REWARD} נק׳)
                  </button>
                </>
              ) : (
                <button className="btn btn-ghost" onClick={onClose}>
                  סגירה
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
