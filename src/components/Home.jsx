import { useEffect, useMemo, useRef, useState } from 'react'
import { IconCap, IconArrowLeft, IconSettings, IconLogOut } from './Icons.jsx'
import { courseLabel } from '../data/labels.js'
import { NONE_VALUE } from '../lib/session.js'
import { signOut } from '../lib/useAuth.js'

// Segment colours: correct = green, incorrect = red, not answered = grey.
const SEG = {
  correct: 'var(--ok)',
  incorrect: 'var(--bad)',
  unanswered: '#7b818f',
}

function courseName(slug) {
  return slug === NONE_VALUE ? 'ללא קורס' : courseLabel(slug)
}

function AccountMenu({ user }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [open])

  const email = user.email ?? ''
  const name = user.user_metadata?.full_name || user.user_metadata?.name || email
  const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture
  const initial = (name || '?').trim().charAt(0).toUpperCase()

  return (
    <div className="account" ref={ref}>
      <button
        className="avatar"
        aria-label="חשבון"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {avatarUrl ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" /> : initial}
      </button>
      {open && (
        <div className="account-menu">
          <div className="account-info">
            <span className="account-name">{name}</span>
            <span className="account-email">{email}</span>
          </div>
          <button className="menu-item" onClick={() => signOut()}>
            <IconLogOut size={16} />
            התנתקות
          </button>
        </div>
      )}
    </div>
  )
}

function firstName(user) {
  const name = user.user_metadata?.full_name || user.user_metadata?.name || user.email || ''
  return String(name).trim().split(/\s+/)[0] || ''
}

// A donut of a course's questions split into correct / incorrect / unanswered.
function CourseDonut({ correct, incorrect, unanswered, total }) {
  const size = 112
  const stroke = 13
  const r = (size - stroke) / 2
  const c = size / 2
  const C = 2 * Math.PI * r

  const segments = [
    { v: correct, color: SEG.correct },
    { v: incorrect, color: SEG.incorrect },
    { v: unanswered, color: SEG.unanswered },
  ]
  let acc = 0

  return (
    <div className="donut">
      <svg viewBox={`0 0 ${size} ${size}`}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        {total > 0 &&
          segments.map((s, i) => {
            if (s.v <= 0) return null
            const frac = s.v / total
            const dash = frac * C
            const offset = -acc * C
            acc += frac
            return (
              <circle
                key={i}
                cx={c}
                cy={c}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={stroke}
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={offset}
                transform={`rotate(-90 ${c} ${c})`}
              />
            )
          })}
      </svg>
      <div className="donut-center">
        <span className="donut-total">{total}</span>
        <span className="donut-cap">שאלות</span>
      </div>
    </div>
  )
}

function CourseCard({ course, onStart }) {
  return (
    <div className="course-card">
      <div className="course-card-title">{courseName(course.slug)}</div>
      <CourseDonut
        correct={course.correct}
        incorrect={course.incorrect}
        unanswered={course.unanswered}
        total={course.total}
      />
      <ul className="course-legend">
        <li>
          <span className="legend-dot dot-ok" />
          <span className="legend-name">צדקת</span>
          <span className="legend-value">{course.correct}</span>
        </li>
        <li>
          <span className="legend-dot dot-bad" />
          <span className="legend-name">טעית</span>
          <span className="legend-value">{course.incorrect}</span>
        </li>
        <li>
          <span className="legend-dot dot-none" />
          <span className="legend-name">לא ענית</span>
          <span className="legend-value">{course.unanswered}</span>
        </li>
      </ul>
      <button className="course-cta" onClick={() => onStart(course.slug)}>
        תרגל
        <IconArrowLeft size={16} />
      </button>
    </div>
  )
}

export default function Home({ db, user, admin, onStart, onOpenAdmin }) {
  // Per-course tallies of correct / incorrect / unanswered.
  const courses = useMemo(() => {
    const map = new Map()
    for (const q of db.questions) {
      const slug = q.course == null || q.course === '' ? NONE_VALUE : q.course
      if (!map.has(slug)) map.set(slug, { slug, total: 0, correct: 0, incorrect: 0, unanswered: 0 })
      const row = map.get(slug)
      row.total += 1
      if (q.answered_at == null) row.unanswered += 1
      else if (q.correct) row.correct += 1
      else row.incorrect += 1
    }
    return [...map.values()].sort((a, b) =>
      courseName(a.slug).localeCompare(courseName(b.slug), 'he'),
    )
  }, [db.questions])

  const name = firstName(user)

  return (
    <div className="home">
      <header className="home-top">
        <div className="brand">
          <span className="brand-mark">
            <IconCap size={20} />
          </span>
          <h1 className="app-title">תרגול חץ 26׳</h1>
        </div>
        <div className="home-top-actions">
          <AccountMenu user={user} />
          {admin && (
            <button className="btn-icon home-cog" aria-label="ניהול" onClick={onOpenAdmin}>
              <IconSettings size={20} />
            </button>
          )}
        </div>
      </header>

      <section className="home-hero">
        <p className="home-greeting">{name ? `היי, ${name}` : 'היי'} 👋</p>
        <p className="home-sub">בחרו קורס והתחילו לתרגל</p>
      </section>

      <div className="course-grid">
        {courses.map((c) => (
          <CourseCard key={c.slug ?? '__none__'} course={c} onStart={onStart} />
        ))}
      </div>

      {/* Leaderboard (Phase 3) — sticky dock that the cards scroll under, with a
          top fade so the transition is gentle. Commented out until the real
          board is built; re-enable together with `.home` padding-bottom and
          import IconTrophy.
      <div className="home-lb-dock">
        <div className="home-lb-inner">
          <div className="card leaderboard-stub">
            <div className="lb-stub-icon">
              <IconTrophy size={20} />
            </div>
            <div className="lb-stub-text">
              <strong>לוח מובילים</strong>
              <span>נקודות ודירוג יגיעו בקרוב</span>
            </div>
          </div>
        </div>
      </div>
      */}
    </div>
  )
}
