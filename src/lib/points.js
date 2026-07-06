// The points model — the single client-side source of truth.
//
// Points are a PURE FUNCTION of answer state: every answered question is worth
// points once, correct answers more than incorrect ones. A user's total is just
// the sum over their answered questions. This is why points need no retroactive
// grant (existing answers already count) and can't be farmed (one state per
// question). These values MUST match public.answer_points() in
// supabase/migrations/0004_gamification.sql.

export const POINTS = {
  correct: 10,
  incorrect: 3,
}

// Points a single question currently contributes (0 while unanswered).
export function questionPoints(q) {
  if (q.answered_at == null) return 0
  return q.correct ? POINTS.correct : POINTS.incorrect
}

// A user's total points across a list of (merged) question objects.
export function totalPoints(questions) {
  let sum = 0
  for (const q of questions) sum += questionPoints(q)
  return sum
}

// Points value of a pre-session answer bucket ('correct' | 'incorrect' |
// 'unanswered'), used to compute how much a session *changed* the total.
export function bucketPoints(bucket) {
  if (bucket === 'correct') return POINTS.correct
  if (bucket === 'incorrect') return POINTS.incorrect
  return 0
}

// Net points a session earned: for each first-attempt outcome, the new value
// minus what that question was already worth. Re-confirming an already-correct
// question adds 0; the rare case of getting a previously-correct question wrong
// is negative (the total honestly reflects reduced mastery).
export function sessionPoints(outcomes) {
  let delta = 0
  for (const o of outcomes) {
    const now = o.correct ? POINTS.correct : POINTS.incorrect
    delta += now - bucketPoints(o.prev)
  }
  return delta
}
