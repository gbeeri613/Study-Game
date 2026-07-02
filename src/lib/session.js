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
//   course, unit, topic, difficulty  -> value | 'all'   (unit compared as string)
//   state -> 'all' | 'unanswered' | 'answered' | 'incorrect' | 'correct'
// }
export function applyFilters(questions, filters = {}) {
  return questions.filter((q) => {
    for (const axis of ['course', 'unit', 'topic', 'difficulty']) {
      const want = filters[axis]
      if (want && want !== 'all') {
        // compare as strings so numeric `unit` and dropdown values line up
        if (String(axisValue(q, axis)) !== String(want)) return false
      }
    }
    const state = filters.state || 'all'
    if (state === 'unanswered' && q.answered_at != null) return false
    if (state === 'answered' && q.answered_at == null) return false
    if (state === 'incorrect' && !(q.answered_at != null && q.correct === false)) return false
    if (state === 'correct' && !(q.answered_at != null && q.correct === true)) return false
    return true
  })
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
