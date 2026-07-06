import { useMemo } from 'react'
import { courseLabel } from '../data/labels.js'
import { IconPlayLeft, IconTarget2, IconChevronRight, IconSparkles } from './Icons.jsx'

// Grade → colour band. Drives the ring stroke and the score number colour.
function gradeBand(grade) {
  if (grade >= 100) return { color: '#b072ff', celebrate: true } // purple
  if (grade >= 90) return { color: '#3ddba0' } // rich green
  if (grade >= 80) return { color: '#86d97a' } // pale green
  if (grade >= 70) return { color: '#ffcf4a' } // yellow
  if (grade >= 60) return { color: '#ff9f45' } // orange
  return { color: '#ff6b6b' } // red
}

function summaryTitle(grade) {
  if (grade >= 90) return 'מעולה!'
  if (grade >= 75) return 'כל הכבוד!'
  if (grade >= 50) return 'עבודה טובה!'
  return 'ממשיכים לתרגל!'
}

// Animated score ring showing the session grade (0–100), coloured by band.
function ScoreRing({ grade, color }) {
  const R = 52
  const C = 2 * Math.PI * R
  return (
    <div className="score-ring">
      <svg viewBox="0 0 120 120">
        <circle className="ring-track" cx="60" cy="60" r={R} />
        <circle
          className="ring-fill"
          cx="60"
          cy="60"
          r={R}
          stroke={color}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - grade / 100)}
          style={{ '--ring-c': C }}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <div className="score-ring-label">
        <span className="score-grade-cap">ציון</span>
        <span className="score-grade" style={{ color }}>
          {grade}
        </span>
      </div>
    </div>
  )
}

// A small, tasteful confetti burst — only for a perfect score.
function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => {
        const a = Math.random() * Math.PI * 2
        const dist = 55 + Math.random() * 75
        return {
          tx: Math.cos(a) * dist,
          ty: Math.sin(a) * dist - 15,
          rot: Math.round(Math.random() * 420 - 210),
          color: ['#b072ff', '#4d8dff', '#3ddba0', '#ffcf4a', '#ff6b6b'][i % 5],
          delay: Math.random() * 0.12,
        }
      }),
    [],
  )
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          style={{
            '--tx': `${p.tx}px`,
            '--ty': `${p.ty}px`,
            '--rot': `${p.rot}deg`,
            background: p.color,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </div>
  )
}

export default function Summary({ result, db, onHome, onAgain, onReview }) {
  const { answered, firstTryCorrect, mistakeIds, config, pointsEarned = 0 } = result

  const grade = answered > 0 ? Math.round((firstTryCorrect / answered) * 100) : 0
  const band = gradeBand(grade)
  const mistakes = mistakeIds.length
  const gainedPoints = Math.max(0, pointsEarned)
  const wrong = answered - firstTryCorrect

  // Course coverage after this session (single-course sessions).
  const coverage = useMemo(() => {
    const slug = config?.course
    if (!slug) return null
    let total = 0
    let done = 0
    for (const q of db.questions) {
      if (String(q.course ?? '') !== String(slug)) continue
      total += 1
      if (q.answered_at != null) done += 1
    }
    if (total === 0) return null
    return { total, done, pct: Math.round((done / total) * 100), label: courseLabel(slug) }
  }, [db.questions, config])

  return (
    <div className="card summary-card">
      {band.celebrate && <Confetti />}
      <ScoreRing grade={grade} color={band.color} />
      <h2 className="summary-title">{summaryTitle(grade)}</h2>
      <p className="summary-sub">
        ענית נכון על <strong>{firstTryCorrect}</strong> מתוך <strong>{answered}</strong>{' '}
        {answered === 1 ? 'שאלה' : 'שאלות'} בניסיון הראשון
      </p>

      {answered > 0 && (
        <div className="sum-points">
          <span className="sum-points-icon">
            <IconSparkles size={18} />
          </span>
          <span className="sum-points-value">+{gainedPoints}</span>
          <span className="sum-points-unit">נק׳</span>
          <span className="sum-points-break">
            {firstTryCorrect} נכונות
            {wrong > 0 ? ` · ${wrong} שגויות` : ''}
          </span>
        </div>
      )}

      {coverage && (
        <div className="sum-coverage">
          <div className="sum-coverage-head">
            <span className="sum-coverage-icon">
              <IconTarget2 size={17} />
            </span>
            <span>
              כיסית <strong>{coverage.pct}%</strong> מ{coverage.label}
            </span>
            <span className="sum-coverage-frac">
              {coverage.done}/{coverage.total}
            </span>
          </div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${coverage.pct}%` }} />
          </div>
        </div>
      )}

      <div className="summary-actions">
        <button className="btn btn-primary" onClick={onAgain}>
          תרגול נוסף
          <IconPlayLeft size={17} />
        </button>
        {mistakes > 0 && (
          <button className="btn" onClick={() => onReview(mistakeIds)}>
            תרגול הטעויות ({mistakes})
          </button>
        )}
        <button className="btn btn-ghost summary-home" onClick={onHome}>
          <IconChevronRight size={18} />
          חזרה לבית
        </button>
      </div>
    </div>
  )
}
