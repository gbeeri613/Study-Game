// Pure helpers for building a practice session: filtering, ordering, and
// per-question option shuffling with a correct index mapping.

// ---- Filtering -------------------------------------------------------------

// Missing filter-axis values are bucketed under this sentinel in the UI.
export const NONE_VALUE = '__none__'

function axisValue(q, axis) {
  const v = q[axis]
  return v === undefined || v === null || v === '' ? NONE_VALUE : v
}

// filters: {
//   unit, topic -> value | 'all'   (unit compared as string)
//   course     -> string[]   (multi-select; empty = all)
//   difficulty -> string[]   (multi-select; empty = all)
//   state      -> string[]   (multi-select of buckets: 'unanswered' |
//                             'correct' | 'incorrect'; empty = all)
// }
export function applyFilters(questions, filters = {}) {
  return questions.filter((q) => {
    // Single-value axes.
    for (const axis of ['unit', 'topic']) {
      const want = filters[axis]
      if (want && want !== 'all') {
        // compare as strings so numeric `unit` and dropdown values line up
        if (String(axisValue(q, axis)) !== String(want)) return false
      }
    }

    // Course: multi-select. Empty (or missing) means no filter.
    const courses = filters.course
    if (Array.isArray(courses) && courses.length > 0) {
      if (!courses.map(String).includes(String(axisValue(q, 'course')))) return false
    }

    // Difficulty: multi-select. Empty (or missing) means no filter.
    const diffs = filters.difficulty
    if (Array.isArray(diffs) && diffs.length > 0) {
      if (!diffs.map(String).includes(String(axisValue(q, 'difficulty')))) return false
    }

    // State: multi-select over answer buckets. Empty means no filter.
    const states = filters.state
    if (Array.isArray(states) && states.length > 0) {
      const bucket = q.answered_at == null ? 'unanswered' : q.correct ? 'correct' : 'incorrect'
      if (!states.includes(bucket)) return false
    }

    return true
  })
}

// Translate the session-setup `config` (single-course, plus optional advanced
// axes) into the multi-select filter shape `applyFilters` expects. Course is a
// single slug here but the filter layer works in arrays, so we wrap it. Only the
// active sub-filter axis (unit OR topic) is forwarded.
export function configToFilters(config) {
  const filters = {
    course: config.course ? [config.course] : [],
    difficulty: config.difficulty || [],
    state: config.state || [],
  }
  if (config.filterBy === 'unit') filters.unit = config.unit
  else if (config.filterBy === 'topic') filters.topic = config.topic
  return filters
}

// Pick which questions make up a capped session. Learning-dense first:
// unanswered, then previously-incorrect, then previously-correct as filler —
// each bucket shuffled — then take the first `count`. `count` falsy = take all.
// (buildSession still shuffles the chosen slice for display order.)
export function selectSessionQuestions(questions, count) {
  const unanswered = []
  const incorrect = []
  const correct = []
  for (const q of questions) {
    if (q.answered_at == null) unanswered.push(q)
    else if (q.correct) correct.push(q)
    else incorrect.push(q)
  }
  const ordered = [...shuffled(unanswered), ...shuffled(incorrect), ...shuffled(correct)]
  return count && count > 0 ? ordered.slice(0, count) : ordered
}

// Distinct values present for an axis (for populating dropdowns), sorted.
export function distinctValues(questions, axis) {
  const set = new Set()
  let hasNone = false
  for (const q of questions) {
    const v = axisValue(q, axis)
    if (v === NONE_VALUE) hasNone = true
    else set.add(v)
  }
  const values = Array.from(set)
  // numeric-aware sort for units
  values.sort((a, b) => {
    const na = Number(a)
    const nb = Number(b)
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
    return String(a).localeCompare(String(b), 'he')
  })
  if (hasNone) values.push(NONE_VALUE)
  return values
}

// ---- Ordering + option shuffle --------------------------------------------

function shuffled(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Build the ordered list of session items. Each item wraps a question with an
// `order` array: the sequence of ORIGINAL option indices in display order.
//
//   order[displayIndex] = originalIndex
//
// So if the user taps display slot d, the original option chosen is order[d].
// With shuffleOptions=false, order is the identity [0,1,2,...].
export function buildSession(questions, { order = 'sequential', shuffleOptions = false } = {}) {
  const base = order === 'shuffle' ? shuffled(questions) : questions.slice()
  return base.map((q) => {
    const identity = q.options.map((_, i) => i)
    return {
      question: q,
      order: shuffleOptions ? shuffled(identity) : identity,
    }
  })
}

// Given a session item and the display slot the user tapped, return the
// original option index (what gets stored in last_choice and compared to
// question.answer).
export function displayToOriginal(item, displayIndex) {
  return item.order[displayIndex]
}

// Inverse: where does an original option index sit in the display order?
// Used to highlight the correct answer's display slot on reveal.
export function originalToDisplay(item, originalIndex) {
  return item.order.indexOf(originalIndex)
}
