import { useCallback, useEffect, useReducer, useState } from 'react'
import { loadDb, saveDb, emptyDb } from './lib/storage.js'
import { fetchRemoteDb, recordAnswer, resetAnswers } from './lib/api.js'
import { useAuth, signOut } from './lib/useAuth.js'
import FilterBar from './components/FilterBar.jsx'
import Practice from './components/Practice.jsx'
import Stats from './components/Stats.jsx'
import ImportExport from './components/ImportExport.jsx'
import Login from './components/Login.jsx'

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
  { key: 'practice', label: 'תרגול' },
  { key: 'stats', label: 'סטטיסטיקה' },
  { key: 'manage', label: 'ניהול' },
]

export default function App() {
  const { user, loading } = useAuth()

  // Gate the whole app behind Google sign-in.
  if (loading) {
    return (
      <div className="app">
        <div className="login-screen">
          <p className="muted">טוען…</p>
        </div>
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

  const hasQuestions = db.questions.length > 0

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-row">
          <h1 className="app-title">תרגול מבחנים</h1>
          <AccountMenu user={user} />
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={`tab ${tab === t.key ? 'tab-active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="content">
        {status === 'loading' ? (
          <p className="muted">טוען נתונים…</p>
        ) : status === 'error' ? (
          <div className="card">
            <h2>שגיאה בטעינת הנתונים</h2>
            <p className="muted">{loadError}</p>
          </div>
        ) : !hasQuestions && tab !== 'manage' ? (
          <EmptyState onGoManage={() => setTab('manage')} />
        ) : tab === 'practice' ? (
          <PracticeTab db={db} dispatch={persistDispatch} />
        ) : tab === 'stats' ? (
          <Stats db={db} />
        ) : (
          <ImportExport db={db} dispatch={persistDispatch} />
        )}
      </main>
    </div>
  )
}

function AccountMenu({ user }) {
  const email = user.email ?? ''
  const name = user.user_metadata?.full_name || user.user_metadata?.name || email
  return (
    <div className="account">
      <span className="account-name" title={email}>
        {name}
      </span>
      <button className="btn btn-sm btn-ghost" onClick={() => signOut()}>
        התנתק
      </button>
    </div>
  )
}

function EmptyState({ onGoManage }) {
  return (
    <div className="empty-state card">
      <h2>אין עדיין שאלות</h2>
      <p>מאגר השאלות ריק כרגע. שאלות מתווספות על ידי המנהל.</p>
      <div className="empty-actions">
        <button className="btn" onClick={onGoManage}>
          ניהול נתונים
        </button>
      </div>
    </div>
  )
}

// Holds the filter/session config state (kept here so switching tabs and back
// preserves the user's filter selections within a session).
function PracticeTab({ db, dispatch }) {
  const [config, setConfig] = useState({
    course: 'all',
    filterBy: 'all', // 'all' | 'unit' | 'topic' — mutually exclusive sub-filter
    unit: 'all',
    topic: 'all',
    difficulty: [], // multi-select; empty = all
    state: ['unanswered', 'incorrect'], // multi-select; empty = all
    shuffleQuestions: true, // randomize question order each session
    shuffleOptions: true,
  })
  const [session, setSession] = useState(null) // null = still on the setup screen

  return (
    <div className="practice-tab">
      {session ? (
        <Practice
          db={db}
          dispatch={dispatch}
          config={config}
          onExit={() => setSession(null)}
        />
      ) : (
        <FilterBar
          db={db}
          config={config}
          setConfig={setConfig}
          onStart={() => setSession(true)}
        />
      )}
    </div>
  )
}
