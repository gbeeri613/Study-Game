import { useEffect, useReducer, useState } from 'react'
import { loadDb, saveDb, emptyDb } from './lib/storage.js'
import FilterBar from './components/FilterBar.jsx'
import Practice from './components/Practice.jsx'
import Stats from './components/Stats.jsx'
import ImportExport from './components/ImportExport.jsx'
import { makeSeedDb } from './data/seed.js'

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

// Lazy initializer: localStorage if present, else empty (prompts import).
function initDb() {
  return loadDb() || emptyDb()
}

const TABS = [
  { key: 'practice', label: 'תרגול' },
  { key: 'stats', label: 'סטטיסטיקה' },
  { key: 'manage', label: 'ניהול' },
]

export default function App() {
  const [db, dispatch] = useReducer(dbReducer, undefined, initDb)
  const [tab, setTab] = useState('practice')

  // Mirror to localStorage on every db change.
  useEffect(() => {
    saveDb(db)
  }, [db])

  const hasQuestions = db.questions.length > 0

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="app-title">תרגול מבחנים</h1>
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
        {!hasQuestions && tab !== 'manage' ? (
          <EmptyState onLoadSeed={() => dispatch({ type: 'SET_DB', db: makeSeedDb() })} onGoManage={() => setTab('manage')} />
        ) : tab === 'practice' ? (
          <PracticeTab db={db} dispatch={dispatch} />
        ) : tab === 'stats' ? (
          <Stats db={db} />
        ) : (
          <ImportExport db={db} dispatch={dispatch} />
        )}
      </main>
    </div>
  )
}

function EmptyState({ onLoadSeed, onGoManage }) {
  return (
    <div className="empty-state card">
      <h2>אין עדיין שאלות</h2>
      <p>ייבא קובץ JSON של שאלות, או טען שאלות לדוגמה כדי להתחיל מיד.</p>
      <div className="empty-actions">
        <button className="btn btn-primary" onClick={onLoadSeed}>
          טען שאלות לדוגמה
        </button>
        <button className="btn" onClick={onGoManage}>
          ייבוא / ניהול נתונים
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
