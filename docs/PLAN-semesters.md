# Implementation Plan — Semesters

Adds a semester dimension to the app: a `courses` table that pins every course
to exactly one semester, a semester selector on Home, a semester + name picker
in the admin import flow, and an admin-controlled default semester.

Status: **SHIPPED to the database; client not yet deployed.** Built and
migrated 2026-09-04.

`0006_semesters.sql` was applied to the `Arrow Quiz` project
(ref `lyfzjsgverchjdjgvnfv`, branch `main`/PRODUCTION) and verified:

| check | result |
|---|---|
| `courses` rows | 6, all at `26-2`, Hebrew labels correct |
| question counts per course | 208 / 216 / 159 / 126 / 119 / 93 — unchanged |
| `questions` total | 921 — nothing lost |
| `questions_course_fkey` | present |
| `app_settings.default_semester` | `"26-2"` |
| RLS policies on the two new tables | 4 (read + admin-write each) |
| questions with no course | 0 |

**A sixth course surfaced that the plan didn't know about:** slug
`פסיכולוגיה אתגר` (a Hebrew slug, with a space), 93 questions. It was already
its own card before this change — Home derived courses from slugs — so nothing
regressed. It seeded at `26-2` with its slug as its label, which happens to
read correctly in Hebrew; rename it from the admin Courses card if you want.

**Remaining: deploy the client.** The old build doesn't query `courses` or
`app_settings`, so it keeps working against the migrated DB until then.

---

## Decisions (settled — do not re-litigate)

1. **A real `courses` table.** Semester attaches to a *course*, not a question.
   A course slug therefore belongs to exactly one semester — a course that runs
   again next semester gets a **new slug** (`psychology-263`) and its own Home
   card with its own progress donut.
2. **The Hebrew label moves to the DB.** `courses` holds `slug`, `semester`,
   `label`. `COURSE_LABELS` in `src/data/labels.js` survives only as a fallback
   for a slug with no row, and the migration seeds the table from it.
3. **Home-cards-only scope.** The selector filters which course cards you see.
   Nothing downstream — session setup, the practice pool, the summary — knows
   about semesters, because slugs can't collide across them (decision 1).
   `applyFilters`, `configToFilters` and the session `config` are **untouched**.
4. **The admin default wins on every page load.** Not remembered per user, not
   stored in localStorage. Switching semesters is per-visit.
5. **The selector lists only semesters that have content.** Derived from the
   data, so `27-1` appears by itself the first time a course is created in it —
   no code change to reveal it.
6. **An empty default falls back.** Setting the default to `26-3` before any
   `26-3` course exists is a no-op: everyone stays on `26-2` and flips over
   automatically the moment the first `26-3` course is imported.
7. **Import auto-creates unknown courses**, with the semester dropdown
   prefilled to the current admin default.
8. **Full course management** in the admin screen: rename, reassign semester,
   delete (course + its questions). This **replaces** the existing
   "מחיקת שאלות" by-course card.
9. **The leaderboard is untouched.** It aggregates `user_answers` across all
   users and all time; semesters do not enter into it. Home's hero point total
   stays global for the same reason — the two numbers must agree.

## Assumptions (flag if wrong)

- Semester values are stored as plain text (`'26-2'`). The canonical ordered
  list lives in `src/data/semesters.js`; the DB has **no check constraint**, so
  adding `28-2` later is a one-line code edit and no migration.
- Semesters render as their raw code (`26-2`) — no Hebrew academic-year
  transliteration.
- Questions with no course (`course` null) keep the "ללא קורס" bucket and are
  shown under **every** semester, since they have no course row to carry one.
  The migration normalizes `course = ''` to `NULL` so this is one case, not two.
- The app title `תרגול חץ 26׳` is left as-is.
- `schema_version` bumps to **2** (the export gains a `courses` array). Import
  of a v1 file still works — the existing mismatch warning covers it.

---

## Session 1 — Database + data layer

### `supabase/migrations/0006_semesters.sql` (new)

```
courses
  slug        text primary key
  label       text not null
  semester    text not null
  created_at  timestamptz not null default now()
  updated_at  timestamptz not null default now()
```

