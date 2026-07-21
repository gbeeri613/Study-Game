# Data Schema — the contract

The app is backed by **Supabase (Postgres)**. There are five tables:

- **`questions`** — the shared question store. Everyone signed in can read it;
  only the admin can write it. This holds the question **content**, plus the
  shared moderation columns added in `0005_question_feedback.sql`:
  `wrong_count`, `quality_count`, `hidden`, `hidden_at` (see
  [Question feedback & moderation](#question-feedback--moderation) below).
- **`user_answers`** — per-user answer state, one row per (user, question).
  Each user reads/writes only their own rows (enforced by Row Level Security).
- **`profiles`** — per-user display identity (Google `name` + `avatar_url`) for
  the leaderboard, added in migration `0004_gamification.sql`, plus
  `onboarded_at` (`0005`) — when the user completed *or* dismissed the one-time
  tagging intro (`null` = never seen it; the Home modal keys off this).
- **`question_feedback`** — one tag per (user, question): `'wrong'` or
  `'quality'`. Each user reads/writes only their own rows; nobody ever sees
  anyone else's tags, only the aggregate counters on `questions`.
- **`rewards`** — an **append-only point ledger** written exclusively by the
  database (a trigger and the onboarding RPC — clients have **no write policy
  at all**). Rows are `kind='tag'` (+2, at most one per question, enforced by a
  partial unique index) or `kind='onboarding'` (+10, at most one ever). Users
  read only their own rows.

**Points & leaderboard (gamification).** A user's total is
**answer points + reward points** (`grandTotal()` in `src/lib/points.js`):

- *Answer points* are a pure function of answer state — `10` per correct,
  `3` per incorrect (`answer_points()` in migration `0004`). Existing answers
  count with no backfill, and they can't be farmed (one row per question).
- *Reward points* come from the `rewards` ledger: `+2` the first time you tag a
  question (ever — switching or re-tagging pays nothing) and `+10` for
  completing the tagging onboarding once. Granted server-side; the client only
  mirrors them optimistically.

The `leaderboard(period)` SQL function (`'all'` | `'daily'`, daily = today in
Israel local time) aggregates both parts across all users for the Home board; a
reward counts toward the daily board on the day it was created.

## Question feedback & moderation

Signed-in users can tag any question they've answered as **שגויה** (`wrong` —
factually incorrect) or **איכותית** (`quality`), one tag per (user, question).
A recount trigger on `question_feedback` maintains the denormalized
`wrong_count` / `quality_count` on `questions` and applies the rules:

- **Auto-hide:** a question reaching `wrong_count >= 3` (`WRONG_THRESHOLD`) is
  hidden — it stops being served to everyone. A `wrong` tag **from the admin**
  hides it immediately. Hiding is **sticky**: retracting a report never
  un-hides; only the admin can restore.
- **Hidden visibility:** the `questions` read policy serves hidden rows to the
  admin only (`(NOT hidden) OR is_admin()`). The client additionally filters
  `!q.hidden` everywhere except the admin's moderation list.
- **Self-reported:** a question you yourself tagged `wrong` is no longer served
  *to you* (client-side rule), even while it stays visible to everyone else.
- **High-quality pool:** `quality_count >= 2` (`QUALITY_THRESHOLD`) marks a
  question community-endorsed; the session setup's `רק שאלות איכותיות` toggle
  filters to these.
- **Admin restore:** the `admin_restore_question(qid)` RPC un-hides a question
  and deletes the `wrong` tags against it (so it doesn't immediately re-hide).
  Deleting a question cascades its feedback and tag rewards away.

Thresholds and reward values live in `src/lib/points.js` and MUST match the
literals in `supabase/migrations/0005_question_feedback.sql`.

At load time the app fetches both and **merges** them into one in-memory object
of the shape below, so the rest of the app sees the same `question` objects it
always did (content fields + the three state fields). Answer-state now syncs
automatically per signed-in user across devices — there is no more
export/import-to-sync step. `schema_version` is currently `1`.

The same object shape is still the **import/backup format**: an admin imports a
JSON array of question objects (or a `{ questions: [...] }` object) to add or
update questions in the shared store, and can export the current state as a
JSON backup. See [Import behavior](#import-behavior) below.

```json
{
  "schema_version": 1,
  "exported_at": "2026-07-02T10:30:00Z",
  "questions": [
    {
      "id": "soc-u05-a1b2",
      "course": "sociology",
      "unit": 5,
      "topic": "socialization",
      "difficulty": "medium",
      "question": "…שאלה בעברית",
      "options": ["…אפשרות א", "…אפשרות ב", "…אפשרות ג", "…אפשרות ד"],
      "answer": 2,
      "option_explanations": [
        "למה א' שגויה…", "למה ב' שגויה…", "למה ג' נכונה…", "למה ד' שגויה…"
      ],
      "explanation": "הסבר כללי (רשות)…",

      "answered_at": null,
      "last_choice": null,
      "correct": null
    }
  ]
}
```

## Top level

| Field | Type | Notes |
|---|---|---|
| `schema_version` | number | Currently `1`. Import warns (does not fail) on a mismatch. |
| `exported_at` | string (ISO 8601) | Refreshed automatically on every export. |
| `questions` | array | The question objects below. |

## Question — content fields (produced by generation chats)

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | **yes** | Globally unique and stable. All answer-state keys off it. |
| `course` | string | no | **The subject.** Machine slug (see below). Missing → grouped as "ללא". |
| `unit` | number | no | Filter axis. Missing → "ללא". |
| `topic` | string | no | Filter axis. Missing → "ללא". |
| `difficulty` | string | no | `easy` / `medium` / `hard` (free text tolerated). |
| `question` | string | **yes** | Hebrew question text. |
| `options` | string[] | **yes** | At least 2, none empty. |
| `answer` | number | **yes** | **0-based** index into `options`. Must be in range. |
| `option_explanations` | string[] | no | Parallel to `options`; each entry explains that option — crucially **why each wrong option is wrong**. If missing or a length mismatch, the app degrades to just showing correct/incorrect. |
| `explanation` | string | no | Optional overall note shown after the per-option reasons. |

## Question — state fields (per user, from `user_answers`)

These live in the `user_answers` table, keyed by `(user_id, question_id)`, and
are merged onto each question in memory. They are **per user** — every signed-in
user has their own independent answer state over the same shared questions.

| Field | Type | Notes |
|---|---|---|
| `answered_at` | string (ISO) or `null` | `null` = never answered (no row for this user/question). Doubles as the answered/unanswered flag. |
| `last_choice` | number or `null` | 0-based index the user last picked (in **original** option order, even if display was shuffled). |
| `correct` | boolean or `null` | Whether the last answer was correct. |
| `my_tag` | `'wrong'` \| `'quality'` \| `null` | This user's own tag (from `question_feedback`). Never anyone else's. |
| `tag_rewarded` | boolean | Whether this question already paid its one-time +2 tag reward (derived from `rewards`); drives the optimistic point bump. |

The app also merges the **shared** moderation columns (`hidden`, `wrong_count`,
`quality_count`) onto each question, and carries two user-level fields on the db
object itself: `rewards_total` (sum of the user's `rewards` rows) and
`onboarded_at`.

Answering a question upserts the user's row; resetting deletes it. Writes are
optimistic (local state updates immediately, the DB write happens in the
background). None of these state fields appear in the `questions` content
columns — they are stripped on import.

## Import behavior

Import is **admin-only** (the Manage tab is hidden from other users, and the
database's Row Level Security rejects writes to `questions` from anyone else).

- **Import / update** — the validated questions are **upserted** into the
  shared `questions` table by `id`: new questions are added, existing ones are
  updated. It never deletes, so no user's answer state is ever disturbed. This
  is how you top up or fix the bank from a generation chat.
- The importer accepts either a full db object **or a bare JSON array of
  question objects** (which is what the generation prompt below produces). Only
  content columns are written; state fields are ignored.
- **Export** downloads the current in-memory state (questions + *your* answer
  state) as a JSON backup — for archival, not for syncing (sync is automatic).
- Validation reports precisely which `id` failed and why (missing `question`,
  empty `options`, `answer` out of range, duplicate `id`, …) instead of failing
  silently.

## Subjects (the `course` field)

`course` is a lowercase machine **slug**. The app never hardcodes which subjects
exist — it derives the subject list from whatever slugs appear in your JSON, so
next semester's courses "just work". Slugs get nicer Hebrew labels from a small
map; an unknown slug simply shows its raw slug until you add a label.

Current slugs → Hebrew label:

| slug | label |
|---|---|
| `anthropology` | אנתרופולוגיה |
| `sociology` | סוציולוגיה |
| `psychology` | פסיכולוגיה |
| `economy` | כלכלה |
| `rome` | רומא |

**To add a subject label for a future semester:** add one line to
`COURSE_LABELS` in [`src/data/labels.js`](src/data/labels.js). No other change
is needed — filters and stats populate from the data automatically.

---

## Prompt to generate more questions (paste into a separate Claude chat)

> You are generating multiple-choice exam questions for a Hebrew study app.
> Output **only** a single JSON array of question objects — no prose, no
> markdown fence, nothing else. Each object must follow this exact shape:
>
> ```json
> {
>   "id": "<course-slug>-u<unit>-<random4>",
>   "course": "<one of: anthropology | sociology | psychology | economy | rome>",
>   "unit": <integer unit number>,
>   "topic": "<short Hebrew topic name>",
>   "difficulty": "<easy | medium | hard>",
>   "question": "<the question, in Hebrew>",
>   "options": ["<אפשרות>", "<אפשרות>", "<אפשרות>", "<אפשרות>"],
>   "answer": <0-based index of the correct option>,
>   "option_explanations": ["<why this option is right/wrong>", "..."],
>   "explanation": "<optional overall note, in Hebrew>"
> }
> ```
>
> Rules:
> - All content (`question`, `options`, `option_explanations`, `explanation`)
>   is in **Hebrew**.
> - `answer` is **0-based** (the first option is `0`).
> - `option_explanations` is an array **parallel to `options`** — same length,
>   same order. For the correct option, say why it is correct. For every wrong
>   option, give the **real reason it is wrong** — not "this is incorrect", but
>   the specific misconception it represents.
> - Write **near-miss distractors**: wrong answers that trade on the confusions
>   the material actually sets up (common mix-ups, adjacent concepts, reversed
>   definitions), not obvious throwaways.
> - Give each `id` a short **random 4-character suffix** (e.g. `-a1b2`) so ids
>   never collide across separate generation batches.
> - Do **not** include the state fields (`answered_at`, `last_choice`,
>   `correct`) — the app adds those.
>
> Generate <N> questions on <topic/unit>. Return only the JSON array.

Import the resulting file from the admin **Manage** tab. The questions are
upserted into the shared store by `id` — new questions are added, existing ones
updated — and no user's answer state is touched.
