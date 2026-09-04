import { useMemo, useRef, useState } from 'react'
import { exportDb } from '../lib/storage.js'
import { validateImport } from '../lib/validate.js'
import {
  upsertQuestions,
  deleteQuestions,
  adminRestoreQuestion,
  upsertCourses,
  deleteCourse,
  setDefaultSemester,
} from '../lib/api.js'
import { courseLabel, courseSemester } from '../data/labels.js'
import { SEMESTERS, semesterLabel, semesterOrder } from '../data/semesters.js'
import { WRONG_THRESHOLD } from '../lib/points.js'
import {
  IconUpload,
  IconDownload,
  IconReset,
  IconCheck,
  IconTrash,
  IconAlert,
  IconChevronDown,
  IconFileX,
  IconDatabase,
  IconSettings,
} from './Icons.jsx'

// Native select styled with the app's chevron. Mirrors SessionSetup's Select.
function Select({ value, onChange, disabled, ariaLabel, children }) {
  return (
    <div className="select-wrap">
      <select
        className="select"
        value={value}
        onChange={onChange}
        disabled={disabled}
        aria-label={ariaLabel}
      >
        {children}
      </select>
      <IconChevronDown size={17} />
    </div>
  )
}

// Hebrew counts one differently: "שאלה אחת", not "1 שאלות".
function questionCount(n) {
  return n === 1 ? 'שאלה אחת' : `${n} שאלות`
}

function SemesterOptions() {
  return SEMESTERS.map((s) => (
    <option key={s} value={s}>
      {semesterLabel(s)}
    </option>
  ))
}

