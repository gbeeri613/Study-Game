// Import validation + merge/replace logic.
// Validation is defensive and reports precisely which question failed and why,
// keyed by id (or array index when id is missing), rather than crashing.

import { SCHEMA_VERSION } from './storage.js'

// State fields the app owns. Ensured present (defaulting to null) on every
// imported question so downstream code never has to guard for undefined.
function ensureStateFields(q) {
  return {
    ...q,
    answered_at: q.answered_at ?? null,
    last_choice: q.last_choice ?? null,
    correct: q.correct ?? null,
  }
}

// Validate one question object. Returns { ok, error } where error is a Hebrew
// message. `seenIds` is a Set used to detect duplicates within the batch.
function validateQuestion(q, index, seenIds) {
  const label = q && q.id ? `מזהה "${q.id}"` : `שאלה #${index + 1} (ללא מזהה)`

  if (!q || typeof q !== 'object' || Array.isArray(q)) {
    return { ok: false, error: `${label}: אינה אובייקט תקין` }
  }
  if (typeof q.id !== 'string' || q.id.trim() === '') {
    return { ok: false, error: `שאלה #${index + 1}: חסר שדה id או שאינו מחרוזת` }
  }
  if (seenIds.has(q.id)) {
    return { ok: false, error: `${label}: מזהה כפול בתוך הקובץ` }
  }
  if (typeof q.question !== 'string' || q.question.trim() === '') {
    return { ok: false, error: `${label}: חסר טקסט שאלה (question)` }
  }
  if (!Array.isArray(q.options) || q.options.length < 2) {
    return { ok: false, error: `${label}: options חייב להיות מערך עם שתי אפשרויות לפחות` }
  }
  if (q.options.some((o) => typeof o !== 'string' || o.trim() === '')) {
    return { ok: false, error: `${label}: יש אפשרות ריקה במערך options` }
  }
  if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) {
    return {
      ok: false,
      error: `${label}: answer (${q.answer}) מחוץ לטווח 0..${q.options.length - 1}`,
    }
  }
  // option_explanations is optional; if present it must be an array. A length
  // mismatch is NOT fatal — the UI degrades gracefully — but we warn.
  let warning = null
  if (q.option_explanations !== undefined && q.option_explanations !== null) {
    if (!Array.isArray(q.option_explanations)) {
      return { ok: false, error: `${label}: option_explanations חייב להיות מערך` }
    }
    if (q.option_explanations.length !== q.options.length) {
      warning = `${label}: אורך option_explanations אינו תואם ל-options — יוצג רק נכון/שגוי`
    }
  }
  return { ok: true, warning }
}

// Validate a whole imported JSON object (or bare array of questions).
// Returns { ok, questions, errors, warnings, schemaWarning }.
export function validateImport(json) {
  const errors = []
  const warnings = []
  let schemaWarning = null

  // Accept either the full db object or a bare array of question objects
  // (generation chats are instructed to output an array).
  let questionsRaw
  if (Array.isArray(json)) {
    questionsRaw = json
  } else if (json && Array.isArray(json.questions)) {
    questionsRaw = json.questions
    if (json.schema_version !== undefined && json.schema_version !== SCHEMA_VERSION) {
      schemaWarning = `schema_version בקובץ הוא ${json.schema_version}, האפליקציה בנויה ל-${SCHEMA_VERSION}. הייבוא ימשיך, בדוק תאימות.`
    }
  } else {
    return {
      ok: false,
      questions: [],
      errors: ['הקובץ אינו במבנה תקין: ציפינו לאובייקט עם שדה questions או למערך שאלות.'],
      warnings: [],
      schemaWarning: null,
    }
  }

  const seenIds = new Set()
  const good = []
  questionsRaw.forEach((q, i) => {
    const res = validateQuestion(q, i, seenIds)
    if (res.ok) {
      seenIds.add(q.id)
      if (res.warning) warnings.push(res.warning)
      good.push(ensureStateFields(q))
    } else {
      errors.push(res.error)
    }
  })

  return {
    ok: errors.length === 0,
    questions: good,
    errors,
    warnings,
    schemaWarning,
  }
}
