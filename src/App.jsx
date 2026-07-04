import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { loadDb, saveDb, emptyDb } from './lib/storage.js'
import { fetchRemoteDb, recordAnswer, resetAnswers } from './lib/api.js'
import { useAuth, isAdmin, signOut } from './lib/useAuth.js'
import FilterBar from './components/FilterBar.jsx'
import Practice from './components/Practice.jsx'
import Stats from './components/Stats.jsx'
import ImportExport from './components/ImportExport.jsx'
import Login from './components/Login.jsx'
import {
  IconCap,
  IconTarget,
  IconChart,
  IconDatabase,
  IconLogOut,
  IconSparkles,
  IconAlert,
} from './components/Icons.jsx'

// ---- db reducer ------------------------------------------------------------
// Single source of truth for the whole database. Every action returns a NEW db
// object so the persistence effect can mirror it to localStorage.

function dbReducer(db, action) {
  switch (action.type) {
    case 'SET_DB':
      return action.db

    case 'RECORD_ANSWER': {
      // action: { id, choice (original index), correct }
      const questions = db.questions.map((q) =>
        q.id === action.id
          ? {
              ...q,
              answered_at: new Date().toISOString(),
              last_choice: action.choice,
              correct: action.correct,
            }
          : q,
      )
      return { ...db, questions }
    }

    case 'RESET_STATE': {
      // clear all answer-state (keeps content). action.ids optional subset.
      const idSet = action.ids ? new Set(action.ids) : null
      const questions = db.questions.map((q) =>
        !idSet || idSet.has(q.id)
          ? { ...q, answered_at: null, last_choice: null, correct: null }
          : q,
      )
      return { ...db, questions }
    }

    default:
      return db
  }
}

const TABS = [
  { key: 'practice', label: 'תרגול', icon: IconTarget },
  { key: 'stats', label: 'סטטיסטיקה', icon: IconChart },
  // 'manage' is admin-only and appended at render time.
]
const ADMIN_TAB = { key: 'manage', label: 'ניהול', icon: IconDatabase }

export default function App() {
  const { user, loading } = useAuth()

  // Gate the whole app behind Google sign-in.
  if (loading) {
    return (
      <div className="boot-screen">
        <div className="boot-mark">
          <IconCap size={30} />
        </div>
        <div className="spinner" />
      </div>
    )
  }

  if (!user) return <Login />

  return <StudyApp user={user} />
}