// Admin-only data management. This tab is only rendered for the admin; the
// database's RLS is the real guard, so a non-admin who forced their way here
// would still fail every write.
export default function ImportExport({ db, dispatch, onRefresh }) {
  const fileRef = useRef(null)
  // pending holds the parsed+validated import awaiting confirmation
  const [pending, setPending] = useState(null)
  const [report, setReport] = useState(null) // { errors, warnings, schemaWarning, validCount }
  // For each course slug in `pending` that has no course row yet: the Hebrew
  // name and semester the admin is about to create it with. Keyed by slug.
  const [newCourses, setNewCourses] = useState({})
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)

  // Courses card: in-flight slug, pending rename drafts (keyed by slug), and
  // the course awaiting a delete confirmation.
  const [courseBusy, setCourseBusy] = useState(null)
  const [labelDrafts, setLabelDrafts] = useState({})
  const [coursePending, setCoursePending] = useState(null)

  // Moderation: the question awaiting a delete confirmation, and the id
  // currently mid-request (so only that row's buttons disable).
  const [modPending, setModPending] = useState(null)
  const [modBusy, setModBusy] = useState(null)

  const courses = db.courses ?? []

  // The semester a newly-created course should default to: whatever the admin
  // has set as the app-wide default, falling back to the newest known semester.
  const defaultSemester =
    db.default_semester && SEMESTERS.includes(db.default_semester)
      ? db.default_semester
      : SEMESTERS[SEMESTERS.length - 1]

  // Everything the community (or the admin) has flagged. The admin receives
  // hidden rows and the counter columns in `db.questions`, so this needs no
  // extra query. Hidden-but-uncounted rows still surface: an admin's own
  // `wrong` tag hides a question immediately, and admin_restore_question zeroes
  // wrong_count without unhiding others' reports.
  const reported = db.questions
    .filter((q) => (q.wrong_count ?? 0) > 0 || q.hidden)
    .sort((a, b) => (b.wrong_count ?? 0) - (a.wrong_count ?? 0))

  // How many questions sit in each course, for the Courses card and for the
  // delete confirmation's blast radius.
  const questionCounts = useMemo(() => {
    const counts = new Map()
    for (const q of db.questions) {
      if (q.course == null || q.course === '') continue
      counts.set(q.course, (counts.get(q.course) ?? 0) + 1)
    }
    return counts
  }, [db.questions])

  // Every course, newest semester first, alphabetical within a semester.
  const courseRows = useMemo(
    () =>
      courses
        .map((c) => ({ ...c, count: questionCounts.get(c.slug) ?? 0 }))
        .sort(
          (a, b) =>
            semesterOrder(b.semester) - semesterOrder(a.semester) ||
            String(a.label).localeCompare(String(b.label), 'he'),
        ),
    [courses, questionCounts],
  )

  // Questions whose course is null — they belong to no course and therefore to
  // no semester. Surfaced so the admin knows they exist (Home shows them under
  // every semester).
  const uncoursedCount = db.questions.filter((q) => q.course == null || q.course === '').length

  // The courses referenced by the pending import, split into ones that already
  // exist (left untouched — an import never moves a course between semesters)
  // and ones this import would create.
  const importCourses = useMemo(() => {
    if (!pending) return []
    const counts = new Map()
    for (const q of pending) {
      const slug = q.course == null || q.course === '' ? null : String(q.course)
      counts.set(slug, (counts.get(slug) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([slug, count]) => ({
        slug,
        count,
        existing: slug == null ? null : courses.find((c) => c.slug === slug) ?? null,
      }))
      .sort((a, b) => b.count - a.count)
  }, [pending, courses])

  const coursesToCreate = importCourses.filter((c) => c.slug != null && !c.existing)
  // Every new course needs a name before the import can run. The semester is
  // always set (it's prefilled), so only the name can block.
  const importBlocked = coursesToCreate.some(
    (c) => !(newCourses[c.slug]?.label ?? '').trim(),
  )

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
        setNewCourses({})
        return
      }
      const result = validateImport(json)
      setReport({
        errors: result.errors,
        warnings: result.warnings,
        schemaWarning: result.schemaWarning,
        validCount: result.questions.length,
      })
      const good = result.questions.length > 0 ? result.questions : null
      setPending(good)

      // Seed the create-course form for any slug we haven't seen before. The
      // name starts as the slug (so it's never empty-looking) and the semester
      // as the app default — the common case is uploading into the semester
      // that's currently live.
      const seeded = {}
      if (good) {
        for (const q of good) {
          const slug = q.course == null || q.course === '' ? null : String(q.course)
          if (slug == null || seeded[slug]) continue
          if (courses.some((c) => c.slug === slug)) continue
          seeded[slug] = { label: slug, semester: defaultSemester }
        }
      }
      setNewCourses(seeded)
    }
    reader.readAsText(file)
    // reset input so the same file can be re-picked
    e.target.value = ''
  }

  function setNewCourse(slug, patch) {
    setNewCourses((m) => ({ ...m, [slug]: { ...m[slug], ...patch } }))
  }

  // Write the validated questions to the shared store (insert new, update
  // existing by id). Never deletes, so no user loses answer state.
  //
  // Courses are created FIRST: questions.course is a foreign key into courses,
  // so a question whose course row doesn't exist yet would be rejected.
  async function doImport() {
    if (!pending || busy || importBlocked) return
    setBusy(true)
    setNotice(null)
    try {
      const created = coursesToCreate.map((c) => ({
        slug: c.slug,
        label: newCourses[c.slug].label.trim(),
        semester: newCourses[c.slug].semester,
      }))
      if (created.length) await upsertCourses(created)

      const written = await upsertQuestions(pending)
      const coursePart = created.length ? ` נוצרו ${created.length} קורסים חדשים.` : ''
      setNotice(`הייבוא הושלם. ${written} שאלות נכתבו למאגר המשותף.${coursePart}`)
      setPending(null)
      setNewCourses({})
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

  // ---- Course registry ------------------------------------------------------

  // Every course edit confirms itself. Without this a successful rename or move
  // is indistinguishable from one that silently failed — the row keeps showing
  // whatever you typed or picked either way.
  async function saveCourse(row, patch) {
    if (courseBusy) return
    setCourseBusy(row.slug)
    setNotice(null)
    try {
      await upsertCourses([{ slug: row.slug, label: row.label, semester: row.semester, ...patch }])
      setNotice(
        patch.semester != null
          ? `${row.label} הועבר לסמסטר ${semesterLabel(patch.semester)}.`
          : `שם הקורס עודכן ל״${patch.label}״.`,
      )
      if (onRefresh) await onRefresh()
    } catch (err) {
      setNotice(`עדכון הקורס נכשל: ${err.message}`)
    } finally {
      setCourseBusy(null)
    }
  }

  // Commit a rename, but only if it actually changed and isn't blank — an empty
  // name would leave the course unidentifiable everywhere.
  function commitLabel(row) {
    const draft = labelDrafts[row.slug]
    setLabelDrafts((d) => {
      const next = { ...d }
      delete next[row.slug]
      return next
    })
    const trimmed = (draft ?? '').trim()
    if (!trimmed || trimmed === row.label) return
    saveCourse(row, { label: trimmed })
  }

  // Permanently delete a course and every question in it. Only reached after
  // the confirmation dialog.
  async function doDeleteCourse() {
    if (!coursePending || courseBusy) return
    setCourseBusy(coursePending.slug)
    setNotice(null)
    try {
      const removed = await deleteCourse(coursePending.slug)
      setCoursePending(null)
      setNotice(`הקורס נמחק, יחד עם ${removed} שאלות.`)
      if (onRefresh) await onRefresh()
    } catch (err) {
      setCoursePending(null)
      setNotice(`מחיקת הקורס נכשלה: ${err.message}`)
    } finally {
      setCourseBusy(null)
    }
  }

  async function changeDefaultSemester(value) {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      await setDefaultSemester(value)
      setNotice(`סמסטר ברירת המחדל עודכן ל-${semesterLabel(value)}.`)
      if (onRefresh) await onRefresh()
    } catch (err) {
      setNotice(`עדכון ההגדרה נכשל: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  // ---- Moderation -----------------------------------------------------------

  // Un-hide a reported question and clear the `wrong` tags against it. The RPC
  // re-checks is_admin() server-side, so this button is a convenience, not the
  // guard.
  async function doRestore(id) {
    if (modBusy) return
    setModBusy(id)
    setNotice(null)
    try {
      await adminRestoreQuestion(id)
      setNotice('השאלה שוחזרה והדיווחים נוקו.')
      if (onRefresh) await onRefresh()
    } catch (err) {
      setNotice(`שחזור נכשל: ${err.message}`)
    } finally {
      setModBusy(null)
    }
  }

  // Permanent delete of a single reported question. Feedback and tag rewards
  // cascade with it.
  async function doDeleteReported() {
    if (!modPending || modBusy) return
    setModBusy(modPending.id)
    setNotice(null)
    try {
      await deleteQuestions([modPending.id])
      setModPending(null)
      setNotice('השאלה נמחקה מהמאגר המשותף.')
      if (onRefresh) await onRefresh()
    } catch (err) {
      setModPending(null)
      setNotice(`מחיקה נכשלה: ${err.message}`)
    } finally {
      setModBusy(null)
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
              <div className="import-courses">
                <span className="field-label">קורסים בקובץ</span>
                <ul className="import-course-list">
                  {importCourses.map((c) => {
                    // Questions with no course at all — nothing to create.
                    if (c.slug == null) {
                      return (
                        <li key="__none__" className="import-course import-course-known">
                          <span className="import-course-name">ללא קורס</span>
                          <span className="import-course-count">{questionCount(c.count)}</span>
                        </li>
                      )
                    }
                    // An existing course keeps its semester: re-importing a fix
                    // must never move questions to another semester.
                    if (c.existing) {
                      return (
                        <li key={c.slug} className="import-course import-course-known">
                          <span className="import-course-name">{c.existing.label}</span>
                          <span className="chip">{semesterLabel(c.existing.semester)}</span>
                          <span className="import-course-count">{questionCount(c.count)}</span>
                        </li>
                      )
                    }
                    const draft = newCourses[c.slug] ?? {}
                    return (
                      <li key={c.slug} className="import-course import-course-new">
                        <div className="import-course-head">
                          <span className="badge-new">חדש</span>
                          <code className="import-course-slug">{c.slug}</code>
                          <span className="import-course-count">{questionCount(c.count)}</span>
                        </div>
                        <div className="import-course-fields">
                          <input
                            className="text-input"
                            type="text"
                            value={draft.label ?? ''}
                            placeholder="שם הקורס בעברית"
                            aria-label={`שם הקורס ${c.slug}`}
                            onChange={(e) => setNewCourse(c.slug, { label: e.target.value })}
                          />
                          <Select
                            value={draft.semester ?? defaultSemester}
                            ariaLabel={`סמסטר עבור ${c.slug}`}
                            onChange={(e) => setNewCourse(c.slug, { semester: e.target.value })}
                          >
                            <SemesterOptions />
                          </Select>
                        </div>
                      </li>
                    )
                  })}
                </ul>
                {coursesToCreate.length > 0 && (
                  <p className="muted import-course-hint">
                    קורס חדש נוצר בסמסטר שנבחר כאן. קורס קיים שומר על הסמסטר שלו —
                    ייבוא חוזר לא מזיז שאלות בין סמסטרים.
                  </p>
                )}
              </div>
            )}

            {pending && (
              <div className="import-actions">
                <button
                  className="btn btn-primary"
                  onClick={doImport}
                  disabled={busy || importBlocked}
                >
                  {busy ? 'כותב…' : `ייבא ${pending.length} שאלות למאגר`}
                </button>
                {importBlocked && (
                  <p className="warn">יש לתת שם עברי לכל קורס חדש לפני הייבוא.</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h2>
          <IconSettings size={18} />
          הגדרות
        </h2>
        <div className="field">
          <span className="field-label">סמסטר ברירת מחדל</span>
          <Select
            value={defaultSemester}
            disabled={busy}
            ariaLabel="סמסטר ברירת מחדל"
            onChange={(e) => changeDefaultSemester(e.target.value)}
          >
            <SemesterOptions />
          </Select>
        </div>
        <p className="muted">
          הסמסטר שכל המשתמשים נוחתים עליו בפתיחת האפליקציה. אם אין עדיין שאלות
          בסמסטר הזה, המשתמשים יישארו בסמסטר האחרון שיש בו שאלות — וההגדרה תיכנס
          לתוקף מעצמה ברגע שיעלה אליו הקורס הראשון.
        </p>
      </div>

      <div className="card">
        <h2>
          <IconDatabase size={18} />
          קורסים
        </h2>
        <p className="muted">
          כל קורס שייך ל<strong>סמסטר אחד</strong>. קורס שחוזר בסמסטר הבא הוא קורס
          חדש עם מזהה (slug) משלו. שינוי השם משפיע על התצוגה בלבד; העברה בין
          סמסטרים משנה רק היכן הקורס מופיע במסך הבית.
        </p>

        {courseRows.length === 0 ? (
          <p className="muted">עדיין אין קורסים. ייבא קובץ שאלות כדי ליצור אחד.</p>
        ) : (
          <ul className="course-admin-list">
            {courseRows.map((row, i) => {
              const prev = courseRows[i - 1]
              const newSemester = !prev || prev.semester !== row.semester
              return (
                <li key={row.slug}>
                  {newSemester && (
                    <p className="course-admin-group">{semesterLabel(row.semester)}</p>
                  )}
                  <div className="course-admin-row">
                    <div className="course-admin-main">
                      <input
                        className="text-input"
                        type="text"
                        value={labelDrafts[row.slug] ?? row.label}
                        aria-label={`שם הקורס ${row.slug}`}
                        disabled={courseBusy != null}
                        onChange={(e) =>
                          setLabelDrafts((d) => ({ ...d, [row.slug]: e.target.value }))
                        }
                        onBlur={() => commitLabel(row)}
                        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                      />
                      <div className="course-admin-meta">
                        <code>{row.slug}</code>
                        <span>{questionCount(row.count)}</span>
                      </div>
                    </div>
                    <div className="course-admin-actions">
                      <Select
                        value={row.semester}
                        disabled={courseBusy != null}
                        ariaLabel={`סמסטר של ${row.label}`}
                        onChange={(e) => saveCourse(row, { semester: e.target.value })}
                      >
                        <SemesterOptions />
                      </Select>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => setCoursePending(row)}
                        disabled={courseBusy != null}
                      >
                        <IconTrash size={15} />
                        מחק
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {uncoursedCount > 0 && (
          <p className="muted">
            בנוסף יש <strong>{questionCount(uncoursedCount)}</strong> ללא קורס. הן אינן
            שייכות לאף סמסטר ולכן מוצגות תחת כל הסמסטרים.
          </p>
        )}
      </div>

      <div className="card">
        <h2>ייצוא / גיבוי</h2>
        <p className="muted">
          מוריד את מצב המאגר הנוכחי כקובץ JSON (שאלות + קורסים + מצב המענה שלך) —
          גיבוי מקומי ותיעוד.
        </p>
        <p className="muted">כרגע במאגר: <strong>{db.questions.length}</strong> שאלות.</p>
        <button className="btn" onClick={doExport} disabled={db.questions.length === 0}>
          <IconDownload size={17} />
          ייצא JSON
        </button>
      </div>

      <div className="card">
        <h2>שאלות שדווחו</h2>
        <p className="muted">
          שאלות שלומדים סימנו כשגויות. שאלה שנצברו עליה{' '}
          <strong>{WRONG_THRESHOLD}</strong> דיווחים מוסתרת אוטומטית ואינה מוצגת
          יותר. <strong>שחזור</strong> מחזיר אותה למאגר ומנקה את הדיווחים;{' '}
          <strong>מחיקה</strong> היא לצמיתות.
        </p>

        {reported.length === 0 ? (
          <p className="muted">אין כרגע שאלות שדווחו. 🎉</p>
        ) : (
          <ul className="mod-list">
            {reported.map((q) => {
              const semester = courseSemester(q.course, courses)
              return (
                <li key={q.id} className="mod-row">
                  <div className="mod-main">
                    <p className="mod-question">{q.question}</p>
                    <div className="mod-meta">
                      <span>{courseLabel(q.course, courses)}</span>
                      {semester && <span>{semesterLabel(semester)}</span>}
                      <span className="mod-count">
                        <IconFileX size={13} />
                        {q.wrong_count ?? 0}
                      </span>
                      {q.hidden && <span className="mod-badge">מוסתרת</span>}
                    </div>
                  </div>
                  <div className="mod-actions">
                    <button
                      className="btn btn-sm"
                      onClick={() => doRestore(q.id)}
                      disabled={modBusy != null}
                    >
                      <IconReset size={15} />
                      שחזר
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => setModPending(q)}
                      disabled={modBusy != null}
                    >
                      <IconTrash size={15} />
                      מחק
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
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

      {coursePending && (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={() => !courseBusy && setCoursePending(null)}
        >
          <div
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="del-course-title"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="modal-icon modal-icon-danger">
              <IconAlert size={26} />
            </span>
            <h3 id="del-course-title">מחיקת קורס</h3>
            <p className="muted">
              הקורס <strong>{coursePending.label}</strong> (סמסטר{' '}
              {semesterLabel(coursePending.semester)}) יימחק, יחד עם{' '}
              <strong>{questionCount(coursePending.count)}</strong> שבו וכל הדיווחים
              והתיוגים עליהן. המחיקה אינה הפיכה ותשפיע על כל המשתמשים.
            </p>
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                onClick={() => setCoursePending(null)}
                disabled={courseBusy != null}
              >
                ביטול
              </button>
              <button
                className="btn btn-danger"
                onClick={doDeleteCourse}
                disabled={courseBusy != null}
              >
                <IconTrash size={16} />
                {courseBusy ? 'מוחק…' : 'מחק לצמיתות'}
              </button>
            </div>
          </div>
        </div>
      )}

      {modPending && (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={() => !modBusy && setModPending(null)}
        >
          <div
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="mod-del-title"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="modal-icon modal-icon-danger">
              <IconAlert size={26} />
            </span>
            <h3 id="mod-del-title">מחיקת השאלה</h3>
            <p className="muted">
              השאלה תימחק לצמיתות מהמאגר המשותף, על כל הדיווחים והתיוגים שלה.
              הפעולה אינה הפיכה ומשפיעה על כל המשתמשים.
            </p>
            <p className="mod-confirm-q">{modPending.question}</p>
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                onClick={() => setModPending(null)}
                disabled={modBusy != null}
              >
                ביטול
              </button>
              <button
                className="btn btn-danger"
                onClick={doDeleteReported}
                disabled={modBusy != null}
              >
                <IconTrash size={16} />
                {modBusy ? 'מוחק…' : 'מחק לצמיתות'}
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
