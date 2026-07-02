# תרגול מבחנים — MC Exam Prep

A fully client-side (no backend, no database, no server) multiple-choice
practice app for exam prep. Content is in Hebrew and rendered RTL. **One JSON
file is the entire database** — it holds both the questions and your
answer-state. You sync between devices by exporting the JSON on one and
importing it on the other. Progress persists per-device in `localStorage`.

Built with Vite + React, no router, no state library.

## Run locally

```bash
npm install
npm run dev
```

Open the printed URL (default http://localhost:5173).

On first run the app is empty — click **טען שאלות לדוגמה** (load sample
questions) to click through immediately, or go to the **ניהול** (Manage) tab to
import your own JSON.

### Test it on your phone

Your phone and computer must be on the same Wi-Fi.

```bash
npm run dev -- --host
```

Vite prints a **Network** URL like `http://192.168.1.42:5173`. Open that on your
phone's browser. State on the phone is independent from the laptop — move
progress between them with export/import (below). You can also "Add to Home
Screen" for an app-like launch (manifest included; no offline service worker by
design, to avoid stale caches).

## How the data works

- **Export JSON** (Manage tab) downloads the whole database as
  `mc-bank_YYYYMMDD-HHMM.json`. This is both your backup and your sync file.
- **Import** offers two modes:
  - **Replace** — the file becomes the entire database (cross-device sync). A
    backup of the current data is auto-downloaded first, then you confirm.
  - **Merge** — adds only questions with new `id`s; existing questions and
    their state are untouched (top up the bank from a generation chat).
- See [`SCHEMA.md`](SCHEMA.md) for the exact data contract **and a ready-to-paste
  prompt** for generating more questions in a separate Claude chat.

## Features

- Filter by course/subject, unit, topic, difficulty, and state (unanswered /
  answered / incorrect / correct) — filter values are derived from your data.
- Session order sequential or shuffled; optional per-question option shuffle
  (scoring maps back to the correct index).
- Answer flow reveals correct vs. your pick and surfaces the per-option
  explanations — emphasizing **why the wrong options are wrong**. Re-answer any
  time.
- Keyboard on desktop: number keys pick an option, Enter/Space advances, arrow
  keys move between questions.
- Stats dashboard: answered vs. remaining, overall % correct, and per-course /
  per-unit / per-topic accuracy.

## Build

```bash
npm run build      # outputs to dist/
npm run preview    # serve the production build locally
```

## Deploy to Vercel

It's a pure static SPA, so Vercel needs no configuration.

1. Push this repo to GitHub.
2. On [vercel.com](https://vercel.com) → **Add New… → Project** → import the
   repo.
3. Vercel auto-detects Vite. Confirm: **Build Command** `npm run build`,
   **Output Directory** `dist`. Leave everything else default (no env vars).
4. **Deploy.** You get a URL you can open on your phone.

Each device keeps its own local state; sync between them with the JSON
export/import. To update the app, push to GitHub and Vercel redeploys.

## Project structure

```
index.html                 RTL, lang="he", manifest link
src/
  main.jsx                 React entry
  App.jsx                  db reducer + tabs + localStorage mirror
  styles.css               all styling (RTL, mobile-first)
  data/
    labels.js              subject slug → Hebrew label (add subjects here)
    seed.js                sample questions
  lib/
    storage.js             localStorage + JSON export/backup
    validate.js            import validation + merge/replace
    session.js             filtering + option-shuffle mapping (pure)
  components/
    FilterBar.jsx          build a practice session
    Practice.jsx           question runner + reveal
    Stats.jsx              dashboard
    ImportExport.jsx       import/export/tools
public/
  manifest.webmanifest     add-to-home-screen
  icon.svg
SCHEMA.md                  the data contract + generation prompt
```
