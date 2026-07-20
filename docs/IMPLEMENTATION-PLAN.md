# Implementation Plan — Question Feedback & Tagging

Companion to [`PRD-question-feedback.md`](./PRD-question-feedback.md). Read the
PRD first — this only sequences the work. Section refs (§) point into the PRD.

## Scope verdict

~10 files + one SQL migration, on a small app with no test suite. Technically
one-shottable, but **recommended as 3 sessions**, because:

- **No backend in the build/dev environment.** The whole DB layer (RLS,
  triggers, auto-hide, rewards, `leaderboard()`) can only be verified by running
  the migration on the live Supabase and QAing there. Splitting keeps that
  unverified surface small and reviewable per session.
- Each session below ends with a **clickable increment** in `?preview` mode, so
  progress is verifiable locally without a backend.

Sessions are vertical slices (each is shippable on its own). **1 → 2 → 3 order
is required** (2 and 3 depend on 1's data layer). Could compress to 2 sessions
by merging 3 into 2; do **not** merge 1 into anything — it's the heavy one.

---

## Cross-cutting constraint (applies to every session)

The dev/build environment has **no Supabase access**. Therefore:

- Every session must keep the **`?preview` dev short-circuits** working
  (`fetchRemoteDb`, `fetchLeaderboard` already branch on `import.meta.env.DEV` +
  `PREVIEW_USER_ID`). Extend those branches to **synthesize** the new fields
  (`my_tag`, `wrong_count`, `quality_count`, `hidden`, `rewards_total`,
  `onboarded_at`) so UI is testable locally.
- The SQL migration (`0005`) is **verified by the user** running it in the
  Supabase SQL editor + the manual QA in PRD §10. No session can prove the DB
  behavior in-environment. Flag this explicitly at each handoff.
- Verification per session = `npm run dev` + open `?preview`, click the flow.

---

## Session 1 — Tagging core (data layer + tag-in-practice)

**Goal:** a signed-in user can tag a question after answering it and see +2 once;
all backend infra exists. This is the foundation + the first visible slice.

**Build:**
- `supabase/migrations/0005_question_feedback.sql` — the entire migration
  (PRD §5): `question_feedback` + RLS, `questions` counter/`hidden` columns,
  recount+auto-hide+admin-hide trigger, tag-reward insert, `questions_read`
  policy swap, `rewards` + partial unique indexes + read-own RLS,
  `profiles.onboarded_at`, the three RPCs (`complete_tag_onboarding`,
  `dismiss_tag_onboarding`, `admin_restore_question`), updated `leaderboard()`.
  Idempotent.
- `src/lib/points.js` — constants (`TAG_REWARD`, `ONBOARDING_REWARD`,
  `WRONG_THRESHOLD`, `QUALITY_THRESHOLD`) + `grandTotal(db)` = answer points +
  `db.rewards_total` (PRD §6, §8.3).
- `src/lib/api.js` — extend `QUESTION_COLUMNS`; `fetchRemoteDb` merges `my_tag`,
  `rewards_total`, `onboarded_at`; new `setTag`/`clearTag`/`claimOnboarding`/
  `dismissOnboarding`/`adminRestoreQuestion`; **preview synth** for all new
  fields (PRD §8.2).
- `src/lib/session.js` — `highQualityOnly` predicate in `applyFilters` + hidden
  exclusion (PRD §8.5). (Toggle UI comes in Session 2; the predicate lands now.)
- `src/App.jsx` — reducer `TAG_QUESTION`/`CLEAR_TAG` (+ optimistic reward with a
  `rewardedQuestionIds` set), onboarding local actions, `persistDispatch`
  wiring, client-side `!q.hidden` filtering, `highQualityOnly` in
  `DEFAULT_CONFIG` (PRD §8.4).
- `src/components/TagBar.jsx` (new) + `Practice.jsx` integration + thank-you
  affirmation + `styles.css` for the bar/pill (PRD §7.1, §8.6–8.7, §8.12).

**Definition of done / verify (`?preview`):** answer a question → tag bar
appears → tag `שגויה` → +2 once, affirmation shows → switch to `איכותית` / clear
→ no further points → revisit question later → own tag shows selected. No
regressions to the existing answer/points flow.

**Handoff note to user:** run `0005` on Supabase; run PRD §10 DB QA (3-user
auto-hide, admin instant-hide, leaderboard totals).

---

## Session 2 — Discovery & moderation

**Goal:** users can filter to community-high-quality questions; admin can review
and act on reported/hidden questions. (Depends on Session 1's data layer.)

**Build:**
- `src/components/SessionSetup.jsx` — `רק שאלות איכותיות` toggle bound to
  `config.highQualityOnly`; show matched-count / empty-state so a thin result
  isn't surprising (PRD §7.2, §8.8).
- `src/components/ImportExport.jsx` — "שאלות שדווחו" moderation card: list
  `wrong_count > 0 || hidden`, sorted desc, with `מוסתרת` badge, **Restore**
  (`adminRestoreQuestion`) and **Delete** (existing `deleteQuestions` +
  confirm), + `styles.css` (PRD §7.4, §8.11).
- `src/components/Home.jsx` — points hero uses `grandTotal` (answer + rewards)
  (PRD §8.9, first bullet).

**Definition of done / verify:** in `?preview`, toggling high-quality narrows the
pool to synthesized `quality_count >= 2` questions and composes with course/state
filters; admin Manage tab lists reported questions and Restore/Delete update the
list. Live-DB: restore un-hides + clears reports.

---

## Session 3 — Onboarding + docs

**Goal:** first-time users get the one-time Home demo (+10 once); docs updated.
(Depends on Session 1's RPCs + `onboarded_at`.)

**Build:**
- `src/components/OnboardingModal.jsx` (new) — interactive demo on a **mock**
  question (no DB writes for the demo tap); Complete → `claimOnboarding()` →
  +10; Skip → `dismissOnboarding()` (PRD §7.3, §8.10). Reuse the existing
  `modal-overlay`/`modal` pattern from `ImportExport.jsx`.
- `src/components/Home.jsx` — show modal when `onboarded_at == null`; small
  re-open affordance (account menu) that never re-awards (PRD §8.9).
- `src/styles.css` — modal styling.
- `SCHEMA.md` + `README.md` — new tables/columns, "points = answers + rewards",
  hidden semantics, feature bullet (PRD §8.13).

**Definition of done / verify:** in `?preview`, a user with synthesized
`onboarded_at == null` sees the modal once; Complete grants +10 and it doesn't
reappear; Skip grants nothing and doesn't reappear; re-open from the menu grants
nothing. Docs reflect the shipped model.

---

## Compression option

Merge Session 3 into Session 2 for a **2-session** plan (Session 1 unchanged).
Keep Session 1 standalone regardless — it carries the migration and the shared
data layer that everything else imports.
