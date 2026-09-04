// ---------------------------------------------------------------------------
// Subject (course) labels.
//
// Course names now live in the DATABASE (the `courses` table, one row per slug
// carrying its Hebrew label and its semester) and are set when the course is
// created during import. Pass `db.courses` to courseLabel() and it will use
// them.
//
// The map below is only a FALLBACK, kept for two cases: a slug whose course row
// is somehow missing, and any call site that hasn't got `db.courses` to hand.
// Migration 0006 seeds the table from exactly these values, so for the courses
// listed here the two agree by construction.
//
// >>> Do NOT add new courses here. Create them in the admin import screen. <<<
// ---------------------------------------------------------------------------

export const COURSE_LABELS = {
  anthropology: 'אנתרופולוגיה',
  sociology: 'סוציולוגיה',
  psychology: 'פסיכולוגיה',
  economy: 'כלכלה',
  rome: 'רומא',
}

// Display name for a course slug. `courses` is the `db.courses` array; it is
// optional so a call site without it still degrades to the legacy map rather
// than breaking. Resolution order: the course row's label, the fallback map,
// then the raw slug — so an unnamed course is always at least identifiable.
export function courseLabel(slug, courses) {
  if (slug == null || slug === '') return 'ללא קורס'
  if (courses) {
    const row = courses.find((c) => c.slug === slug)
    if (row && row.label) return row.label
  }
  return COURSE_LABELS[slug] || slug
}

// The semester a course belongs to, or null when the slug has no course row
// (which includes the "no course" bucket — it can't carry a semester).
export function courseSemester(slug, courses) {
  if (slug == null || slug === '' || !courses) return null
  const row = courses.find((c) => c.slug === slug)
  return row ? row.semester : null
}

// Difficulty labels (optional field; unknown values fall back to raw value).
export const DIFFICULTY_LABELS = {
  easy: 'קל',
  medium: 'בינוני',
  hard: 'קשה',
}

export function difficultyLabel(value) {
  if (value == null || value === '') return 'ללא'
  return DIFFICULTY_LABELS[value] || value
}
