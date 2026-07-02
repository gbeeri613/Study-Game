import { useMemo } from 'react'
import { courseLabel } from '../data/labels.js'
import { NONE_VALUE } from '../lib/session.js'

function pct(correct, answered) {
  if (answered === 0) return 0
  return Math.round((correct / answered) * 100)
}

// Aggregate accuracy by a given axis. Returns sorted rows.
function breakdown(questions, axis, labelFn) {
  const map = new Map()
  for (const q of questions) {
    const rawKey = q[axis] === undefined || q[axis] === null || q[axis] === '' ? NONE_VALUE : q[axis]
    const key = String(rawKey)
    if (!map.has(key)) map.set(key, { key, raw: rawKey, total: 0, answered: 0, correct: 0 })
    const row = map.get(key)
    row.total += 1
    if (q.answered_at != null) {
      row.answered += 1
      if (q.correct) row.correct += 1
    }
  }
  const rows = Array.from(map.values())
  rows.sort((a, b) => {
    const na = Number(a.raw)
    const nb = Number(b.raw)
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
    return String(a.raw).localeCompare(String(b.raw), 'he')
  })
  return rows.map((r) => ({ ...r, label: labelFn(r.raw) }))
}

function Bar({ correct, answered, total }) {
  const accuracy = pct(correct, answered)
  return (
    <div className="bar-wrap" title={`${correct}/${answered} נכונות`}>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${accuracy}%` }} />
      </div>
      <span className="bar-label">
        {accuracy}% · {answered}/{total} נענו
      </span>
    </div>
  )
}

function BreakdownSection({ title, rows, labelHeader }) {
  if (rows.length === 0) return null
  return (
    <div className="card stats-section">
      <h3>{title}</h3>
      <div className="breakdown">
        {rows.map((r) => (
          <div className="breakdown-row" key={r.key}>
            <div className="breakdown-name">{r.label}</div>
            <Bar correct={r.correct} answered={r.answered} total={r.total} />
          </div>
        ))}
      </div>
      {labelHeader}
    </div>
  )
}

export default function Stats({ db }) {
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
      remaining: total - answered,
      correct,
      overall: pct(correct, answered),
      byCourse: breakdown(questions, 'course', courseLabel),
      byUnit: breakdown(questions, 'unit', (v) => (v === NONE_VALUE ? 'ללא יחידה' : `יחידה ${v}`)),
      byTopic: breakdown(questions, 'topic', (v) => (v === NONE_VALUE ? 'ללא נושא' : v)),
    }
  }, [db.questions])

  if (stats.total === 0) {
    return (
      <div className="card">
        <p>אין נתונים להצגה. ייבא שאלות תחילה.</p>
      </div>
    )
  }

  return (
    <div className="stats">
      <div className="stats-summary">
        <div className="stat-card">
          <div className="stat-num">{stats.answered}</div>
          <div className="stat-cap">נענו</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{stats.remaining}</div>
          <div className="stat-cap">נותרו</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{stats.overall}%</div>
          <div className="stat-cap">אחוז הצלחה</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{stats.total}</div>
          <div className="stat-cap">סה״כ שאלות</div>
        </div>
      </div>

      <BreakdownSection title="לפי קורס" rows={stats.byCourse} />
      <BreakdownSection title="לפי יחידה" rows={stats.byUnit} />
      <BreakdownSection title="לפי נושא" rows={stats.byTopic} />
    </div>
  )
}