function StudyApp({ user }) {
  const [db, dispatch] = useReducer(dbReducer, emptyDb())
  const [tab, setTab] = useState('practice')
  // 'loading' until the first remote fetch resolves; then 'ready' or 'error'.
  const [status, setStatus] = useState('loading')
  const [loadError, setLoadError] = useState(null)

  // Practice filter/session config lives here so it survives tab switches.
  const [config, setConfig] = useState({
    course: [], // multi-select; empty = all
    filterBy: 'all', // 'all' | 'unit' | 'topic' — mutually exclusive sub-filter
    unit: 'all',
    topic: 'all',
    difficulty: [], // multi-select; empty = all
    state: ['unanswered', 'incorrect'], // multi-select; empty = all
    shuffleQuestions: true, // randomize question order each session
    shuffleOptions: true,
  })
  const [session, setSession] = useState(null) // null = still on the setup screen

  // Load the db from Supabase on sign-in. Supabase is the source of truth; if
  // the network is down we fall back to the last cached copy so practice still
  // works offline (the offline write-queue comes in a later phase).
  useEffect(() => {
    let active = true
    setStatus('loading')
    fetchRemoteDb(user.id)
      .then((remote) => {
        if (!active) return
        dispatch({ type: 'SET_DB', db: remote })
        saveDb(remote)
        setStatus('ready')
      })
      .catch((err) => {
        if (!active) return
        const cached = loadDb()
        if (cached) dispatch({ type: 'SET_DB', db: cached })
        setLoadError(err.message || String(err))
        setStatus(cached ? 'ready' : 'error')
      })
    return () => {
      active = false
    }
  }, [user.id])

  // Mirror to localStorage as an offline cache once we have real data.
  useEffect(() => {
    if (status === 'ready') saveDb(db)
  }, [db, status])

  // Dispatch that also persists answer-state changes to Supabase. Updates
  // apply to local state immediately (optimistic); the write happens in the
  // background. Passed to children in place of the raw dispatch.
  const persistDispatch = useCallback(
    (action) => {
      dispatch(action)
      if (action.type === 'RECORD_ANSWER') {
        recordAnswer(user.id, action.id, action.choice, action.correct).catch(
          (err) => console.error('Failed to save answer:', err),
        )
      } else if (action.type === 'RESET_STATE') {
        resetAnswers(user.id, action.ids).catch((err) =>
          console.error('Failed to reset answers:', err),
        )
      }
    },
    [user.id],
  )

  // Re-pull the whole db from Supabase (used after an admin import adds/updates
  // questions in the shared store).
  const refresh = useCallback(async () => {
    const remote = await fetchRemoteDb(user.id)
    dispatch({ type: 'SET_DB', db: remote })
    saveDb(remote)
  }, [user.id])

  const admin = isAdmin(user)
  const tabs = admin ? [...TABS, ADMIN_TAB] : TABS
  const hasQuestions = db.questions.length > 0

  // During an active practice session the app goes into focus mode: the
  // header and bottom nav disappear and the session owns the screen.
  const inSession = tab === 'practice' && session != null

  return (
    <div className={`app ${inSession ? 'app-no-nav' : ''}`}>
      {!inSession && (
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark">
              <IconCap size={20} />
            </span>
            <h1 className="app-title">תרגול מבחנים</h1>
          </div>
          <AccountMenu user={user} />
        </header>
      )}

      <main className="content">
        {status === 'loading' ? (
          <div className="loading-block">
            <div className="spinner" />
            <span>טוען נתונים…</span>
          </div>
        ) : status === 'error' ? (
          <div className="card error-card">
            <span className="error-icon">
              <IconAlert size={32} />
            </span>
            <h2>שגיאה בטעינת הנתונים</h2>
            <p className="muted">{loadError}</p>
          </div>
        ) : !hasQuestions && tab !== 'manage' ? (
          <EmptyState admin={admin} onGoManage={() => setTab('manage')} />
        ) : tab === 'manage' && admin ? (
          <div className="tab-panel" key="manage">
            <ImportExport db={db} dispatch={persistDispatch} onRefresh={refresh} />
          </div>
        ) : tab === 'stats' ? (
          <div className="tab-panel" key="stats">
            <Stats db={db} />
          </div>
        ) : session ? (
          <Practice
            db={db}
            dispatch={persistDispatch}
            config={config}
            onExit={() => setSession(null)}
          />
        ) : (
          <div className="tab-panel" key="practice">
            <FilterBar
              db={db}
              config={config}
              setConfig={setConfig}
              onStart={() => setSession(true)}
            />
          </div>
        )}
      </main>

      {!inSession && <BottomNav tabs={tabs} tab={tab} setTab={setTab} />}
    </div>
  )
}

function BottomNav({ tabs, tab, setTab }) {
  const idx = Math.max(
    0,
    tabs.findIndex((t) => t.key === tab),
  )
  return (
    <nav className="bottom-nav" role="tablist">
      <span
        className="nav-indicator"
        style={{
          width: `calc((100% - 10px) / ${tabs.length})`,
          insetInlineStart: `calc(5px + ${idx} * (100% - 10px) / ${tabs.length})`,
        }}
      />
      {tabs.map((t) => {
        const TabIcon = t.icon
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`nav-item ${tab === t.key ? 'nav-item-active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            <TabIcon size={21} />
            <span>{t.label}</span>
          </button>
        )
      })}
    </nav>
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
  const initial = (name || '?').trim().charAt(0).toUpperCase()

  return (
    <div className="account" ref={ref}>
      <button
        className="avatar"
        aria-label="חשבון"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {initial}
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

function EmptyState({ admin, onGoManage }) {
  return (
    <div className="card empty-state">
      <span className="empty-icon">
        <IconSparkles size={32} />
      </span>
      <h2>אין עדיין שאלות</h2>
      <p>
        {admin
          ? 'מאגר השאלות ריק. ייבא שאלות דרך לשונית הניהול.'
          : 'מאגר השאלות ריק כרגע. שאלות מתווספות על ידי המנהל.'}
      </p>
      {admin && (
        <div className="empty-actions">
          <button className="btn btn-primary" onClick={onGoManage}>
            ניהול נתונים
          </button>
        </div>
      )}
    </div>
  )
}
