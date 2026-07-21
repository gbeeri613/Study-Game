# תרגול מבחנים — MC Exam Prep

A multi-user multiple-choice practice app for exam prep. Content is in Hebrew
and rendered RTL. Users sign in with Google; a shared question bank lives in
**Supabase (Postgres)** and each user's answer state, tags, and points sync
automatically across devices. `localStorage` is kept as an offline read cache.

Built with Vite + React, no state library. There's no router library either —
the `view` state machine is mirrored into the browser History API so the phone's
Back button walks back through the app (setup → home, etc.) instead of exiting.

## Features

- **Google sign-in**, one shared question bank, per-user answer state synced
  via Supabase (Row Level Security keeps every user's rows their own).
- Filter by course/subject, unit, topic, difficulty, and state (unanswered /
  answered / incorrect / correct) — filter values are derived from the data.
- Answer flow reveals correct vs. your pick and surfaces the per-option
  explanations — emphasizing **why the wrong options are wrong**. Re-answer any
  time; a mistakes-review reruns what you missed.
- **Points & leaderboards:** 10 points per correct answer, 3 per incorrect,
  plus rewards (below); all-time and daily boards on Home.
- **Question feedback:** after answering, tag a question as שגויה (factually
  wrong) or איכותית (high quality) from the question card's meta row — +2
  points the first time you tag each question. Questions reported wrong by 3
  students are auto-hidden; a `רק שאלות איכותיות` toggle in session setup
  filters to community-endorsed questions. A one-time interactive intro on Home
  teaches the control (+10 points). See
  [`docs/PRD-question-feedback.md`](docs/PRD-question-feedback.md).
- **Admin tools** (Manage tab): import/export the bank as JSON, delete by
  course, and a moderation card listing reported questions with restore/delete.
- Keyboard on desktop: number keys pick an option, Enter/Space advances, arrow
  keys move between questions.

## Run locally

```bash
npm install
npm run dev
```

Open the printed URL (default http://localhost:5173). Real data needs
`VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` in `.env` (see `.env.example`);
without a backend you can develop UI against the cached db with `?preview`
appended to the URL (dev builds only — it skips login and synthesizes the
server-side fields).

### Test it on your phone

Your phone and computer must be on the same Wi-Fi.

```bash
npm run dev -- --host
```

Vite prints a **Network** URL like `http://192.168.1.42:5173`. Open that on your
phone's browser. You can also "Add to Home Screen" for an app-like launch
(manifest included).

## How the data works

- Supabase is the source of truth: the shared `questions` table plus per-user
  `user_answers`, `question_feedback`, `rewards`, and `profiles` rows are
  fetched on sign-in and merged into one in-memory db object.
- **Import** (admin, Manage tab) upserts questions from a JSON file or a
  generation chat's output into the shared bank — new ids are added, existing
  ones updated, nothing is deleted. **Export** downloads a JSON backup.
- See [`SCHEMA.md`](SCHEMA.md) for the exact data contract — tables, RLS, the
  points model, moderation semantics — **and a ready-to-paste prompt** for
  generating more questions in a separate Claude chat.

## Build & deploy

```bash
npm run build      # outputs to dist/
npm run preview    # serve the production build locally
```

Deployed on **Vercel** as a static Vite SPA (build command `npm run build`,
output `dist`, the two `VITE_SUPABASE_*` env vars set in the project). Push to
`main` and Vercel redeploys. Database changes ship as idempotent SQL files in
`supabase/migrations/`, run manually in the Supabase SQL editor.

## Project structure

```
index.html                 RTL, lang="he", manifest link
src/
  main.jsx                 React entry
  App.jsx                  db reducer + history-synced view machine + Supabase mirror
  styles.css               all styling (RTL, mobile-first)
  data/
    labels.js              subject slug → Hebrew label (add subjects here)
  lib/
    api.js                 Supabase reads/writes + ?preview synthesis
    points.js              points model: answer points + rewards, thresholds
    session.js             filtering + option-shuffle mapping (pure)
    storage.js             localStorage cache + JSON export/backup
    supabase.js            client init
    useAuth.js             Google auth hook + admin check + ?preview user
    validate.js            import validation
  components/
    Home.jsx               hero, course cards, leaderboard, tag onboarding
    SessionSetup.jsx       build a practice session
    Practice.jsx           question runner + reveal + TagBar
    TagBar.jsx             wrong/quality tag icons + confirm popovers
    OnboardingModal.jsx    one-time interactive tagging intro (+10)
    Summary.jsx            session results
    ImportExport.jsx       admin: import/export/tools + moderation
    Login.jsx              Google sign-in screen
supabase/migrations/       idempotent SQL, run in order in the SQL editor
docs/                      PRD + implementation plan for question feedback
SCHEMA.md                  the data contract + generation prompt
```
