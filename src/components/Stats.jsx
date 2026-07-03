import { useEffect, useMemo, useState } from 'react'
import { courseLabel } from '../data/labels.js'
import { NONE_VALUE } from '../lib/session.js'

function pct(correct, answered) {
  if (answered === 0) return 0
  return Math.round((correct / answered) * 100)
}

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

function Bar({ correct, answered, total, delay }) {
  const accuracy = pct(correct, answered)
  return (
    <div className="bar-wrap" title={`${correct}/${answered} נכונות`}>
      <div className="bar-track">
        <div
          className="bar-fill"
          style={{ width: `${accuracy}%`, animationDelay: `${delay}ms` }}
        />
      </div>
      <span className="bar-label">
        {accuracy}% · {answered}/{total} נענו
      </span>
    </div>
  )
}

function BreakdownSection({ title, rows }) {
  if (rows.length === 0) return null
  return (
    <div className="card stats-section">
      <h3>{title}</h3>
      <div className="breakdown">
        {rows.map((r, i) => (
          <div className="breakdown-row" key={r.key}>
            <div className="breakdown-name">{r.label}</div>
            <Bar correct={r.correct} answered={r.answered} total={r.total} delay={i * 60} />
          </div>
        ))}
      </div>
    </div>
  )
}

function StatCard({ value, caption, suffix = '', accent = false }) {
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
        <StatCard value={stats.answered} caption="נענו" />
        <StatCard value={stats.remaining} caption="נותרו" />
        <StatCard value={stats.overall} suffix="%" caption="אחוז הצלחה" accent />
        <StatCard value={stats.total} caption="סה״כ שאלות" />
      </div>

      <BreakdownSection title="לפי קורס" rows={stats.byCourse} />
      <BreakdownSection title="לפי יחידה" rows={stats.byUnit} />
      <BreakdownSection title="לפי נושא" rows={stats.byTopic} />
    </div>
  )
}
