import { useMemo, useState } from 'react'
import { applyFilters, configToFilters, distinctValues, NONE_VALUE } from '../lib/session.js'
import { courseLabel, difficultyLabel } from '../data/labels.js'
import {
  IconChevronDown,
  IconChevronRight,
  IconPlayLeft,
  IconCheck,
  IconX,
  IconInbox,
  IconStar,
} from './Icons.jsx'

// Slider stops. Top step is 50; a smaller pool caps the max at the pool size
// and greys out the higher steps.
const BASE_STEPS = [10, 20, 30, 40, 50]

// The three answer-state buckets, each with an icon. No "all" chip: selection
// is an explicit set of these three. All chips share the primary accent tone.
const STATE_OPTIONS = [
  { value: 'unanswered', label: 'לא ענית', Icon: IconInbox },
  { value: 'incorrect', label: 'טעית', Icon: IconX },
  { value: 'correct', label: 'צדקת', Icon: IconCheck },
]

const SUBFILTER_MODES = [
  { value: 'all', label: 'הכל' },
  { value: 'unit', label: 'לפי יחידה' },
  { value: 'topic', label: 'לפי נושא' },
]

function optionLabel(axis, value) {
  if (value === NONE_VALUE) return 'ללא'
  if (axis === 'difficulty') return difficultyLabel(value)
  if (axis === 'unit') return `יחידה ${value}`
  return value
}

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

