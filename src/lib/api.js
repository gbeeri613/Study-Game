// Remote data layer. Supabase is the source of truth; the app merges the
// shared `questions` store with the signed-in user's `user_answers` rows into
// the same in-memory db shape the rest of the app already understands.

import { supabase } from './supabase.js'
import { SCHEMA_VERSION, loadDb } from './storage.js'
import { PREVIEW_USER_ID } from './useAuth.js'
import { WRONG_THRESHOLD } from './points.js'

// Content columns pulled from the questions table, in schema order. The
// moderation columns ride along so the client can apply the high-quality filter
// and (for the admin) build the reported-questions list without a second query.
const QUESTION_COLUMNS =
  'id, course, unit, topic, difficulty, question, options, answer, option_explanations, explanation, ' +
  'hidden, wrong_count, quality_count'

// Fetch the whole db for a user: all shared questions, with this user's answer
// state and own tag merged onto each, plus the user's reward total and
// onboarding state. Returns the standard { schema_version, questions } db.
//
// Note the asymmetry: answer state and tags are per-user and merged onto each
// question, while the tag *counts* are shared and come straight off the row. A
// user never receives anyone else's tags — RLS enforces that, not this code.
export async function fetchRemoteDb(userId) {
  // Dev-only (`?preview` fake user): serve the locally cached db instead of
  // hitting Supabase. Stripped from production builds.
  if (import.meta.env.DEV && userId === PREVIEW_USER_ID) {
    const cached = loadDb()
    if (cached) return synthPreviewFields(cached)
    throw new Error('preview mode: no cached db in localStorage')
  }

  const [qRes, aRes, fRes, rRes, pRes] = await Promise.all([
    supabase.from('questions').select(QUESTION_COLUMNS),
    supabase
      .from('user_answers')
      .select('question_id, answered_at, last_choice, correct')
      .eq('user_id', userId),
    supabase.from('question_feedback').select('question_id, tag').eq('user_id', userId),
    supabase.from('rewards').select('kind, question_id, points').eq('user_id', userId),
    supabase.from('profiles').select('onboarded_at').eq('id', userId).maybeSingle(),
  ])

  if (qRes.error) throw qRes.error
  if (aRes.error) throw aRes.error
  if (fRes.error) throw fRes.error
  if (rRes.error) throw rRes.error
  if (pRes.error) throw pRes.error

  const answersById = new Map((aRes.data ?? []).map((a) => [a.question_id, a]))
  const tagsById = new Map((fRes.data ?? []).map((f) => [f.question_id, f.tag]))

  // Which questions have already paid out their one-time tag reward. Drives the
  // optimistic +2 in the reducer, so a re-tag doesn't animate points that the
  // server won't actually grant.
  const rewardedIds = new Set(
    (rRes.data ?? []).filter((r) => r.kind === 'tag').map((r) => r.question_id),
  )
  const rewardsTotal = (rRes.data ?? []).reduce((sum, r) => sum + r.points, 0)

  const questions = (qRes.data ?? []).map((q) => {
    const a = answersById.get(q.id)
    return {
      ...q,
      answered_at: a?.answered_at ?? null,
      last_choice: a?.last_choice ?? null,
      correct: a?.correct ?? null,
      my_tag: tagsById.get(q.id) ?? null,
      tag_rewarded: rewardedIds.has(q.id),
    }
  })

  return {
    schema_version: SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    questions,
    rewards_total: rewardsTotal,
    onboarded_at: pRes.data?.onboarded_at ?? null,
  }
}

