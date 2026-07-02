# Data Schema — the contract

The entire database is **one JSON object**. It holds both the question content
**and** your answer-state, and it is the only thing that moves between devices:
export it on one device, import it on the other. `schema_version` is currently
`1`.

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

## Question — state fields (the app writes these)

| Field | Type | Notes |
|---|---|---|
| `answered_at` | string (ISO) or `null` | `null` = never answered. Doubles as the answered/unanswered flag. |
| `last_choice` | number or `null` | 0-based index you last picked (in **original** option order, even if display was shuffled). |
| `correct` | boolean or `null` | Whether the last answer was correct. |

Re-answering a question overwrites these three. Unknown extra fields on a
question are **preserved** on import, not stripped.

## Import behavior

- **Replace** — the imported file becomes the entire database. This is the
  cross-device sync path. Before replacing, the app auto-downloads a backup of
  the current database and asks you to confirm.
- **Merge new questions** — adds only questions whose `id` isn't already
  present; existing questions and their state are left untouched. This is how
  you top up the bank from a generation chat without losing progress.
- The importer accepts either a full db object **or a bare JSON array of
  question objects** (which is what the generation prompt below produces).
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

Import the resulting file with **Merge** to add the new questions without
touching your existing progress.
