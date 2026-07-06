// Remote data layer. Supabase is the source of truth; the app merges the
// shared `questions` store with the signed-in user's `user_answers` rows into
// the same in-memory db shape the rest of the app already understands.

import { supabase } from './supabase.js'
import { SCHEMA_VERSION, loadDb } from './storage.js'
import { PREVIEW_USER_ID } from './useAuth.js'

// Content columns pulled from the questions table, in schema order.
const QUESTION_COLUMNS =
  'id, course, unit, topic, difficulty, question, options, answer, option_explanations, explanation'

// Fetch the whole db for a user: all shared questions, with this user's answer
// state merged onto each. Returns the standard { schema_version, questions } db.
export async function fetchRemoteDb(userId) {
  // Dev-only (`?preview` fake user): serve the locally cached db instead of
  // hitting Supabase. Stripped from production builds.
  if (import.meta.env.DEV && userId === PREVIEW_USER_ID) {
    const cached = loadDb()
    if (cached) return cached
    throw new Error('preview mode: no cached db in localStorage')
  }

  const [qRes, aRes] = await Promise.all([
    supabase.from('questions').select(QUESTION_COLUMNS),
    supabase
      .from('user_answers')
      .select('question_id, answered_at, last_choice, correct')
      .eq('user_id', userId),
  ])

  if (qRes.error) throw qRes.error
  if (aRes.error) throw aRes.error

  const answersById = new Map(
    (aRes.data ?? []).map((a) => [a.question_id, a]),
  )

  const questions = (qRes.data ?? []).map((q) => {
    const a = answersById.get(q.id)
    return {
      ...q,
      answered_at: a?.answered_at ?? null,
      last_choice: a?.last_choice ?? null,
      correct: a?.correct ?? null,
    }
  })

  return {
    schema_version: SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    questions,
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
  const mine = (cached?.questions ?? []).reduce((sum, q) => {
    if (q.answered_at == null) return sum
    return sum + (q.correct ? 10 : 3)
  }, 0)
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
