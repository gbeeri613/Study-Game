import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { loadDb, saveDb, emptyDb } from './lib/storage.js'
import {
  fetchRemoteDb,
  recordAnswer,
  resetAnswers,
  upsertProfile,
  setTag,
  clearTag,
  claimOnboarding,
  dismissOnboarding,
} from './lib/api.js'
import { distinctValues } from './lib/session.js'
import { TAG_REWARD, ONBOARDING_REWARD } from './lib/points.js'
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

    case 'TAG_QUESTION': {
      // action: { id, tag ('wrong' | 'quality') }
      // The reward is granted server-side by a trigger, once per (user,
      // question) ever. Mirror that here so the total moves immediately — but
      // only on the FIRST tag, so switching tags doesn't animate points that
      // the server won't actually grant.
      let earned = 0
      const questions = db.questions.map((q) => {
        if (q.id !== action.id) return q
        if (!q.tag_rewarded) earned = TAG_REWARD
        return { ...q, my_tag: action.tag, tag_rewarded: true }
      })
      return { ...db, questions, rewards_total: (db.rewards_total ?? 0) + earned }
    }

    case 'CLEAR_TAG': {
      // Retracting a tag never claws back the reward — matching the server.
      const questions = db.questions.map((q) =>
        q.id === action.id ? { ...q, my_tag: null } : q,
      )
      return { ...db, questions }
    }

    case 'ONBOARDING_DONE':
      return {
        ...db,
        onboarded_at: db.onboarded_at ?? new Date().toISOString(),
        rewards_total: (db.rewards_total ?? 0) + (db.onboarded_at ? 0 : ONBOARDING_REWARD),
      }

    case 'ONBOARDING_SKIP':
      return { ...db, onboarded_at: db.onboarded_at ?? new Date().toISOString() }

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
  unit: [], // multi-select of units; empty = all
  topic: 'all',
  difficulty: [], // advanced multi-select; empty = all
  highQualityOnly: false, // keep only questions the community marked as good
}

// ---- history-backed navigation ---------------------------------------------
// The app has no router by design. To make the phone/browser Back button work
// (instead of exiting the app), we mirror the `view` state machine into the
// History API. Every sub-screen lives one level above `home`: navigating
// home→sub pushes a history entry (Back returns home), while moves *between*
// sub-screens replace it (the stack never grows, so Back from a finished
// summary won't drop you into the completed session). Depth drives push vs.
// replace.
const VIEW_DEPTH = { home: 0, setup: 1, session: 1, summary: 1, admin: 1 }

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

  // Mirror the user's Google name/avatar into `profiles` so they show up on the
  // leaderboard. Fire-and-forget; failure just means a stale display name.
  useEffect(() => {
    upsertProfile(user).catch((err) => console.error('Failed to save profile:', err))
  }, [user])

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
      } else if (action.type === 'TAG_QUESTION') {
        setTag(user.id, action.id, action.tag).catch((err) =>
          console.error('Failed to save tag:', err),
        )
      } else if (action.type === 'CLEAR_TAG') {
        clearTag(user.id, action.id).catch((err) =>
          console.error('Failed to clear tag:', err),
        )
      } else if (action.type === 'ONBOARDING_DONE') {
        claimOnboarding().catch((err) =>
          console.error('Failed to claim onboarding reward:', err),
        )
      } else if (action.type === 'ONBOARDING_SKIP') {
        dismissOnboarding().catch((err) =>
          console.error('Failed to dismiss onboarding:', err),
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

  // Keep the latest view available to the (stable) navigate callback without
  // making it depend on `view`.
  const viewRef = useRef(view)
  useEffect(() => {
    viewRef.current = view
  }, [view])

  // Normalize the current history entry to `home` on load. The app always boots
  // at home, but history.state survives a page reload — this discards any stale
  // entry so Back has a clean home base to return to.
  useEffect(() => {
    window.history.replaceState({ view: 'home' }, '')
  }, [])

  // The Back button (hardware or browser) fires popstate; derive the view from
  // the restored entry.
  useEffect(() => {
    function onPop(e) {
      setView((e.state && e.state.view) || 'home')
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Forward navigation: push when going deeper (home→sub) so Back returns to the
  // previous screen; replace when moving laterally between sub-screens so the
  // history stack stays shallow.
  const navigate = useCallback((next) => {
    const prev = viewRef.current
    if (next === prev) return
    const method =
      (VIEW_DEPTH[next] ?? 0) > (VIEW_DEPTH[prev] ?? 0) ? 'pushState' : 'replaceState'
    window.history[method]({ view: next }, '')
    viewRef.current = next
    setView(next)
  }, [])

  // Back navigation for in-app Cancel/Exit/Home buttons — routed through history
  // so on-screen Back behaves identically to the device Back button.
  const goBack = useCallback(() => window.history.back(), [])

  const admin = isAdmin(user)
  const hasQuestions = db.questions.length > 0

  // Open the setup screen. If a course is passed (from a Home card), preselect
  // it; otherwise keep/repair the current selection.
  function openSetup(courseSlug) {
    setReviewIds(null)
    setConfig((c) => {
      const courses = distinctValues(db.questions, 'course').map(String)
      let course = courseSlug != null && courses.includes(String(courseSlug)) ? courseSlug : c.course
      if (!course || !courses.includes(String(course))) course = courses[0] || ''
      return { ...c, course, filterBy: 'all', unit: [], topic: 'all' }
    })
    navigate('setup')
  }

  // Launch a practice session — either a filtered slice (ids=null) or a fixed
  // set of questions (mistakes review).
  function beginSession(ids) {
    setReviewIds(ids)
    setSessionNonce((n) => n + 1)
    navigate('session')
  }

  function handleComplete(res) {
    setResult(res)
    navigate('summary')
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
          <button className="btn-icon" aria-label="חזרה" onClick={goBack}>
            <IconChevronRight size={22} />
          </button>
          <h2 className="setup-title">ניהול נתונים</h2>
          <span className="setup-header-spacer" />
        </header>
        <ImportExport db={db} dispatch={persistDispatch} onRefresh={refresh} />
      </div>
    )
  } else if (!hasQuestions) {
    body = <EmptyState admin={admin} onGoManage={() => navigate('admin')} />
  } else if (view === 'session') {
    body = (
      <Practice
        key={sessionNonce}
        db={db}
        dispatch={persistDispatch}
        config={config}
        overrideQuestionIds={reviewIds}
        onComplete={handleComplete}
        onExit={goBack}
      />
    )
  } else if (view === 'summary' && result) {
    body = (
      <Summary
        result={result}
        db={db}
        onHome={goBack}
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
        onCancel={goBack}
      />
    )
  } else {
    body = (
      <Home
        db={db}
        user={user}
        admin={admin}
        dispatch={persistDispatch}
        onStart={openSetup}
        onOpenAdmin={() => navigate('admin')}
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
