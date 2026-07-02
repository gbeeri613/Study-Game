import { applyFilters, distinctValues, NONE_VALUE } from '../lib/session.js'
import { courseLabel, difficultyLabel } from '../data/labels.js'

// Display label for a dropdown value on a given axis.
function optionLabel(axis, value) {
  if (value === NONE_VALUE) return 'ללא'
  if (axis === 'course') return courseLabel(value)
  if (axis === 'difficulty') return difficultyLabel(value)
  if (axis === 'unit') return `יחידה ${value}`
  return value
}

const STATE_OPTIONS = [
  { value: 'all', label: 'הכל' },
  { value: 'unanswered', label: 'לא נענו' },
  { value: 'answered', label: 'נענו' },
  { value: 'incorrect', label: 'שגויות' },
  { value: 'correct', label: 'נכונות' },
]

function AxisSelect({ axis, label, db, config, setConfig }) {
  const values = distinctValues(db.questions, axis)
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select
        className="select"
        value={config[axis]}
        onChange={(e) => setConfig({ ...config, [axis]: e.target.value })}
      >
        <option value="all">הכל</option>
        {values.map((v) => (
          <option key={v} value={v}>
            {optionLabel(axis, v)}
          </option>
        ))}
      </select>
    </label>
  )
}

export default function FilterBar({ db, config, setConfig, onStart }) {
  const matching = applyFilters(db.questions, config)
  const count = matching.length

  return (
    <div className="filter-bar card">
      <h2>בחר תרגול</h2>

      <div className="fields-grid">
        <AxisSelect axis="course" label="קורס" db={db} config={config} setConfig={setConfig} />
        <AxisSelect axis="unit" label="יחידה" db={db} config={config} setConfig={setConfig} />
        <AxisSelect axis="topic" label="נושא" db={db} config={config} setConfig={setConfig} />
        <AxisSelect axis="difficulty" label="רמת קושי" db={db} config={config} setConfig={setConfig} />

        <label className="field">
          <span className="field-label">מצב</span>
          <select
            className="select"
            value={config.state}
            onChange={(e) => setConfig({ ...config, state: e.target.value })}
          >
            {STATE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">סדר</span>
          <select
            className="select"
            value={config.order}
            onChange={(e) => setConfig({ ...config, order: e.target.value })}
          >
            <option value="sequential">רציף</option>
            <option value="shuffle">מעורבב</option>
          </select>
        </label>
      </div>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={config.shuffleOptions}
          onChange={(e) => setConfig({ ...config, shuffleOptions: e.target.checked })}
        />
        <span>ערבב את סדר התשובות בכל שאלה</span>
      </label>

      <div className="filter-footer">
        <span className="count-pill">{count} שאלות תואמות</span>
        <button className="btn btn-primary" disabled={count === 0} onClick={onStart}>
          התחל תרגול
        </button>
      </div>
    </div>
  )
}
