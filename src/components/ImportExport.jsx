import { useRef, useState } from 'react'
import { exportDb } from '../lib/storage.js'
import { validateImport } from '../lib/validate.js'
import { upsertQuestions } from '../lib/api.js'

// Admin-only data management. This tab is only rendered for the admin; the
// database's RLS is the real guard, so a non-admin who forced their way here
// would still fail every write.
export default function ImportExport({ db, dispatch, onImported }) {
  const fileRef = useRef(null)
  // pending holds the parsed+validated import awaiting confirmation
  const [pending, setPending] = useState(null)
  const [report, setReport] = useState(null) // { errors, warnings, schemaWarning, validCount }
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)

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
      if (onImported) await onImported()
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

  return (
    <div className="manage">
      <div className="card">
        <h2>ייבוא / עדכון שאלות</h2>
        <p className="muted">
          בחר קובץ JSON של שאלות (מהצ׳אט שמייצר שאלות או קובץ גיבוי). לאחר בדיקת
          תקינות, השאלות ייכתבו ל<strong>מאגר המשותף</strong>: שאלות חדשות יתווספו,
          וקיימות (לפי <code>id</code>) יעודכנו. מצב המענה של המשתמשים לעולם אינו נמחק.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={handleFile}
          className="file-input"
        />

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
          ייצא JSON
        </button>
      </div>

      <div className="card">
        <h2>כלים</h2>
        <div className="tool-buttons">
          <button className="btn btn-ghost" onClick={resetState} disabled={db.questions.length === 0}>
            אפס את מצב המענה שלי
          </button>
        </div>
      </div>

      {notice && <div className="notice">{notice}</div>}
    </div>
  )
}