// `?preview` has no backend, so the fields the server would supply are
// fabricated here — deterministically from the question id, so the same
// questions stay "high quality" across reloads and the filter is testable.
// Dev-only; stripped from production builds.
function synthPreviewFields(db) {
  const questions = db.questions.map((q) => {
    let h = 0
    for (let i = 0; i < String(q.id).length; i++) h = (h * 31 + String(q.id).charCodeAt(i)) | 0
    const bucket = Math.abs(h) % 10
    // One bucket models a question that has already crossed the report
    // threshold and been auto-hidden. Without it `hidden` would be false for
    // every question in preview, and the states that only exist for hidden
    // rows — the moderation list's מוסתרת badge, Restore, and the exclusion
    // from the practice pool — would be unreachable locally.
    const autoHidden = bucket === 8
    return {
      ...q,
      // Roughly a third of the bank reads as community-endorsed.
      quality_count: bucket < 3 ? 2 + (bucket % 2) : 0,
      wrong_count: autoHidden ? WRONG_THRESHOLD : bucket === 9 ? 1 : 0,
      hidden: autoHidden,
      my_tag: q.my_tag ?? null,
      tag_rewarded: q.tag_rewarded ?? false,
    }
  })
  return {
    ...db,
    questions,
    rewards_total: db.rewards_total ?? 0,
    onboarded_at: db.onboarded_at ?? null,
  }
}

