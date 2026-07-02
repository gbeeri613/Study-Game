// ---------------------------------------------------------------------------
// Subject (course) labels.
//
// The app NEVER hardcodes which subjects exist — that is derived from whatever
// `course` slugs appear in the imported JSON. This map only provides nicer
// Hebrew display labels. Any slug not listed here falls back to showing the raw
// slug, so a future-semester subject still works immediately.
//
// >>> To add a subject label for a new semester, add one line below. <<<
// ---------------------------------------------------------------------------

export const COURSE_LABELS = {
  anthropology: 'אנתרופולוגיה',
  sociology: 'סוציולוגיה',
  psychology: 'פסיכולוגיה',
  economy: 'כלכלה',
  rome: 'רומא',
}

export function courseLabel(slug) {
  if (slug == null || slug === '') return 'ללא קורס'
  return COURSE_LABELS[slug] || slug
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