- RLS: read for all `authenticated`; all writes gated on `public.is_admin()` —
  mirrors the `questions` policy pair exactly.
- Normalize `update questions set course = null where course = ''`.
- Seed `courses` from `select distinct course from questions where course is not
  null`, `semester = '26-2'`, `label` from the current `COURSE_LABELS` map
  (anthropology/sociology/psychology/economy/rome), falling back to the slug.
- **Then** add the FK: `questions.course references courses(slug)`. Seeding
  first means it can't fail; the FK is what guarantees no orphan slug can ever
  hide a card from every semester. No `on delete cascade` — deleting a course's
  questions is an explicit two-step in the admin UI (below).

```
app_settings
  key    text primary key
  value  jsonb not null
```

- Key/value so future admin settings need no new table. Seed
  `('default_semester', '"26-2"')`.
- RLS: read for all `authenticated`, write admin-only.
- Idempotent throughout (`create table if not exists`, `drop policy if exists`,
  `on conflict do nothing`) — same house style as `0004`/`0005`.

### `src/data/semesters.js` (new)

`SEMESTERS = ['26-2', '26-3', '27-1', '27-2', '27-3', '28-1']`, oldest first,
plus `semesterLabel()` and a comment saying this list is the only thing to edit
when a new semester is invented.

### `src/lib/api.js`

- `fetchRemoteDb` gains two parallel queries: `courses` (all columns) and
  `app_settings` (the `default_semester` row). Both land on the db object as
  `db.courses` and `db.default_semester`. `synthPreviewFields` synthesizes them
  for `?preview`.
- New admin writers, each a thin `previewMode()`-guarded wrapper:
  `upsertCourses(rows)`, `deleteCourse(slug)` (delete questions by slug first,
  then the course row — the FK forces that order), `setDefaultSemester(value)`.
- `WRITABLE_COLUMNS` and `QUESTION_COLUMNS` are **unchanged** — semester never
  touches the `questions` table.

### `src/lib/storage.js`

`SCHEMA_VERSION = 2`; `emptyDb()` gains `courses: []` and
`default_semester: null`; `exportDb` carries `courses` through untouched (it
spreads the db already).

### `src/data/labels.js`

`courseLabel(slug, courses)` — DB label first, then `COURSE_LABELS`, then the
raw slug, then `'ללא קורס'` for null/empty. The second argument is optional so
nothing breaks mid-refactor. All five call sites already receive `db`, so
threading `db.courses` is mechanical: `Home.jsx`, `SessionSetup.jsx`,
`Practice.jsx`, `Summary.jsx`, `ImportExport.jsx`.

### `src/lib/validate.js`

If an imported question carries a stray `semester` field, add a **warning**
(not an error): the semester comes from the course, not the question, so the
field is ignored. Keeps old generated files importable.

**Session 1 is done when** the migration is applied, the app still runs
unchanged, and `db.courses` / `db.default_semester` are populated.

---

## Session 2 — Admin screen (`src/components/ImportExport.jsx`)

### Import card — the semester picker

After validation and before the import button, a per-course review block:

- Group the validated questions by `course` slug and list each with its count.
- A slug that already has a course row renders read-only:
  `סוציולוגיה · 26-2 · 47 שאלות`. Existing courses are never reassigned by an
  import, so re-importing a fix can't move questions between semesters.
- A slug with no course row renders as a **new course** row: a Hebrew name text
  input (prefilled with the slug) and a semester `Select` prefilled with
  `db.default_semester`.
- The import button stays disabled until every new course has a non-empty name.
- `doImport` writes `upsertCourses(newCourses)` **first**, then
  `upsertQuestions(pending)` — the FK requires that order — then refreshes.

### Courses card (new) — replaces "מחיקת שאלות"

A list of every course, grouped by semester (newest first), each row showing
the Hebrew label, the slug in small mono, and its question count. Per row:

- **Rename** — inline text input, saved on blur/Enter via `upsertCourses`.
- **Reassign semester** — a `Select` of `SEMESTERS`, saved on change.
- **Delete** — reuses the existing danger modal, copy updated to state that the
  course *and* its N questions are deleted permanently for all users. Calls
  `deleteCourse(slug)`.

