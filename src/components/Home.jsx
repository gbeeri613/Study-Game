import { useEffect, useMemo, useRef, useState } from 'react'
import {
  IconCap,
  IconPlayLeft,
  IconSettings,
  IconLogOut,
  IconTrophy,
} from './Icons.jsx'
import { signOut } from '../lib/useAuth.js'

// Animate a number from 0 to its target with an ease-out curve.
function useCountUp(target, duration = 700) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    let raf
    const t0 = performance.now()
    const step = (t) => {
      const p = Math.min(1, (t - t0) / duration)
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return value
}

function Metric({ value, caption, suffix = '', accent = false }) {
  const shown = useCountUp(value)
  return (
    <div className={`stat-card ${accent ? 'stat-accent' : ''}`}>
      <div className="stat-num">
        {shown}
        {suffix}
      </div>
      <div className="stat-cap">{caption}</div>
    </div>
  )
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

// The greeting uses just the first token of the display name.
function firstName(user) {
  const name = user.user_metadata?.full_name || user.user_metadata?.name || user.email || ''
  return String(name).trim().split(/\s+/)[0] || ''
}

export default function Home({ db, user, admin, onStart, onOpenAdmin }) {
  const stats = useMemo(() => {
    const questions = db.questions
    const total = questions.length
    let answered = 0
    let correct = 0
    for (const q of questions) {
      if (q.answered_at != null) {
        answered += 1
        if (q.correct) correct += 1
      }
    }
    return {
      total,
      answered,
      correct,
      mastery: total === 0 ? 0 : Math.round((correct / total) * 100),
      accuracy: answered === 0 ? 0 : Math.round((correct / answered) * 100),
    }
  }, [db.questions])

  const name = firstName(user)

  return (
    <div className="home">
      <header className="home-top">
        <div className="brand">
          <span className="brand-mark">
            <IconCap size={20} />
          </span>
          <h1 className="app-title">תרגול מבחנים</h1>
        </div>
        <div className="home-top-actions">
          <AccountMenu user={user} />
          {admin && (
            <button
              className="btn-icon home-cog"
              aria-label="ניהול"
              onClick={onOpenAdmin}
            >
              <IconSettings size={20} />
            </button>
          )}
        </div>
      </header>

      <section className="home-hero">
        <p className="home-greeting">
          {name ? `היי, ${name}` : 'היי'} 👋
        </p>
        <p className="home-sub">מוכנים לסבב תרגול?</p>
      </section>

      <div className="home-metrics">
        <Metric value={stats.answered} caption="שאלות נענו" />
        <Metric value={stats.mastery} suffix="%" caption="שליטה" accent />
        <Metric value={stats.accuracy} suffix="%" caption="דיוק" />
      </div>

      {/* Leaderboard (Phase 3) — placeholder while points/boards are unbuilt. */}
      <div className="card leaderboard-stub">
        <div className="lb-stub-icon">
          <IconTrophy size={20} />
        </div>
        <div className="lb-stub-text">
          <strong>לוח מובילים</strong>
          <span>נקודות ודירוג יגיעו בקרוב</span>
        </div>
      </div>

      <button className="btn btn-primary home-start" onClick={onStart}>
        תרגול חדש
        <IconPlayLeft size={18} />
      </button>
    </div>
  )
}
