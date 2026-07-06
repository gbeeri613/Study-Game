import { useEffect, useMemo, useRef, useState } from 'react'
import { IconCap, IconArrowLeft, IconSettings, IconLogOut } from './Icons.jsx'
import { courseLabel } from '../data/labels.js'
import { NONE_VALUE } from '../lib/session.js'
import { totalPoints } from '../lib/points.js'
import { fetchLeaderboard } from '../lib/api.js'
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

// Small round avatar for the leaderboard rows — Google photo, or a coloured
// initial when there's none.
function LbAvatar({ name, avatarUrl }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase()
  return (
    <span className="lb-avatar">
      {avatarUrl ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" /> : initial}
    </span>
  )
}

function firstNameOf(name) {
  return String(name || '').trim().split(/\s+/)[0] || '—'
}

// Medal emoji for the top three of each board.
const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' }

// One entry in the marquee: a vertical stack of avatar · first name · points.
// The top 3 get a tinted, outlined "podium" card with a medal overhanging the
// top-right corner; everyone else is background-less, separated by gap alone.
function LbChip({ row, isMe }) {
  const medal = MEDALS[row.rank]
  const cls = ['lb-chip', medal ? `lb-chip-podium lb-chip-${row.rank}` : '', isMe ? 'lb-chip-me' : '']
    .filter(Boolean)
    .join(' ')
  return (
    <div className={cls}>
      {medal && (
        <span className="lb-medal" aria-hidden="true">
          {medal}
        </span>
      )}
      <LbAvatar name={row.name} avatarUrl={row.avatar_url} />
      <span className="lb-chip-name">{firstNameOf(row.name)}</span>
      <span className="lb-chip-points">
        {row.points}
        <span className="lb-chip-unit"> נק׳</span>
      </span>
    </div>
  )
}

// The Home leaderboard: a single horizontal auto-scrolling showcase that runs
// the top-5 all-time followed by the top-5 today, each behind a small label.
// Point totals are computed server-side from answer state.
function Leaderboard({ userId, onRanks }) {
  const [boards, setBoards] = useState(null) // { all, daily } | null (loading)
  const [error, setError] = useState(null)

  useEffect(() => {
    let active = true
    Promise.all([fetchLeaderboard('all'), fetchLeaderboard('daily')])
      .then(([all, daily]) => active && setBoards({ all, daily }))
      .catch((err) => active && setError(err.message || String(err)))
    return () => {
      active = false
    }
  }, [])

  // Lift the caller's all-time + daily ranks up to the hero once known.
  useEffect(() => {
    if (!boards) return
    const meAll = boards.all.find((r) => r.user_id === userId)
    const meDaily = boards.daily.find((r) => r.user_id === userId)
    onRanks({ all: meAll ? meAll.rank : null, daily: meDaily ? meDaily.rank : null })
  }, [boards, userId, onRanks])

  const groups = useMemo(() => {
    if (!boards) return []
    const g = []
    if (boards.all.length) g.push({ key: 'all', label: 'כל הזמנים', rows: boards.all.slice(0, 5) })
    if (boards.daily.length) g.push({ key: 'daily', label: 'היום', rows: boards.daily.slice(0, 5) })
    return g
  }, [boards])

  // The scrolling content, rendered twice back-to-back so the CSS animation can
  // loop seamlessly (it shifts by exactly one copy). `copy` keeps React keys and
  // aria unique between the two.
  const renderRun = (copy) =>
    groups.map((grp) => (
      <div className="lb-seg" key={`${copy}-${grp.key}`}>
        <span className={`lb-seg-label lb-seg-${grp.key}`}>{grp.label}:</span>
        {grp.rows.map((r) => (
          <LbChip key={`${copy}-${grp.key}-${r.user_id}`} row={r} isMe={r.user_id === userId} />
        ))}
      </div>
    ))

  // Nothing to show yet (loading, error, or no points anywhere) — render no dock
  // rather than an empty bar. `.home`'s bottom padding still reserves the space.
  if (error || !boards || groups.length === 0) return null

  return (
    <div className="lb-dock" aria-label="לוח מובילים">
      <div className="lb-dock-inner">
        <div className="lb-marquee">
          <div className="lb-track">
            <div className="lb-run">{renderRun('a')}</div>
            <div className="lb-run" aria-hidden="true">
              {renderRun('b')}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// A hero rank card. Tinted + medal-badged (gold/silver/bronze) when the rank is
// in the top three, matching the leaderboard podium.
function RankStat({ label, rank }) {
  const medal = MEDALS[rank]
  const cls = ['home-stat', medal ? `home-stat-podium home-stat-${rank}` : ''].filter(Boolean).join(' ')
  return (
    <div className={cls}>
      {medal && (
        <span className="home-medal" aria-hidden="true">
          {medal}
        </span>
      )}
      <span className="home-stat-label">{label}</span>
      <span className="home-stat-value">{rank != null ? `#${rank}` : '—'}</span>
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
  // Total points computed locally from answer state (matches the server model),
  // so the hero number shows instantly. Ranks arrive with the leaderboard.
  const points = useMemo(() => totalPoints(db.questions), [db.questions])
  const [ranks, setRanks] = useState({ all: null, daily: null })

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
        <div className="home-stats">
          <div className="home-stat">
            <span className="home-stat-label">נקודות</span>
            <span className="home-stat-value">{points.toLocaleString('he')}</span>
          </div>
          <RankStat label="דירוג יומי" rank={ranks.daily} />
          <RankStat label="דירוג כללי" rank={ranks.all} />
        </div>
      </section>

      <div className="course-grid">
        {courses.map((c) => (
          <CourseCard key={c.slug ?? '__none__'} course={c} onStart={onStart} />
        ))}
      </div>

      <Leaderboard userId={user.id} onRanks={setRanks} />
    </div>
  )
}