The old `delCourse` / `confirmOpen` state and its card are removed; the
question-count math and confirmation copy move into this card.

### Settings card (new)

One `Select` — `סמסטר ברירת מחדל` — over the **full** `SEMESTERS` list (not
just those with content; decision 6 makes an empty default safe). Saves via
`setDefaultSemester`, then refreshes. A hint line spells out the fallback:
"אם אין עדיין תוכן בסמסטר הזה, המשתמשים יישארו בסמסטר האחרון שיש בו שאלות."

### Moderation card

Add the semester next to `courseLabel` in the `.mod-meta` row. One line.

**Session 2 is done when** you can create a course by importing, rename it,
move it between semesters, delete it, and change the default semester — all
from the app, with no SQL editor.

---

## Session 3 — Home selector

### `src/App.jsx`

- New state `semester`, resolved once when the db loads:
  1. `db.default_semester`, if it has ≥1 course with ≥1 *active* question;
  2. otherwise the **newest** semester (by `SEMESTERS` order) that does;
  3. otherwise `null` — no content anywhere.
- "Active" means the same `activeQuestions()` set Home's donuts already use, so
  the semester list, the cards, and the counts can never disagree — and the
  admin (who receives hidden rows) sees exactly what students see.
- Passed to `Home` with a setter. It is **not** passed to `SessionSetup`,
  `Practice` or `Summary` — decision 3.
- `openSetup(courseSlug)`'s repair path (`course = courses[0]`) should prefer a
  course in the *selected* semester, so cancelling out of setup and reopening
  it doesn't silently jump to another semester's course.
- The `!hasQuestions` empty state stays as the global "the bank is empty" case.
  A semester with no cards can't occur — the selector only lists semesters that
  have some.

### `src/components/Home.jsx`

- The `courses` memo gains a semester join: build a `slug → semester` map from
  `db.courses`, tally as today, then keep only rows whose semester matches the
  selection (plus the null-course bucket, which has no semester and always
  shows).
- A chip row between `.home-hero` and `.course-grid`, one `.chip-toggle` per
  semester that has content, ordered newest first, selected one active. Reuses
  the existing chip styling; horizontally scrollable so it survives six
  semesters. Hidden entirely when only one semester has content — a selector
  with one option is noise.
- `courseName()` / `courseLabel()` calls take `db.courses`.

### `src/styles.css`

One block for the semester row: `.semester-bar` (flex, gap, overflow-x auto,
scrollbar hidden, RTL-safe padding). No new colors or radii — chips already
carry the tokens.

### Docs

- `SCHEMA.md`: a `courses` and `app_settings` section, `schema_version` 2, a
  note that `semester` on a question object is ignored, and the "to add a
  subject label" instruction replaced with "create the course at import time".
- `README.md`: the admin-tools bullet gains course management + default
  semester; the features list gains the semester selector.
- The `generate-study-questions` skill needs no change — it emits `course`
  slugs, and the import flow assigns the semester.

**Session 3 is done when** Home shows a `26-2` / `26-3` chip row, switching
filters the cards, and a fresh load lands on whatever the admin default
resolves to.

---

## Test checklist

- [ ] Fresh load with default `26-2` → `26-2` selected, all five current
      courses visible, counts identical to before the change.
- [ ] Set default to `26-3` with no `26-3` content → everyone still lands on
      `26-2`; the `26-3` chip is absent.
- [ ] Import a new course into `26-3` → the `26-3` chip appears, and the next
      load lands on `26-3` without touching the admin setting again.
- [ ] Re-import an existing `26-2` course while the default is `26-3` → its
      questions stay in `26-2`.
- [ ] Reassign a course to another semester → its card moves; answer state,
      points and tags are untouched.
- [ ] Delete a course → card gone, questions gone, no FK error, leaderboard
      totals drop only by that course's answer points.
- [ ] Leaderboard and the Home hero point total are byte-identical before and
      after switching semesters.
- [ ] A question with `course = null` shows under every semester.
- [ ] `?preview` still renders Home, the selector, and the admin screen.
