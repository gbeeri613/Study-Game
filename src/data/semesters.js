// ---------------------------------------------------------------------------
// Semesters.
//
// The canonical ordered list of semesters the app knows about, OLDEST FIRST.
// Order matters: it is what "the newest semester with content" means when the
// admin's default semester is still empty (see resolveSemester in App.jsx).
//
// This list is deliberately the ONLY place a semester is declared — the
// database has no check constraint on `courses.semester`, so inventing a new
// one is a one-line edit here with no migration.
//
// A semester appears in the Home selector only once it actually has questions,
// so listing a future semester below does NOT expose it to users. It only makes
// it choosable in the admin screen (for the import picker and the default).
//
// >>> To add a semester, add one line below. <<<
// ---------------------------------------------------------------------------

export const SEMESTERS = ['26-2', '26-3', '27-1', '27-2', '27-3', '28-1']

// Semesters are displayed as their raw code ('26-2'). This indirection exists
// so a nicer label (e.g. an academic-year transliteration) can be introduced
// later in one place.
export function semesterLabel(value) {
  if (value == null || value === '') return 'ללא סמסטר'
  return value
}

// Sort key for a semester: its position in SEMESTERS, with unknown values
// sorted before everything known (they are almost certainly stale data).
export function semesterOrder(value) {
  const i = SEMESTERS.indexOf(value)
  return i === -1 ? -1 : i
}

// The newest of the given semesters, by SEMESTERS order. Null when empty.
export function newestSemester(values) {
  let best = null
  for (const v of values) {
    if (best == null || semesterOrder(v) > semesterOrder(best)) best = v
  }
  return best
}
