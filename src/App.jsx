import { useCallback, useEffect, useReducer, useState } from 'react'
import { loadDb, saveDb, emptyDb } from './lib/storage.js'
import { fetchRemoteDb, recordAnswer, resetAnswers } from './lib/api.js'
import { distinctValues } from './lib/session.js'
import { useAuth, isAdmin } from './lib/useAuth.js'
import Home from './components/Home.jsx'
import SessionSetup from './components/SessionSetup.jsx'
import Practice from './components/Practice.jsx'
import Summary from './components/Summary.jsx'
import ImportExport from './components/ImportExport.jsx'
import Login from './components/Login.jsx'
import { IconCap, IconSparkles, IconAlert, IconChevronRight } from './components/Icons.jsx'

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

const DEFAULT_CONFIG = {
  course: '', // single course slug; resolved to a real course when setup opens
  state: ['unanswered', 'incorrect'], // multi-select of answer buckets (≥1)
  count: 20, // session goal (slider)
  filterBy: 'all', // advanced: 'all' | 'unit' | 'topic'
  unit: 'all',
  topic: 'all',
  difficulty: [], // advanced multi-select; empty = all
}

export default function App() {
  const { user, loading } = useAuth()

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
  // View state machine: home | setup | session | summary | admin.
  const [view, setView] = useState('home')
  const [status, setStatus] = useState('loading')
  const [loadError, setLoadError] = useState(null)

  const [config, setConfig] = useState(DEFAULT_CONFIG)
  // Non-null while running a fixed set of questions (mistakes review).
  const [reviewIds, setReviewIds] = useState(null)
  // Forces Practice to remount (and rebuild its session) on each launch.
  const [sessionNonce, setSessionNonce] = useState(0)
  const [result, setResult] = useState(null)

  // Load the db from Supabase on sign-in; fall back to cache if offline.
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

  useEffect(() => {
    if (status === 'ready') saveDb(db)
  }, [db, status])

  // Dispatch that also persists answer-state changes to Supabase (optimistic).
  const persistDispatch = useCallback(
    (action) => {
      dispatch(action)
      if (action.type === 'RECORD_ANSWER') {
        recordAnswer(user.id, action.id, action.choice, action.correct).catch((err) =>
          console.error('Failed to save answer:', err),
        )
      } else if (action.type === 'RESET_STATE') {
        resetAnswers(user.id, action.ids).catch((err) =>
          console.error('Failed to reset answers:', err),
        )
      }
    },
    [user.id],
  )

  const refresh = useCallback(async () => {
    const remote = await fetchRemoteDb(user.id)
    dispatch({ type: 'SET_DB', db: remote })
    saveDb(remote)
  }, [user.id])

  const admin = isAdmin(user)
  const hasQuestions = db.questions.length > 0

  // Open the setup screen, seeding a valid course selection if needed.
  function openSetup() {
    setReviewIds(null)
    setConfig((c) => {
      const courses = distinctValues(db.questions, 'course')
      if (!c.course || !courses.includes(c.course)) {
        return { ...c, course: courses[0] || '', filterBy: 'all', unit: 'all', topic: 'all' }
      }
      return c
    })
    setView('setup')
  }

  // Launch a practice session — either a filtered slice (ids=null) or a fixed
  // set of questions (mistakes review).
  function beginSession(ids) {
    setReviewIds(ids)
    setSessionNonce((n) => n + 1)
    setView('session')
  }

  function handleComplete(res) {
    setResult(res)
    setView('summary')
  }

  const inFocus = view === 'session' || view === 'summary'

  let body
  if (status === 'loading') {
    body = (
      <div className="loading-block">
        <div className="spinner" />
        <span>טוען נתונים…</span>
      </div>
    )
  } else if (status === 'error') {
    body = (
      <div className="card error-card">
        <span className="error-icon">
          <IconAlert size={32} />
        </span>
        <h2>שגיאה בטעינת הנתונים</h2>
        <p className="muted">{loadError}</p>
      </div>
    )
  } else if (view === 'admin' && admin) {
    body = (
      <div className="tab-panel" key="admin">
        <header className="setup-header">
          <button className="btn-icon" aria-label="חזרה" onClick={() => setView('home')}>
            <IconChevronRight size={22} />
          </button>
          <h2 className="setup-title">ניהול נתונים</h2>
          <span className="setup-header-spacer" />
        </header>
        <ImportExport db={db} dispatch={persistDispatch} onRefresh={refresh} />
      </div>
    )
  } else if (!hasQuestions) {
    body = <EmptyState admin={admin} onGoManage={() => setView('admin')} />
  } else if (view === 'session') {
    body = (
      <Practice
        key={sessionNonce}
        db={db}
        dispatch={persistDispatch}
        config={config}
        overrideQuestionIds={reviewIds}
        onComplete={handleComplete}
        onExit={() => setView('home')}
      />
    )
  } else if (view === 'summary' && result) {
    body = (
      <Summary
        result={result}
        db={db}
        onHome={() => setView('home')}
        onAgain={() => beginSession(null)}
        onReview={(ids) => beginSession(ids)}
      />
    )
  } else if (view === 'setup') {
    body = (
      <SessionSetup
        db={db}
        config={config}
        setConfig={setConfig}
        onStart={(cfg) => {
          setConfig(cfg)
          beginSession(null)
        }}
        onCancel={() => setView('home')}
      />
    )
  } else {
    body = (
      <Home
        db={db}
        user={user}
        admin={admin}
        onStart={openSetup}
        onOpenAdmin={() => setView('admin')}
      />
    )
  }

  return (
    <div className="app app-no-nav" data-focus={inFocus || undefined}>
      <main className="content">{body}</main>
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
          ? 'מאגר השאלות ריק. ייבא שאלות דרך מסך הניהול.'
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
