import { useRef, useState } from 'react'
import { exportDb, downloadBackup } from '../lib/storage.js'
import { validateImport, replaceDb, mergeNewOnly } from '../lib/validate.js'
import { makeSeedDb } from '../data/seed.js'

export default function ImportExport({ db, dispatch }) {
  const fileRef = useRef(null)
  // pending holds the parsed+validated import awaiting a Replace/Merge choice
  const [pending, setPending] = useState(null)
  const [report, setReport] = useState(null) // { errors, warnings, schemaWarning, validCount }
  const [notice, setNotice] = useState(null)

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

  function doReplace() {
    if (!pending) return
    // Safety net: auto-download a backup of the CURRENT db before overwriting.
    if (db.questions.length > 0) {
      downloadBackup(db)
    }
    const ok = window.confirm(
      `להחליף את כל מסד הנתונים ב-${pending.length} שאלות מהקובץ?\n\n` +
        (db.questions.length > 0 ? 'גיבוי של הנתונים הנוכחיים ירד זה עתה למחשב.' : '') +
        '\nפעולה זו מוחקת את המצב הנוכחי.',
    )
    if (!ok) return
    dispatch({ type: 'SET_DB', db: replaceDb(pending) })
    setNotice(`הוחלף בהצלחה. ${pending.length} שאלות נטענו.`)
    setPending(null)
    setReport(null)
  }

  function doMerge() {
    if (!pending) return
    const { db: merged, addedCount, skippedCount } = mergeNewOnly(db, pending)
    dispatch({ type: 'SET_DB', db: merged })
    setNotice(`מיזוג הושלם. נוספו ${addedCount} שאלות חדשות, דולגו ${skippedCount} קיימות.`)
    setPending(null)
    setReport(null)
  }

  function doExport() {
    exportDb(db)
    setNotice('הקובץ יוצא והורד.')
  }

  function loadSamples() {
    if (db.questions.length > 0) {
      const ok = window.confirm('טעינת שאלות לדוגמה תחליף את הנתונים הנוכחיים. להמשיך?')
      if (!ok) return
      downloadBackup(db)
    }
    dispatch({ type: 'SET_DB', db: makeSeedDb() })
    setNotice('שאלות לדוגמה נטענו.')
  }

  function resetState() {
    const ok = window.confirm('לאפס את כל מצב המענה (השאלות יישארו, אך יסומנו כלא נענו)?')
    if (!ok) return
    dispatch({ type: 'RESET_STATE' })
    setNotice('מצב המענה אופס.')
  }

  return (
    <div className="manage">
      <div className="card">
        <h2>ייצוא / גיבוי</h2>
        <p className="muted">
          מוריד את כל מסד הנתונים (שאלות + מצב המענה) כקובץ JSON. זהו גם מסלול הסנכרון בין המכשירים
          וגם מנגנון הגיבוי.
        </p>
        <p className="muted">כרגע במסד: <strong>{db.questions.length}</strong> שאלות.</p>
        <button className="btn btn-primary" onClick={doExport} disabled={db.questions.length === 0}>
          ייצא JSON
        </button>
      </div>

      <div className="card">
        <h2>ייבוא</h2>
        <p className="muted">
          בחר קובץ JSON. לאחר בדיקת תקינות תוכל לבחור בין <strong>החלפה</strong> (הקובץ הופך לכל
          המסד — מסלול הסנכרון) לבין <strong>מיזוג</strong> (הוספת שאלות חדשות בלבד לפי id, ללא פגיעה
          במצב הקיים).
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
                <button className="btn btn-danger" onClick={doReplace}>
                  החלפה (מוחק הכל)
                </button>
                <button className="btn btn-primary" onClick={doMerge}>
                  מיזוג שאלות חדשות
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h2>כלים</h2>
        <div className="tool-buttons">
          <button className="btn" onClick={loadSamples}>טען שאלות לדוגמה</button>
          <button className="btn btn-ghost" onClick={resetState} disabled={db.questions.length === 0}>
            אפס מצב מענה
          </button>
        </div>
      </div>

      {notice && <div className="notice">{notice}</div>}
    </div>
  )
}