// Plain multi-select pills (for difficulty), empty = all.
function PillMultiSelect({ options, selected, onChange }) {
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
        הכל
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

// Build the slider stops for a given pool. Base steps up to 50 are enabled
// stops; a pool larger than 50 adds a final enabled "all" stop at the pool
// size, and a pool smaller than 50 inserts the pool as the top enabled stop
// while the base steps above it render greyed and can't be dragged past. The
// stop whose value equals the pool is the "all" stop (its label carries הכל).
function buildStops(pool) {
  const cap = Math.min(pool, 50)
  const enabled = BASE_STEPS.filter((t) => t <= cap)
  if (pool > 0 && !enabled.includes(pool)) enabled.push(pool) // the "all" stop
  const disabled = BASE_STEPS.filter((t) => t > cap)
  const ticks = [...new Set([...enabled, ...disabled])].sort((a, b) => a - b)
  let enabledMaxIdx = 0
  ticks.forEach((t, i) => {
    if (t <= cap || t === pool) enabledMaxIdx = i
  })
  return { ticks, enabledMaxIdx }
}

// Labels for the "all" stop (value === pool): compact ticks just read הכל,
// while the head readout keeps the number for context, e.g. "137 (הכל)".
const tickLabel = (t, pool) => (t === pool ? 'הכל' : t)
const headLabel = (t, pool) => (t === pool ? `הכל (${t})` : t)

// Stepped question-count slider — a real draggable range input (touch + mouse +
// keyboard) that snaps to discrete stops. See buildStops for how the stops (and
// the trailing "all" stop) are derived.
function CountSlider({ pool, value, onChange }) {
  const { allTicks, enabledMaxIdx } = useMemo(() => {
    const { ticks, enabledMaxIdx } = buildStops(pool)
    return { allTicks: ticks, enabledMaxIdx }
  }, [pool])

  const n = allTicks.length
  const denom = Math.max(1, n - 1)
  const selIdx = Math.max(0, allTicks.indexOf(value))
  const frac = (i) => i / denom
  // RTL: the smallest step sits on the RIGHT, growing leftward — so position is
  // mirrored (1 - frac). Thumb travels between 11px insets (its own radius) so
  // it never clips the rail ends; the fill is anchored to the right edge.
  const pos = (i) => `calc(11px + ${1 - frac(i)} * (100% - 22px))`

  function handleInput(e) {
    let idx = Number(e.target.value)
    if (idx > enabledMaxIdx) idx = enabledMaxIdx // can't drag past the pool
    onChange(allTicks[idx])
  }

  return (
    <div className="qslider">
      <div className="qslider-head">
        <span className="field-label">מספר שאלות</span>
        <span className="qslider-count">{headLabel(value, pool)}</span>
      </div>
      <div className="qslider-rail">
        <div className="qslider-line" />
        <div className="qslider-line-fill" style={{ width: `calc(${frac(selIdx)} * (100% - 22px))` }} />
        <div className="qslider-thumb" style={{ left: pos(selIdx) }} />
        <input
          type="range"
          className="qslider-input"
          min={0}
          max={n - 1}
          step={1}
          value={selIdx}
          onChange={handleInput}
          aria-label="מספר שאלות בתרגול"
          aria-valuetext={`${value} שאלות`}
        />
        <div className="qslider-ticks">
          {allTicks.map((t, i) => (
            <span
              key={t}
              className={`qslider-tick ${t === value ? 'qslider-tick-active' : ''} ${
                i > enabledMaxIdx ? 'qslider-tick-disabled' : ''
              }`}
              style={{ left: pos(i) }}
            >
              {tickLabel(t, pool)}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function SessionSetup({ db, config, setConfig, onStart, onCancel }) {
  const [showAdvanced, setShowAdvanced] = useState(false)

  const courseValues = useMemo(() => distinctValues(db.questions, 'course'), [db.questions])

  // Questions belonging to the currently selected course (advanced axes scope
  // to this set).
  const scoped = useMemo(() => {
    if (!config.course) return []
    return db.questions.filter((q) => {
      const v = q.course === undefined || q.course === null || q.course === '' ? NONE_VALUE : q.course
      return String(v) === String(config.course)
    })
  }, [db.questions, config.course])

  const subValues = distinctValues(scoped, config.filterBy === 'topic' ? 'topic' : 'unit')
  const difficultyValues = distinctValues(scoped, 'difficulty')

  // Pool = questions matching the full current selection (course + state + adv).
  const pool = useMemo(() => applyFilters(db.questions, configToFilters(config)).length, [db.questions, config])

  // The same pool ignoring the quality filter. Two jobs: it's the denominator
  // in the toggle's hint ("12 of 137"), and it tells an empty result apart —
  // "nothing is tagged yet" reads very differently from "you've answered
  // everything", and only this number distinguishes them.
  const poolAll = useMemo(
    () => applyFilters(db.questions, { ...configToFilters(config), highQualityOnly: false }).length,
    [db.questions, config],
  )

  // Resolve the effective count: clamp to the pool and snap to an enabled step.
  const { ticks: stops, enabledMaxIdx } = buildStops(pool)
  const enabledTicks = stops.slice(0, enabledMaxIdx + 1)
  const maxAllowed = enabledTicks.length ? enabledTicks[enabledTicks.length - 1] : 0
  let value = Math.min(config.count, maxAllowed)
  if (!enabledTicks.includes(value) && enabledTicks.length) {
    const below = enabledTicks.filter((t) => t <= value)
    value = below.length ? Math.max(...below) : Math.min(...enabledTicks)
  }

  function setState(next) {
    // Keep at least one bucket selected.
    if (next.length === 0) return
    setConfig({ ...config, state: next })
  }
  function toggleState(v) {
    const has = config.state.includes(v)
    setState(has ? config.state.filter((s) => s !== v) : [...config.state, v])
  }

  function setMode(mode) {
    setConfig({ ...config, filterBy: mode, unit: [], topic: 'all' })
  }

  const advancedActive =
    config.filterBy !== 'all' || (config.difficulty && config.difficulty.length > 0)

  return (
    <div className="setup">
      <header className="setup-header">
        <button className="btn-icon" aria-label="חזרה" onClick={onCancel}>
          <IconChevronRight size={22} />
        </button>
        <h2 className="setup-title">תרגול חדש</h2>
        <span className="setup-header-spacer" />
      </header>

      <div className="card">
        <div className="filter-fields">
          {/* Course — single-select */}
          <div className="field">
            <span className="field-label">קורס</span>
            <Select
              value={config.course}
              onChange={(e) => setConfig({ ...config, course: e.target.value, filterBy: 'all', unit: [], topic: 'all' })}
            >
              {courseValues.map((v) => (
                <option key={v} value={v}>
                  {courseLabel(v)}
                </option>
              ))}
            </Select>
          </div>

          {/* State — icon chips, no "all" */}
          <div className="field">
            <span className="field-label">מצב</span>
            <div className="chip-group">
              {STATE_OPTIONS.map(({ value: v, label, Icon }) => {
                const active = config.state.includes(v)
                return (
                  <button
                    key={v}
                    type="button"
                    className={`chip-toggle chip-state ${active ? 'chip-toggle-active' : ''}`}
                    onClick={() => toggleState(v)}
                  >
                    <span className="chip-badge">
                      <Icon size={14} />
                    </span>
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* High-quality filter. The signal is the community's (quality_count >=
            QUALITY_THRESHOLD), not the user's own tag — tagging a question
            yourself never makes it show up here. */}
        <div className="switch-group">
          <label className="switch-row">
            <span className="switch-label">
              <span className="switch-title">
                <IconStar size={15} />
                רק שאלות איכותיות
              </span>
              <span className="switch-hint">
                {config.highQualityOnly
                  ? `${pool} מתוך ${poolAll} שאלות בבחירה הזו`
                  : 'שאלות שסטודנטים סימנו כאיכותיות'}
              </span>
            </span>
            <span className="switch">
              <input
                type="checkbox"
                // Without this the accessible name is the whole label — hint
                // included — so it would change every time the count changes.
                aria-label="רק שאלות איכותיות"
                checked={!!config.highQualityOnly}
                onChange={(e) => setConfig({ ...config, highQualityOnly: e.target.checked })}
              />
              <span className="switch-track" />
              <span className="switch-thumb" />
            </span>
          </label>
        </div>

        <button
          type="button"
          className={`advanced-toggle ${showAdvanced ? 'advanced-toggle-open' : ''}`}
          aria-expanded={showAdvanced}
          onClick={() => setShowAdvanced((s) => !s)}
        >
          אפשרויות מתקדמות
          {advancedActive && !showAdvanced && <span className="advanced-dot" />}
          <IconChevronDown size={16} />
        </button>

        {showAdvanced && (
          <div className="advanced-panel">
            <div className="field">
              <span className="field-label">סינון לפי</span>
              <Segmented options={SUBFILTER_MODES} value={config.filterBy} onChange={setMode} />

              {config.filterBy === 'unit' && (
                <div className="subfilter-select">
                  <PillMultiSelect
                    options={subValues.map((v) => ({ value: v, label: optionLabel('unit', v) }))}
                    selected={config.unit}
                    onChange={(unit) => setConfig({ ...config, unit })}
                  />
                </div>
              )}

              {config.filterBy === 'topic' && (
                <div className="subfilter-select">
                  <Select value={config.topic} onChange={(e) => setConfig({ ...config, topic: e.target.value })}>
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

            {difficultyValues.length > 0 && (
              <div className="field">
                <span className="field-label">רמת קושי</span>
                <PillMultiSelect
                  options={difficultyValues.map((v) => ({ value: v, label: optionLabel('difficulty', v) }))}
                  selected={config.difficulty}
                  onChange={(difficulty) => setConfig({ ...config, difficulty })}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {pool === 0 && config.highQualityOnly && poolAll > 0 ? (
        // Empty *because of* the quality filter, not because the pool is
        // exhausted. Early on this is the common case — few questions have
        // reached QUALITY_THRESHOLD — so it gets its own copy and a one-tap way
        // out, rather than the misleading "you answered everything" state.
        <div className="card empty-state setup-empty">
          <span className="empty-icon">
            <IconStar size={32} />
          </span>
          <h2>אין עדיין שאלות איכותיות כאן</h2>
          <p>
            עוד לא סומנו מספיק שאלות בבחירה הזו. כבו את הסינון כדי לתרגל את כל{' '}
            {poolAll} השאלות.
          </p>
          <button
            className="btn"
            onClick={() => setConfig({ ...config, highQualityOnly: false })}
          >
            כבה סינון איכות
          </button>
        </div>
      ) : pool === 0 ? (
        <div className="card empty-state setup-empty setup-empty-success">
          <span className="empty-icon empty-icon-success">
            <IconCheck size={32} />
          </span>
          <h2>כל הכבוד!</h2>
          <p>כבר ענית נכון על כל השאלות בבחירה הזו. נסו קורס אחר או סמנו מצב נוסף כדי להמשיך לתרגל.</p>
        </div>
      ) : (
        <div className="card setup-launch">
          <CountSlider
            pool={pool}
            value={value}
            onChange={(count) => setConfig({ ...config, count })}
          />
          <button
            className="btn btn-primary btn-start"
            onClick={() => onStart({ ...config, count: value })}
          >
            התחל תרגול ({value})
            <IconPlayLeft size={17} />
          </button>
        </div>
      )}
    </div>
  )
}
