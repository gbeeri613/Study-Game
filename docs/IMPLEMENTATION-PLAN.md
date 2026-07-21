# Implementation Plan — Question Feedback & Tagging

Companion to [`PRD-question-feedback.md`](./PRD-question-feedback.md). Read the
PRD first — this only sequences the work. Section refs (§) point into the PRD.

---

## STATUS (updated 2026-07-21, Session 3)

**All three sessions are COMPLETE, MERGED, and the migration is LIVE on
production.** Session 1 merged as PR #15 (`5068c2d`), Session 2 as PR #16
(`a98d8ad`), Session 3 as PR #17 (`5ac597d`). The feature is fully shipped.

- **Restore — VERIFIED on production (2026-07-21).** The owner clicked שחזר on
  a real reported question in the deployed app; the row un-hid and left the
  moderation list. This was the last client path that had only ever been
  proven in SQL.

**The one remaining untested path:**

- **The 3-report auto-hide quorum** cannot be exercised from the admin account
  (an admin `wrong` tag hides immediately). Needs a non-admin user — any
  second Google account tagging the same question `wrong` three times over
  three accounts, or just organic usage once other students are on the app.
  Low risk: the same trigger path (recount + threshold compare) was proven in
  the SQL QA pass; only the "three real non-admin clients" variant is unproven.

**The DB is already migrated — do NOT re-run `0005` expecting it to be pending.**
It was applied to the `Arrow Quiz` Supabase project (ref `lyfzjsgverchjdjgvnfv`)
and verified. It is idempotent, so re-running is harmless, but it is not a
pending step.

Verified on the live DB (both QA passes used a self-aborting transaction — a
deliberate `raise exception` at the end — so **nothing was written to
production**):

- Schema: 4 new `questions` columns, `profiles.onboarded_at`, both anti-farm
  partial unique indexes, all 5 functions, the recount trigger, and
  `questions_read` = `((NOT hidden) OR is_admin())`. `rewards` has a SELECT
  policy and **no write policy at all**.
- Trigger behaviour: quality tag → count+reward; switch tag → no second reward;
  2 wrong → still visible; 3 wrong → auto-hidden; retract → stays hidden
  (sticky); clear-and-retag farm attempt → still only 2 points total.
- **RLS as a real `authenticated` user** (forged JWT claim, so policies actually
  apply — the SQL editor runs as `postgres`, which bypasses RLS and proves
  nothing): own insert allowed; the SECURITY DEFINER trigger successfully writes
  the admin-only `questions` table and the no-write-policy `rewards` table on a
  non-admin's behalf; direct `rewards` insert blocked; tagging as another user
  blocked; other users' tags invisible; `admin_restore_question` refused.

### Deviations from this plan, already made

1. **Home hero → `grandTotal` was pulled forward from Session 2 into Session 1.**
   Shipping Session 1 alone would otherwise award +2 while the Home total sat
   still. Session 2's first bullet is therefore already done.
2. **The tag UI was redesigned after the first build.** The "compact bar below
   the options" is gone, replaced by two icons in the question card's meta row
   with confirm popovers. PRD §7.1 / §8.6 / §8.7 have been rewritten to match —
   trust the PRD, and note the ASCII bar mock no longer exists there.
3. **Self-reported questions are suppressed for the reporter** — a new rule from
   the owner, not in the original PRD. See PRD §9 "Self-reported questions".
4. `IconFileX` and `IconStar` were added to `Icons.jsx`.
5. **The preview synth now models a hidden question** (Session 2). It used to
   pin `hidden: false` for every row, which made the `מוסתרת` badge, Restore,
   and the hidden-exclusion filter unreachable in `?preview`. One id bucket is
   now auto-hidden with `wrong_count = WRONG_THRESHOLD`.

### ~~Known gap carried into Session 2~~ — CLOSED 2026-07-21

**The client→Supabase round trip has now run end to end on production.** Two
questions were tagged in the deployed app (`study-game-zeta.vercel.app`, real
build, no `?preview`) and the rows were read back through the *authenticated*
client — so this also confirms RLS lets a user read their own rows, the path
`fetchRemoteDb` depends on:

- `question_feedback`: 2 rows (`anthropology-u1-4tet`=quality,
  `anthropology-u6-a4c1`=wrong) — so `onConflict: 'user_id,question_id'`
  resolves against the real PK.
- `rewards`: 2 × `kind='tag'`, `points=2`. The SECURITY DEFINER trigger fires
  for an ordinary client write, not just under the forged-JWT test.
- Counters recounted on both questions; `rewards_total` = 4.
- The full `QUESTION_COLUMNS` string returns 200 with all 13 columns, and
  `maybeSingle()` on `profiles` returns exactly one row.

Corroborating detail: on both rows `updated_at` precedes `created_at` by ~90ms
— the client-supplied `new Date().toISOString()` from `setTag` sitting beside
the server's `default now()`. The payload that landed is the one `api.js`
builds.

**Note for future testing:** the admin's own `wrong` tag hides a question
immediately (migration line ~157), so `wrong_count=1` + `hidden=true` is
correct, not a threshold bug — and the 3-report quorum path **cannot** be
exercised from the admin account. It needs a non-admin user.

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

