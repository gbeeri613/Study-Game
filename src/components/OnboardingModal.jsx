import { useEffect, useState } from 'react'
import TagBar from './TagBar.jsx'
import { IconSparkles, IconX } from './Icons.jsx'
import { ONBOARDING_REWARD } from '../lib/points.js'

// Two-phase intro to question tagging, shown on Home (never mid-practice, so
// it's obvious the demo operates on a MOCK question — tapping its tags writes
// nothing anywhere).
//
// Phase 'intro': the pitch + [הראו לי איך] / [אולי אחר כך]. "Maybe later" and
// the X just close — no RPC — so the modal auto-appears again on a later
// visit. Home stops auto-showing it once the user has either finished the
// demo (onboarded_at set) or tagged a real question on their own.
//
// Phase 'demo': a mock, already-answered question embedding the real
// <TagBar>. One second in, everything but the tag icons dims and a helper
// line points at them. סיום stays disabled until the user has tagged, then
// pays ONBOARDING_REWARD once via complete_tag_onboarding. `tagRewarded` is
// pinned true so the demo's thank-you never promises a +2 the mock tap
// doesn't grant. Re-opened from the account menu the flow is identical but
// read-only: סגירה instead of סיום, no RPCs, no points.
const DEMO_OPTIONS = ['תשובה 1', 'תשובה 2', 'תשובה 3']

const HEB_LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו']

export default function OnboardingModal({ firstTime, onComplete, onClose }) {
  const [phase, setPhase] = useState('intro') // intro | demo | done
  // The user's demo tag — local state only, never persisted.
  const [demoTag, setDemoTag] = useState(null)
  // Once they've tagged (even if later retracted), סיום stays enabled.
  const [tagged, setTagged] = useState(false)
  // Dims everything but the tag icons until the user tries them.
  const [spotlight, setSpotlight] = useState(false)

  // Let the demo card land first, then pull focus to the icons.
  useEffect(() => {
    if (phase !== 'demo' || tagged) return
    const t = setTimeout(() => setSpotlight(true), 1000)
    return () => clearTimeout(t)
  }, [phase, tagged])

  // Completion affirmation phase: show the +10 thank-you, then auto-close.
  useEffect(() => {
    if (phase !== 'done') return
    const t = setTimeout(onClose, 1600)
    return () => clearTimeout(t)
  }, [phase, onClose])

  function handleDemoTag(tag) {
    setDemoTag(tag)
    if (tag) {
      setTagged(true)
      setSpotlight(false)
    }
  }

  function finish() {
    onComplete()
    setPhase('done')
  }

  const closing = phase === 'done'

  return (
    <div className="modal-overlay" role="presentation" onClick={() => !closing && onClose()}>
      <div
        className="modal modal-onboarding"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboard-title"
        onClick={(e) => e.stopPropagation()}
      >
        {!closing && (
          <button className="btn-icon modal-close" aria-label="סגירה" onClick={onClose}>
            <IconX size={18} />
          </button>
        )}

        {phase === 'done' ? (
          <div className="onboard-finish">
            <span className="modal-icon modal-icon-accent">
              <IconSparkles size={26} />
            </span>
            <p className="onboard-finish-text">
              תודה! קיבלתם {ONBOARDING_REWARD} נק׳ 🎉
            </p>
          </div>
        ) : phase === 'intro' ? (
          <>
            <h3 id="onboard-title">חדש - תיוג שאלות לשיפור המאגר</h3>
            <p className="onboard-intro">
              מעכשיו תוכלו לתייג תשובות שאתן חושבים שהן שגויות (לפעמים זה קורה,
              AI וכו׳), וגם לסמן שאלות טובות במיוחד. התיוגים האלו יעזרו
              לסטודנטים אחרים - שאלות שגויות יוסתרו וניתן גם לתרגל רק שאלות
              שסומנו כאיכותיות.
            </p>

            <div className="modal-actions">
              {firstTime && (
                <button className="btn btn-ghost" onClick={onClose}>
                  אולי אחר כך
                </button>
              )}
              <button className="btn btn-primary" onClick={() => setPhase('demo')}>
                הראו לי איך
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 id="onboard-title">חדש - תיוג שאלות לשיפור המאגר</h3>

            <p className={`onboard-helper${spotlight ? ' onboard-helper-on' : ''}`} aria-live="polite">
              {spotlight && !tagged ? 'כאן מתייגים שאלות. נסו בעצמכם' : ' '}
            </p>

            <div className={`onboard-demo${spotlight ? ' onboard-spotlight' : ''}`}>
              <div className="question-meta">
                <span className="chip">שאלה לדוגמה</span>
                <span className="chip chip-ok">נענתה נכון</span>
                <TagBar myTag={demoTag} tagRewarded onChange={handleDemoTag} />
              </div>
              <p className="onboard-demo-q">שאלה</p>
              <ul className="options">
                {DEMO_OPTIONS.map((text, i) => (
                  <li key={i}>
                    <div className={`option ${i === 0 ? 'option-correct' : 'option-dim'}`}>
                      <span className="option-letter">{HEB_LETTERS[i]}</span>
                      <span className="option-text">{text}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {tagged && (
              <p className="onboard-reinforce" aria-live="polite">
                מעולה! ככה מדווחים. שימו לב: ״שגויה״ = טעות עובדתית, לא שאלה קשה.
              </p>
            )}

            <div className="modal-actions">
              {firstTime ? (
                <button className="btn btn-primary" disabled={!tagged} onClick={finish}>
                  סיום (+{ONBOARDING_REWARD} נק׳)
                </button>
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
