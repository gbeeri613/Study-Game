import { useRef, useState } from 'react'
import { exportDb } from '../lib/storage.js'
import { validateImport } from '../lib/validate.js'
import { upsertQuestions, deleteQuestions } from '../lib/api.js'
import { distinctValues, NONE_VALUE } from '../lib/session.js'
import { courseLabel } from '../data/labels.js'
import {
  IconUpload,
  IconDownload,
  IconReset,
  IconCheck,
  IconTrash,
  IconAlert,
  IconChevronDown,
} from './Icons.jsx'

// The bucket a question's course falls under (missing course → NONE sentinel),
// matching how the filter/dropdown code groups them.
function courseKey(q) {
  const v = q.course
  return v === undefined || v === null || v === '' ? NONE_VALUE : String(v)
}

// Admin-only data management. This tab is only rendered for the admin; the
// database's RLS is the real guard, so a non-admin who forced their way here
// would still fail every write.
export default function ImportExport({ db, dispatch, onRefresh }) {
  const fileRef = useRef(null)
  // pending holds the parsed+validated import awaiting confirmation
  const [pending, setPending] = useState(null)
  const [report, setReport] = useState(null) // { errors, warnings, schemaWarning, validCount }
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)

  // Delete-questions section: which course is selected, and whether the
  // confirmation dialog is open.
  const [delCourse, setDelCourse] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)

  // Course options + how many questions each holds, so the admin sees the
  // blast radius before deleting.
  const courseValues = distinctValues(db.questions, 'course')
  const delIds = delCourse
    ? db.questions.filter((q) => courseKey(q) === delCourse).map((q) => q.id)
    : []
  const delCourseName =
    delCourse === NONE_VALUE ? 'ללא קורס' : courseLabel(delCourse)

  function handleFile(e) {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    setNotice(null)
    const reader = new FileReader()
    reader.onload = () => {
      let json
      try {
        json = JSON.parse(reader.result)
      } catch (err) {
        setReport({ errors: [`הקובץ אינו JSON תקין: ${err.message}`], warnings: [], schemaWarning: null, validCount: 0 })
        setPending(null)
        return
      }
      const result = validateImport(json)
      setReport({
        errors: result.errors,
        warnings: result.warnings,
        schemaWarning: result.schemaWarning,
        validCount: result.questions.length,
      })
      setPending(result.questions.length > 0 ? result.questions : null)
    }
    reader.readAsText(file)
    // reset input so the same file can be re-picked
    e.target.value = ''
  }

  // Write the validated questions to the shared store (insert new, update
  // existing by id). Never deletes, so no user loses answer state.
  async function doImport() {
    if (!pending || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const written = await upsertQuestions(pending)
      setNotice(`הייבוא הושלם. ${written} שאלות נכתבו למאגר המשותף.`)
      setPending(null)
      setReport(null)
      if (onRefresh) await onRefresh()
    } catch (err) {
      setReport((r) => ({
        errors: [`כתיבה למסד הנתונים נכשלה: ${err.message}`, ...(r?.errors ?? [])],
        warnings: r?.warnings ?? [],
        schemaWarning: r?.schemaWarning ?? null,
        validCount: r?.validCount ?? 0,
      }))
    } finally {
      setBusy(false)
    }
  }

  function doExport() {
    exportDb(db)
    setNotice('הקובץ יוצא והורד.')
  }

  async function resetState() {
    const ok = window.confirm(
      'לאפס את מצב המענה שלך (השאלות יישארו, אך יסומנו כלא נענו)? ' +
        'פעולה זו משפיעה רק על המשתמש שלך.',
    )
    if (!ok) return
    dispatch({ type: 'RESET_STATE' })
    setNotice('מצב המענה שלך אופס.')
  }

  // Permanently delete every question in the selected course from the shared
  // store. Only reached after the confirmation dialog. Refreshes the db so the
  // deleted questions disappear everywhere immediately.
  async function doDelete() {
    if (!delIds.length || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const deleted = await deleteQuestions(delIds)
      setConfirmOpen(false)
      setDelCourse('')
      setNotice(`נמחקו ${deleted} שאלות מהמאגר המשותף.`)
      if (onRefresh) await onRefresh()
    } catch (err) {
      setConfirmOpen(false)
      setNotice(`מחיקה נכשלה: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="manage">
      <div className="card">
        <h2>ייבוא / עדכון שאלות</h2>
        <p className="muted">
          בחר קובץ JSON של שאלות (מהצ׳אט שמייצר שאלות או קובץ גיבוי). לאחר בדיקת
          תקינות, השאלות ייכתבו ל<strong>מאגר המשותף</strong>: שאלות חדשות יתווספו,
          וקיימות (לפי <code>id</code>) יעודכנו. מצב המענה של המשתמשים לעולם אינו נמחק.
        </p>
        <label className="upload-zone">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={handleFile}
          />
          <IconUpload size={26} />
          <span className="upload-title">בחר קובץ JSON</span>
          <span className="upload-sub">שאלות חדשות יתווספו, קיימות יעודכנו</span>
        </label>

        {report && (
          <div className="import-report">
            <p>
              נמצאו <strong>{report.validCount}</strong> שאלות תקינות
              {report.errors.length > 0 && <>, <strong>{report.errors.length}</strong> נכשלו</>}.
            </p>
            {report.schemaWarning && <p className="warn">⚠ {report.schemaWarning}</p>}
            {report.errors.length > 0 && (
              <details open>
                <summary>שגיאות ({report.errors.length})</summary>
                <ul className="err-list">
                  {report.errors.map((er, i) => (
                    <li key={i}>{er}</li>
                  ))}
                </ul>
              </details>
            )}
            {report.warnings.length > 0 && (
              <details>
                <summary>אזהרות ({report.warnings.length})</summary>
                <ul className="warn-list">
                  {report.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
            {pending && (
              <div className="import-actions">
                <button className="btn btn-primary" onClick={doImport} disabled={busy}>
                  {busy ? 'כותב…' : `ייבא ${pending.length} שאלות למאגר`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h2>ייצוא / גיבוי</h2>
        <p className="muted">
          מוריד את מצב המאגר הנוכחי כקובץ JSON (שאלות + מצב המענה שלך) — גיבוי מקומי
          ותיעוד.
        </p>
        <p className="muted">כרגע במאגר: <strong>{db.questions.length}</strong> שאלות.</p>
        <button className="btn" onClick={doExport} disabled={db.questions.length === 0}>
          <IconDownload size={17} />
          ייצא JSON
        </button>
      </div>

      <div className="card">
        <h2>מחיקת שאלות</h2>
        <p className="muted">
          מחיקה <strong>לצמיתות</strong> של כל שאלות הקורס הנבחר מ
          <strong>המאגר המשותף</strong>. הפעולה משפיעה על כל המשתמשים ואינה
          הפיכה. בחר קורס ואשר בתיבת האישור.
        </p>
        <div className="field">
          <span className="field-label">קורס למחיקה</span>
          <div className="select-wrap">
            <select
              className="select"
              value={delCourse}
              onChange={(e) => setDelCourse(e.target.value)}
              disabled={courseValues.length === 0}
            >
              <option value="">בחר קורס…</option>
              {courseValues.map((v) => {
                const count = db.questions.filter((q) => courseKey(q) === v).length
                const name = v === NONE_VALUE ? 'ללא קורס' : courseLabel(v)
                return (
                  <option key={v} value={v}>
                    {name} ({count})
                  </option>
                )
              })}
            </select>
            <IconChevronDown size={17} />
          </div>
        </div>
        <div className="tool-buttons">
          <button
            className="btn btn-danger"
            onClick={() => setConfirmOpen(true)}
            disabled={delIds.length === 0 || busy}
          >
            <IconTrash size={17} />
            {delCourse ? `מחק ${delIds.length} שאלות` : 'מחק את כל שאלות הקורס'}
          </button>
        </div>
      </div>

      <div className="card">
        <h2>כלים</h2>
        <div className="tool-buttons">
          <button className="btn btn-danger" onClick={resetState} disabled={db.questions.length === 0}>
            <IconReset size={17} />
            אפס את מצב המענה שלי
          </button>
        </div>
      </div>

      {confirmOpen && (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={() => !busy && setConfirmOpen(false)}
        >
          <div
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="del-title"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="modal-icon modal-icon-danger">
              <IconAlert size={26} />
            </span>
            <h3 id="del-title">מחיקת שאלות</h3>
            <p className="muted">
              פעולה זו תמחק <strong>{delIds.length}</strong> שאלות מהקורס{' '}
              <strong>{delCourseName}</strong> מהמאגר המשותף. המחיקה אינה הפיכה
              ותשפיע על כל המשתמשים.
            </p>
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                onClick={() => setConfirmOpen(false)}
                disabled={busy}
              >
                ביטול
              </button>
              <button className="btn btn-danger" onClick={doDelete} disabled={busy}>
                <IconTrash size={16} />
                {busy ? 'מוחק…' : 'מחק לצמיתות'}
              </button>
            </div>
          </div>
        </div>
      )}

      {notice && (
        <div className="toast">
          <IconCheck size={18} />
          {notice}
        </div>
      )}
    </div>
  )
}
