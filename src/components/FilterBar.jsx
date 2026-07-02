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
  { value: 'unanswered', label: 'לא נענו' },
  { value: 'incorrect', label: 'נענו שגוי' },
  { value: 'correct', label: 'נענו נכון' },
]

const SUBFILTER_MODES = [
  { value: 'all', label: 'הכל' },
  { value: 'unit', label: 'לפי יחידה' },
  { value: 'topic', label: 'לפי נושא' },
]

// Multi-select rendered as toggle pills. An empty selection means "all", shown
// by highlighting the leading "הכל" pill.
function PillMultiSelect({ options, selected, onChange, allLabel = 'הכל' }) {
  function toggle(value) {
    if (selected.includes(value)) onChange(selected.filter((v) => v !== value))
    else onChange([...selected, value])
  }
  return (
    <div className="chip-group">
      <button
        type="button"
        className={`chip-toggle ${selected.length === 0 ? 'chip-toggle-active' : ''}`}
        onClick={() => onChange([])}
      >
        {allLabel}
      </button>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`chip-toggle ${selected.includes(o.value) ? 'chip-toggle-active' : ''}`}
          onClick={() => toggle(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export default function FilterBar({ db, config, setConfig, onStart }) {
  const matching = applyFilters(db.questions, config)
  const count = matching.length

  // Unit / topic / difficulty choices are scoped to the selected course.
  const scoped =
    config.course === 'all'
      ? db.questions
      : db.questions.filter((q) => String(q.course) === String(config.course))

  const courseValues = distinctValues(db.questions, 'course')
  const subValues = distinctValues(scoped, config.filterBy === 'topic' ? 'topic' : 'unit')
  const difficultyValues = distinctValues(scoped, 'difficulty')

  // Switching the sub-filter mode clears whichever axis is no longer active.
  function setMode(mode) {
    setConfig({ ...config, filterBy: mode, unit: 'all', topic: 'all' })
  }

  return (
    <div className="filter-bar card">
      <h2>בחר תרגול</h2>

      <div className="filter-fields">
        {/* Course */}
        <label className="field">
          <span className="field-label">קורס</span>
          <select
            className="select"
            value={config.course}
            onChange={(e) =>
              // reset sub-filter values so stale unit/topic don't apply to a new course
              setConfig({ ...config, course: e.target.value, unit: 'all', topic: 'all' })
            }
          >
            <option value="all">הכל</option>
            {courseValues.map((v) => (
              <option key={v} value={v}>
                {optionLabel('course', v)}
              </option>
            ))}
          </select>
        </label>

        {/* Sub-filter: by unit OR by topic (mutually exclusive) */}
        <div className="field">
          <span className="field-label">סינון לפי</span>
          <div className="segmented" role="tablist">
            {SUBFILTER_MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                role="tab"
                aria-selected={config.filterBy === m.value}
                className={`seg ${config.filterBy === m.value ? 'seg-active' : ''}`}
                onClick={() => setMode(m.value)}
              >
                {m.label}
              </button>
            ))}
          </div>

          {config.filterBy === 'unit' && (
            <select
              key="unit-select"
              className="select subfilter-select"
              value={config.unit}
              onChange={(e) => setConfig({ ...config, unit: e.target.value })}
            >
              <option value="all">כל היחידות</option>
              {subValues.map((v) => (
                <option key={v} value={v}>
                  {optionLabel('unit', v)}
                </option>
              ))}
            </select>
          )}

          {config.filterBy === 'topic' && (
            <select
              key="topic-select"
              className="select subfilter-select"
              value={config.topic}
              onChange={(e) => setConfig({ ...config, topic: e.target.value })}
            >
              <option value="all">כל הנושאים</option>
              {subValues.map((v) => (
                <option key={v} value={v}>
                  {optionLabel('topic', v)}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* State — multi-select */}
        <div className="field">
          <span className="field-label">מצב</span>
          <PillMultiSelect
            options={STATE_OPTIONS}
            selected={config.state}
            onChange={(state) => setConfig({ ...config, state })}
          />
        </div>

        {/* Difficulty — multi-select */}
        <div className="field">
          <span className="field-label">רמת קושי</span>
          <PillMultiSelect
            options={difficultyValues.map((v) => ({ value: v, label: optionLabel('difficulty', v) }))}
            selected={config.difficulty}
            onChange={(difficulty) => setConfig({ ...config, difficulty })}
          />
        </div>
      </div>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={config.shuffleQuestions}
          onChange={(e) => setConfig({ ...config, shuffleQuestions: e.target.checked })}
        />
        <span>ערבב את סדר השאלות</span>
      </label>

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