// Persist a single answer (upsert this user's row for the question).
export async function recordAnswer(userId, questionId, choice, correct) {
  const { error } = await supabase.from('user_answers').upsert(
    {
      user_id: userId,
      question_id: questionId,
      answered_at: new Date().toISOString(),
      last_choice: choice,
      correct,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,question_id' },
  )
  if (error) throw error
}

// Clear answer state. With ids: only those questions; without: all of the
// user's answers. Deleting the row is how a question becomes "unanswered".
export async function resetAnswers(userId, ids) {
  let query = supabase.from('user_answers').delete().eq('user_id', userId)
  if (ids && ids.length) query = query.in('question_id', ids)
  const { error } = await query
  if (error) throw error
}

// ---- Question feedback (tagging) ------------------------------------------
// Writes are the user's own feedback row only; everything downstream — the tag
// counts, the auto-hide, and the +2 reward — is done by the database trigger.
// The client never writes to `rewards`; it has no policy to do so.

// True while the app is running against the fake `?preview` user, which has no
// backend. Dev-only, so these branches vanish from production builds.
function previewMode() {
  return (
    import.meta.env.DEV && new URLSearchParams(window.location.search).has('preview')
  )
}

// Attach (or switch to) a tag on a question. `tag` is 'wrong' | 'quality'.
export async function setTag(userId, questionId, tag) {
  if (previewMode()) return
  const { error } = await supabase.from('question_feedback').upsert(
    {
      user_id: userId,
      question_id: questionId,
      tag,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,question_id' },
  )
  if (error) throw error
}

// Remove this user's tag from a question. Never claws back the reward.
export async function clearTag(userId, questionId) {
  if (previewMode()) return
  const { error } = await supabase
    .from('question_feedback')
    .delete()
    .eq('user_id', userId)
    .eq('question_id', questionId)
  if (error) throw error
}

// ---- Onboarding ------------------------------------------------------------
// Both RPCs mark the onboarding as seen; only `claim` grants points, and only
// the first time (enforced by a partial unique index on rewards).

export async function claimOnboarding() {
  if (previewMode()) return
  const { error } = await supabase.rpc('complete_tag_onboarding')
  if (error) throw error
}

export async function dismissOnboarding() {
  if (previewMode()) return
  const { error } = await supabase.rpc('dismiss_tag_onboarding')
  if (error) throw error
}

// ---- Admin moderation ------------------------------------------------------

// Un-hide a reported question and clear the 'wrong' tags against it, so it
// doesn't immediately re-hide. Admin-only; the RPC re-checks that server-side.
export async function adminRestoreQuestion(questionId) {
  if (previewMode()) return
  const { error } = await supabase.rpc('admin_restore_question', { qid: questionId })
  if (error) throw error
}

// ---- Leaderboard identity + standings -------------------------------------

// Mirror the signed-in user's Google name + avatar into `profiles` so they can
// appear on the leaderboard (auth.users metadata isn't readable via the public
// key). Called once on sign-in; idempotent.
export async function upsertProfile(user) {
  if (import.meta.env.DEV && user.id === PREVIEW_USER_ID) return
  const meta = user.user_metadata ?? {}
  const { error } = await supabase.from('profiles').upsert(
    {
      id: user.id,
      name: meta.full_name || meta.name || user.email || null,
      avatar_url: meta.avatar_url || meta.picture || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  )
  if (error) throw error
}

// Ranked point totals across all users. `period` is 'daily' (today only, Israel
// time) or 'all' (cumulative). Returns the full ranking: [{ user_id, name,
// avatar_url, points, rank }]. The point totals are computed server-side from
// answer state (see the leaderboard() SQL function).
export async function fetchLeaderboard(period = 'all') {
  // Preview (`?preview`) has no backend — synthesize a small board from the
  // cached db so the widget can be inspected locally. Dev-only.
  if (import.meta.env.DEV) {
    const preview = new URLSearchParams(window.location.search).has('preview')
    if (preview) return previewLeaderboard(period)
  }
  const { data, error } = await supabase.rpc('leaderboard', { period })
  if (error) throw error
  return data ?? []
}

// Fabricated leaderboard for `?preview` mode only (stripped from prod builds):
// the preview user's real cached total plus a few fake rivals, so the widget
// renders without a backend.
function previewLeaderboard(period) {
  const cached = loadDb()
  const mine =
    (cached?.questions ?? []).reduce((sum, q) => {
      if (q.answered_at == null) return sum
      return sum + (q.correct ? 10 : 3)
    }, 0) + (cached?.rewards_total ?? 0)
  const scale = period === 'daily' ? 0.35 : 1
  const rivals = [
    { name: 'דנה כהן', points: 940 },
    { name: 'יואב לוי', points: 730 },
    { name: 'מאיה פרץ', points: 610 },
    { name: 'איתי בר', points: 480 },
    { name: 'נועה שרון', points: 250 },
    { name: 'רון גל', points: 120 },
  ]
  const rows = [
    { user_id: PREVIEW_USER_ID, name: 'משתמש תצוגה', avatar_url: null, points: mine },
    ...rivals.map((r, i) => ({
      user_id: `preview-rival-${i}`,
      name: r.name,
      avatar_url: null,
      points: Math.round(r.points * scale),
    })),
  ]
    .filter((r) => r.points > 0)
    .sort((a, b) => b.points - a.points)
  return rows.map((r, i) => ({ ...r, rank: i + 1 }))
}

// ---- Admin: write the shared question store -------------------------------
// Only content columns are written; per-user state never touches this table.
// RLS lets only the admin succeed here — a non-admin call fails at the DB.

const WRITABLE_COLUMNS = [
  'id',
  'course',
  'unit',
  'topic',
  'difficulty',
  'question',
  'options',
  'answer',
  'option_explanations',
  'explanation',
]

// Insert-or-update questions by id. Adds new questions and overwrites changed
// ones; never deletes, so existing answers are never disturbed. Chunked to keep
// each request well within payload limits. Returns the number written.
export async function upsertQuestions(questions) {
  const rows = questions.map((q) => {
    const row = { updated_at: new Date().toISOString() }
    for (const k of WRITABLE_COLUMNS) {
      if (q[k] !== undefined) row[k] = q[k]
    }
    return row
  })

  const CHUNK = 200
  let written = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    const { error } = await supabase
      .from('questions')
      .upsert(slice, { onConflict: 'id' })
    if (error) throw error
    written += slice.length
  }
  return written
}

// Permanently delete questions by id from the shared store. Every user's answer
// rows for these questions cascade away automatically (user_answers FK is
// ON DELETE CASCADE). Chunked to keep each request's id list within URL limits.
// RLS lets only the admin succeed. Returns the number of ids requested.
export async function deleteQuestions(ids) {
  const CHUNK = 100
  let deleted = 0
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK)
    const { error } = await supabase.from('questions').delete().in('id', slice)
    if (error) throw error
    deleted += slice.length
  }
  return deleted
}
