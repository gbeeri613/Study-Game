import { applyFilters, distinctValues, NONE_VALUE } from '../lib/session.js'
import { courseLabel, difficultyLabel } from '../data/labels.js'
import { IconChevronDown, IconPlay } from './Icons.jsx'

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

// Native select styled with a custom chevron.
function Select({ value, onChange, children }) {
  return (
    <div className="select-wrap">
      <select className="select" value={value} onChange={onChange}>
        {children}
      </select>
      <IconChevronDown size={17} />
    </div>
  )
}

// Segmented control with a sliding active-pill indicator.
function Segmented({ options, value, onChange }) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value))
  const n = options.length
  return (
    <div className="segmented" role="tablist">
      <span
        className="seg-indicator"
        style={{
          width: `calc((100% - 6px) / ${n})`,
          insetInlineStart: `calc(3px + ${idx} * (100% - 6px) / ${n})`,
        }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          className={`seg ${value === o.value ? 'seg-active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

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

// iOS-style switch bound to a boolean.
function SwitchRow({ checked, onChange, children }) {
  return (
    <label className="switch-row">
      <span>{children}</span>
      <span className="switch">
        <input type="checkbox" checked={checked} onChange={onChange} />
        <span className="switch-track" />
        <span className="switch-thumb" />
      </span>
    </label>
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
      <h2>תרגול חדש</h2>

      <div className="filter-fields">
        {/* Course */}
        <div className="field">
          <span className="field-label">קורס</span>
          <Select
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
          </Select>
        </div>

        {/* Sub-filter: by unit OR by topic (mutually exclusive) */}
        <div className="field">
          <span className="field-label">סינון לפי</span>
          <Segmented options={SUBFILTER_MODES} value={config.filterBy} onChange={setMode} />

          {config.filterBy === 'unit' && (
            <div className="subfilter-select">
              <Select
                key="unit-select"
                value={config.unit}
                onChange={(e) => setConfig({ ...config, unit: e.target.value })}
              >
                <option value="all">כל היחידות</option>
                {subValues.map((v) => (
                  <option key={v} value={v}>
                    {optionLabel('unit', v)}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {config.filterBy === 'topic' && (
            <div className="subfilter-select">
              <Select
                key="topic-select"
                value={config.topic}
                onChange={(e) => setConfig({ ...config, topic: e.target.value })}
              >
                <option value="all">כל הנושאים</option>
                {subValues.map((v) => (
                  <option key={v} value={v}>
                    {optionLabel('topic', v)}
                  </option>
                ))}
              </Select>
            </div>
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
            options={difficultyValues.map((v) => ({
              value: v,
              label: optionLabel('difficulty', v),
            }))}
            selected={config.difficulty}
            onChange={(difficulty) => setConfig({ ...config, difficulty })}
          />
        </div>
      </div>

      <div className="switch-group">
        <SwitchRow
          checked={config.shuffleQuestions}
          onChange={(e) => setConfig({ ...config, shuffleQuestions: e.target.checked })}
        >
          ערבב את סדר השאלות
        </SwitchRow>
        <SwitchRow
          checked={config.shuffleOptions}
          onChange={(e) => setConfig({ ...config, shuffleOptions: e.target.checked })}
        >
          ערבב את סדר התשובות בכל שאלה
        </SwitchRow>
      </div>

      <div className="filter-footer">
        <span className="count-pill">
          <strong>{count}</strong> שאלות תואמות
        </span>
        <button
          className="btn btn-primary btn-start"
          disabled={count === 0}
          onClick={onStart}
        >
          <IconPlay size={17} />
          התחל תרגול
        </button>
      </div>
    </div>
  )
}
