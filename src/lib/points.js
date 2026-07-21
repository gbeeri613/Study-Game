// The points model — the single client-side source of truth.
//
// Answer points are a PURE FUNCTION of answer state: every answered question is
// worth points once, correct answers more than incorrect ones. This is why they
// need no retroactive grant (existing answers already count) and can't be farmed
// (one state per question). These values MUST match public.answer_points() in
// supabase/migrations/0004_gamification.sql.
//
// Rewards are the other half of the model. Tagging a question and completing the
// onboarding are *events*, not answer state, so they can't be derived from
// user_answers and live in the server-side `rewards` ledger instead:
//
//     user total = answer points + reward points   (see grandTotal below)
//
// The client only ever *reads* reward rows; it cannot write them. The values
// below MUST match the literals in supabase/migrations/0005_question_feedback.sql.

export const POINTS = {
  correct: 10,
  incorrect: 3,
}

// Reward values and moderation thresholds.
export const TAG_REWARD = 2 // points for tagging a question (once per question)
export const ONBOARDING_REWARD = 10 // points for completing onboarding (once ever)
export const WRONG_THRESHOLD = 3 // 'wrong' tags that auto-hide a question
export const QUALITY_THRESHOLD = 2 // 'quality' tags that mark it high-quality

// Points a single question currently contributes (0 while unanswered).
export function questionPoints(q) {
  if (q.answered_at == null) return 0
  return q.correct ? POINTS.correct : POINTS.incorrect
}

// A user's answer points across a list of (merged) question objects.
export function totalPoints(questions) {
  let sum = 0
  for (const q of questions) sum += questionPoints(q)
  return sum
}

// The number to actually show a user: answer points plus everything they've
// earned from the rewards ledger. Mirrors what leaderboard() computes serverside.
export function grandTotal(db) {
  return totalPoints(db.questions) + (db.rewards_total ?? 0)
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