## Session 1 — Tagging core (data layer + tag-in-practice) — ✅ DONE

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

**Definition of done / verify (`?preview`) — ALL VERIFIED:** answer a question →
tag icons appear in the meta row → tap → confirm popover → confirm → +2 once,
thank-you shows → re-tag → thank-you with no points, total unchanged → tap lit
icon → instant clear, no popover → reported question no longer served in the
next session (counts drop by one) → retract → it returns.

**Handoff note to user:** ~~run `0005` on Supabase~~ — **already applied and
verified on production**, including the RLS-as-real-user pass. See STATUS above.

---

## Session 2 — Discovery & moderation — ✅ DONE

**Goal:** users can filter to community-high-quality questions; admin can review
and act on reported/hidden questions. (Depends on Session 1's data layer.)

**Already done in Session 1, skip these:** the `highQualityOnly` predicate exists
in `applyFilters` and `DEFAULT_CONFIG` (only the *toggle UI* is missing), and the
Home hero already uses `grandTotal`. `adminRestoreQuestion()` already exists in
`api.js` — only the panel that calls it is missing.

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

**Definition of done / verify — VERIFIED in `?preview`:** toggling high-quality
narrowed the pool 57 → 17 and composed with course/unit/state filters; the count
slider and start button recomputed; the Manage tab listed 14 reported questions
sorted by `wrong_count` desc with `מוסתרת` badges, and the delete confirmation
showed the full (untruncated) question text.

**Deviations from the plan above:**

1. **The Home hero bullet was already done** in Session 1 (deviation #1), so
   `Home.jsx` was not touched this session.
2. **A second empty state was added** to `SessionSetup.jsx`, beyond "show
   matched-count". When the pool is empty *because of* the quality filter, the
   pre-existing empty state claimed `כל הכבוד! כבר ענית נכון על כל השאלות` —
   flatly wrong, and the common case early on. It now branches on
   `poolAll > 0` and offers a one-tap `כבה סינון איכות`.
3. **`aria-label` on the toggle input**, so its accessible name doesn't change
   every time the matched count changes.
4. **The preview synth was extended** to model a hidden question — see
   deviation #5 in STATUS.

**Still only provable on the live DB:** in `?preview` the Restore button shows
its success toast but the row does not disappear — `adminRestoreQuestion` no-ops
there and the synth re-derives `hidden` from the question id on every load.
~~That restore actually un-hides and clears reports is untested outside SQL.~~
**Closed 2026-07-21** — the owner ran Restore on a real reported question in
the deployed app and the row un-hid (see STATUS).

---

## Session 3 — Onboarding + docs — ✅ DONE

**Goal:** first-time users get the one-time Home demo (+10 once); docs updated.
(Depends on Session 1's RPCs + `onboarded_at`.)

**Already done in Session 1, skip these:** `claimOnboarding()` /
`dismissOnboarding()` exist in `api.js`; the `ONBOARDING_DONE` /
`ONBOARDING_SKIP` reducer actions and their `persistDispatch` wiring exist in
`App.jsx`; `db.onboarded_at` is fetched and synthesized in preview. **Only the
modal component and its Home trigger are missing.**

Note the onboarding demo must mirror the *as-built* tag UI (icons + confirm
popover, PRD §7.1), not the original tag-bar design — a demo that teaches a
control the app no longer has would be worse than no demo.

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

**Definition of done / verify — ALL VERIFIED in `?preview`:** modal auto-shows
when `onboarded_at == null`; Complete bumps the hero +10, shows the `+10 נק׳`
affirmation, closes, and doesn't reappear on reload; dismissing grants nothing
and doesn't reappear (`rewards_total` stayed 0 in localStorage); re-open from
the account menu is read-only; the demo tap opens the real confirm popover and
lands the reinforcement line with no +2 promised.

**Deviations from the plan above:**

1. **The demo embeds the real `<TagBar>`**, not a mock control, with
   `tagRewarded` pinned true — so the demo can never drift from the shipped UI
   and its thank-you never shows a `+2` the mock tap doesn't grant.
2. **Dismissing the overlay counts as Skip** on the first showing (calls
   `dismiss_tag_onboarding`), so an accidental outside-tap also stops the
   auto-nag — consistent with "Skip grants nothing and doesn't reappear".
3. **Re-open (menu item `איך מתייגים שאלות?`) is strictly read-only:** same
   demo, one close button, no RPCs. Consequence: the +10 is only claimable on
   the first showing — a user who skipped cannot claim it later, which is the
   literal DoD ("re-open grants nothing") though the server-side
   `complete_tag_onboarding` would technically still pay a skipper.
4. **`README.md` was modernized wholesale**, not just given a feature bullet —
   it still described the pre-Supabase local-JSON app (no backend, JSON
   export/import as sync, a project tree of files that no longer exist).
5. **`.env.example` added** (the supabase.js error copy referenced it but it
   was never committed) plus a `.gitignore` exception for it.

---

## Compression option

Merge Session 3 into Session 2 for a **2-session** plan (Session 1 unchanged).
Keep Session 1 standalone regardless — it carries the migration and the shared
data layer that everything else imports.
