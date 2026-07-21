import { useEffect, useRef, useState } from 'react'
import { IconFileX, IconStar } from './Icons.jsx'
import { TAG_REWARD, WRONG_THRESHOLD } from '../lib/points.js'

// The post-answer feedback control: two small icons tucked into the question
// card's meta row.
//
// Deliberately understated — most questions should get no tag at all, so the
// affordance stays out of the way until wanted.
//
// Asymmetric on purpose: TAGGING takes two steps (open, read, confirm), which
// is the guardrail against reflex-reporting a merely hard question as wrong.
// UNTAGGING takes one — tapping a lit icon clears it immediately. Retracting
// is harmless, so making it cheap costs nothing.
//
// `myTag` is only ever the CURRENT user's own tag. Aggregate counts are never
// shown to anyone.
const TAGS = [
  {
    value: 'wrong',
    Icon: IconFileX,
    iconLabel: 'דיווח על שאלה שגויה',
    title: 'דיווח על שאלה שגויה',
    // The threshold is interpolated, not spelled out, so the copy can never
    // drift from WRONG_THRESHOLD (and its mirror in the SQL trigger).
    body: `יתכן וישנם שאלות שגויות. אם אתם בטוחים שהשאלה שגוייה, נא דווחו עליה. שאלה שדווחה כשגוייה ע״י ${WRONG_THRESHOLD} סטודנטים תוסר מהמערכת.`,
    confirm: 'דווח כשגויה',
  },
  {
    value: 'quality',
    Icon: IconStar,
    iconLabel: 'סימון שאלה איכותית',
    title: 'סמן כשאלה איכותית',
    body: 'חושבים שהשאלה טובה מהממוצע? סמנו אותה כאיכותית והיא תצורף למאגר השאלות האיכותיות. אם תרצו, תוכלו לבחור לתרגל רק שאלות איכותיות בתרגולים הבאים.',
    confirm: 'סמן כאיכותית',
  },
]

export default function TagBar({ myTag, tagRewarded, onChange }) {
  // Which popover is open ('wrong' | 'quality' | null).
  const [open, setOpen] = useState(null)
  // After confirming: { tag, earned } — shows the thank-you, then auto-closes.
  const [done, setDone] = useState(null)
  const rootRef = useRef(null)

  // Dismiss on outside click or Escape, the way a menu should behave.
  useEffect(() => {
    if (!open) return
    function onDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(null)
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Let the thank-you sit long enough to read, then close on its own.
  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => {
      setDone(null)
      setOpen(null)
    }, 1800)
    return () => clearTimeout(t)
  }, [done])

  function apply(tag) {
    // Only the first-ever tag of a question pays out, so only claim points
    // when the server will actually grant them.
    const earned = !tagRewarded
    onChange(tag)
    setDone({ tag, earned })
  }

  // Tapping an icon: if it's already your tag, retract it on the spot; if not,
  // open the popover so the tag itself still costs a deliberate confirm.
  function handleIconClick(tag, active, isOpen) {
    if (active) {
      onChange(null)
      setDone(null)
      setOpen(null)
      return
    }
    setOpen(isOpen ? null : tag)
  }

  return (
    <div className="tag-actions" ref={rootRef}>
      {TAGS.map((t) => {
        const active = myTag === t.value
        const isOpen = open === t.value
        const finished = done && done.tag === t.value
        return (
          <div key={t.value} className="tag-action">
            <button
              type="button"
              className={`tag-icon tag-icon-${t.value}${active ? ' tag-icon-active' : ''}`}
              aria-label={active ? `${t.iconLabel} — בטלו את התיוג` : t.iconLabel}
              aria-haspopup={active ? undefined : 'dialog'}
              aria-expanded={active ? undefined : isOpen}
              aria-pressed={active}
              onClick={() => handleIconClick(t.value, active, isOpen)}
            >
              <t.Icon size={17} />
            </button>

            {isOpen && (
              <div className="tag-pop" role="dialog" aria-label={t.title}>
                {finished ? (
                  <p className="tag-pop-thanks">
                    תודה! התיוג שלכם משפר את המאגר 🙌
                    {done.earned && <span className="tag-pop-points">+{TAG_REWARD} נק׳</span>}
                  </p>
                ) : (
                  <>
                    <p className="tag-pop-title">{t.title}</p>
                    <p className="tag-pop-body">{t.body}</p>
                    <button
                      type="button"
                      className={`btn tag-pop-btn tag-pop-btn-${t.value}`}
                      onClick={() => apply(t.value)}
                    >
                      {t.confirm}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
