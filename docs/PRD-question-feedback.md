# PRD — Question Feedback & Tagging

**Status:** Ready for implementation
**Branch to implement on:** `claude/ai-question-feedback-prd-08pfxw` (or a fresh
branch off the latest default if this one has merged)
**Owner:** gbeeri613
**Last updated:** 2026-07-20

> This document is written to be implemented by a future session with no prior
> context. It references the codebase as it stands today. Read `SCHEMA.md` and
> the files under `src/lib/` and `supabase/migrations/` before starting.

---

## 1. Background & problem

Questions in this app are **AI-generated**, and quality varies:

| Category | Prevalence | What we do about it |
|---|---|---|
| **Definitely wrong** — wrong answer key, or a factual error in the stem/options | ~2%, rare but real | Let users flag them; auto-hide after enough flags; admin reviews. |
| **Hard but good** — the ideal | — | Protect these. Do **not** let "hard" be mistaken for "wrong". |
| **Bad phrasing / overly complex** | Common, but hard to tell from "hard but good" | **Out of scope for v1.** |
| **Trivial / too easy** | Occurs; subjective | **Out of scope for v1.** |

We want a lightweight feedback mechanism that gets users to **tag the outliers,
not grade every question**. Two tags ship in v1:

1. **"שגויה" (wrong)** — moderation signal. Enough of these → the question is
   auto-removed from the active pool and shown only to the admin.
2. **"שאלה איכותית" (high quality)** — a positive signal that powers a
   **"high-quality only"** filter in the session setup flow.

Design principles carried throughout:

- **Tag outliers, not everything.** Tagging is always optional; most questions
  get no tag. Microcopy actively discourages over-tagging.
- **Neutrality.** A user never sees other users' tags or any aggregate counts.
  They only ever see their *own* tag on a question.
- **Short, easy, rewarding.** One tap, an affirming "thank you", and a small
  point reward.
- **Never disturb answer state.** Consistent with the existing data model,
  nothing here deletes or mutates any user's `user_answers` rows or their
  earned answer-points.

---

## 2. Goals & non-goals

### Goals
- Let a signed-in user attach at most one optional tag (`wrong` | `quality`) to
  any question **after answering it**.
- Auto-hide a question from all non-admin users once it accrues
  **`WRONG_THRESHOLD` (=3)** distinct "wrong" tags (or a single admin "wrong"
  tag).
- Surface hidden/reported questions to the admin for review, with **restore**
  and **delete** actions.
- Add a **"high-quality only"** toggle to session setup, backed by a community
  threshold (**`QUALITY_THRESHOLD` (=2)** distinct "quality" tags).
- Reward tagging: **+2 points**, once per (user, question), ever.
- A one-time **onboarding modal on the Home screen** with an interactive tag
  demo on a *mock* question, rewarding **+10 points** on completion.
- Keep points **server-authoritative** and **un-farmable**.

### Non-goals (v1)
- Tags for "bad phrasing" or "trivial".
- Showing users any aggregate/other-user tag data.
- Free-text feedback / comments.
- Editing question content from within the feedback UI (admin still fixes
  content via the existing import flow).
- Notifications to the admin.

---

## 3. Roles

- **User** (any signed-in Google account): answers questions, tags them, sees
  the high-quality filter and the onboarding.
- **Admin** (`gbeeri613@gmail.com`, per `is_admin()` in `0001_init.sql` /
  `isAdmin()` in `useAuth.js`): everything a user can do, **plus** the
  moderation panel. An admin "wrong" tag hides a question immediately.

---

## 4. The core tension this feature introduces (read this first)

Today, **points are a pure function of answer state** — a user's total is
`SUM(answer_points)` over their `user_answers` rows (see `SCHEMA.md`,
`src/lib/points.js`, and `leaderboard()` in `0004_gamification.sql`). That
invariant is what makes points un-farmable and backfill-free.

**Tag rewards and onboarding rewards are events, not answer state.** They cannot
be derived from `user_answers`, so v1 introduces a dedicated, server-authoritative
**`rewards` ledger**. From now on:

> **user total = answer-points (from `user_answers`) + reward-points (from `rewards`)**

Both the SQL `leaderboard()` function **and** the client point math must be
updated together and kept in sync — exactly as `answer_points()` and
`points.js` are kept in sync today.

Rewards are **never written by the client directly** (that would allow forging
points). They are created only by `SECURITY DEFINER` database code:
- a trigger on the feedback table (for tag rewards), and
- an RPC (for the onboarding reward).

Clients may only **read their own** reward rows (to render the total optimistically).

---

## 5. Data model

New migration: **`supabase/migrations/0005_question_feedback.sql`**. (Numbering
continues from 0004; 0002 was never used.)

### 5.1 `question_feedback` — one tag per (user, question)

```sql
create table if not exists public.question_feedback (
  user_id     uuid not null references auth.users (id) on delete cascade,
  question_id text not null references public.questions (id) on delete cascade,
  tag         text not null check (tag in ('wrong', 'quality')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, question_id)   -- at most ONE tag per user per question
);

create index if not exists question_feedback_question_idx
  on public.question_feedback (question_id);
```

- **Mutual exclusivity** (Q2) is enforced structurally: a single `tag` column +
  PK on `(user_id, question_id)`. Switching tags is an `UPDATE`; clearing a tag
  is a `DELETE`.
- Storing `user_id` is required for dedup, retraction, and per-user display.

**RLS — mirrors `user_answers` (own rows only):**

```sql
alter table public.question_feedback enable row level security;

drop policy if exists question_feedback_own on public.question_feedback;
create policy question_feedback_own
  on public.question_feedback
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

A user can never read another user's tags → neutrality holds at the DB layer.

### 5.2 Denormalized counters + hidden flag on `questions`

Rather than aggregating on every read, maintain counters on the (admin-owned)
`questions` table, updated by a trigger:

```sql
alter table public.questions
  add column if not exists wrong_count   integer not null default 0,
  add column if not exists quality_count integer not null default 0,
  add column if not exists hidden        boolean not null default false,
  add column if not exists hidden_at     timestamptz;
```

### 5.3 Trigger: recount + auto-hide

```sql
-- Tunable moderation constant. Keep in sync with WRONG_THRESHOLD in JS config.
-- (Inlined here; there is no SQL "constants" table.)
create or replace function public.recount_question_feedback()
returns trigger
language plpgsql
security definer          -- must bypass RLS to write the admin-only questions table
set search_path = public
as $$
declare
  qid   text := coalesce(new.question_id, old.question_id);
  w     integer;
  qual  integer;
  threshold constant integer := 3;   -- WRONG_THRESHOLD
begin
  select
    count(*) filter (where tag = 'wrong'),
    count(*) filter (where tag = 'quality')
  into w, qual
  from public.question_feedback
  where question_id = qid;

  update public.questions
  set wrong_count   = w,
      quality_count = qual,
      -- Auto-hide once the threshold is reached, OR when the admin flags it.
      -- Sticky once hidden (Q12): only admin restore clears it — see below.
      hidden = case
                 when hidden then true
                 when w >= threshold then true
                 else hidden
               end,
      hidden_at = case
                    when not hidden and w >= threshold then now()
                    else hidden_at
                  end
  where id = qid;

  return null;
end;
$$;

create trigger question_feedback_recount
  after insert or update or delete on public.question_feedback
  for each row execute function public.recount_question_feedback();
```

**Admin instant-hide (Q9):** handled in the reward/insert path below by checking
`is_admin()`. The simplest robust approach is a second, tiny statement inside a
`before insert` or within the same trigger: if the *current* caller is the admin
and the new tag is `wrong`, force `hidden = true` immediately regardless of
count. Implementation note for the builder:

```sql
-- inside recount_question_feedback(), after computing w/qual, before/within UPDATE:
if public.is_admin() and coalesce(new.tag, '') = 'wrong' then
  update public.questions
    set hidden = true, hidden_at = coalesce(hidden_at, now())
    where id = qid;
end if;
```

`is_admin()` reads the JWT of the current request, which during a user's own
insert is that user — so this correctly fires only for the admin.

### 5.4 Read policy: hide from non-admins

Replace the current `questions_read` policy so hidden questions are simply not
returned to non-admins. The client needs **no** change to make them "disappear"
— they never arrive.

```sql
drop policy if exists questions_read on public.questions;
create policy questions_read
  on public.questions
  for select
  to authenticated
  using (not hidden or public.is_admin());
```

> **Client caveat (important):** the **admin** *does* receive hidden rows (so the
> moderation panel can show them). Therefore the client must exclude
> `q.hidden` from normal practice/Home/setup for the admin too — hidden
> questions appear **only** in the admin moderation panel. See §8.5.

### 5.5 `rewards` — the point ledger

```sql
create table if not exists public.rewards (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('tag', 'onboarding')),
  question_id text references public.questions (id) on delete cascade,  -- null for onboarding
  points      integer not null,
  created_at  timestamptz not null default now()
);

-- Anti-farm (Q7): at most one 'tag' reward per (user, question), ever;
-- at most one 'onboarding' reward per user, ever.
create unique index if not exists rewards_tag_once
  on public.rewards (user_id, question_id) where kind = 'tag';
create unique index if not exists rewards_onboarding_once
  on public.rewards (user_id) where kind = 'onboarding';

create index if not exists rewards_user_idx on public.rewards (user_id);
create index if not exists rewards_created_idx on public.rewards (created_at);
```

**RLS — read own only; NO client writes** (writes happen only via definer code):

```sql
alter table public.rewards enable row level security;

drop policy if exists rewards_read_own on public.rewards;
create policy rewards_read_own
  on public.rewards
  for select
  to authenticated
  using (auth.uid() = user_id);
-- deliberately no insert/update/delete policy → users cannot forge points.
```

### 5.6 Award the tag reward (extend the recount trigger, or a second trigger)

On **first** tag of a question by a user, grant +2 once. Because `rewards` has a
partial unique index, an idempotent insert is safe:

```sql
-- Add to the AFTER INSERT path (only on INSERT, not UPDATE/DELETE):
insert into public.rewards (user_id, question_id, kind, points)
values (new.user_id, new.question_id, 'tag', 2)   -- TAG_REWARD
on conflict do nothing;
```

Switching a tag later (`UPDATE`) or clearing it (`DELETE`) never grants or claws
back points. Re-adding a tag hits the unique index → no second reward.

### 5.7 Onboarding: "seen" flag + reward RPCs

Track "seen" separately from "rewarded" so that **skipping** dismisses the modal
without granting points, while **completing** grants +10 once.

```sql
alter table public.profiles
  add column if not exists onboarded_at timestamptz;   -- set when seen (complete OR skip)

-- Complete: mark seen + grant +10 once. Idempotent.
create or replace function public.complete_tag_onboarding()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set onboarded_at = coalesce(onboarded_at, now())
    where id = auth.uid();
  insert into public.rewards (user_id, kind, points)
    values (auth.uid(), 'onboarding', 10)             -- ONBOARDING_REWARD
    on conflict do nothing;
end;
$$;

-- Skip: mark seen only (no points).
create or replace function public.dismiss_tag_onboarding()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set onboarded_at = coalesce(onboarded_at, now())
    where id = auth.uid();
end;
$$;

grant execute on function public.complete_tag_onboarding() to authenticated;
grant execute on function public.dismiss_tag_onboarding() to authenticated;
```

> Note: `profiles` rows are upserted on sign-in (`upsertProfile` in `api.js`).
> Ensure `onboarded_at` is included in the profile fetch (see §8.2) so the
> client knows whether to show the modal. A brand-new user whose profile row is
> created this session has `onboarded_at = null` → show onboarding.

### 5.8 Admin restore RPC

Restoring must (a) un-hide and (b) clear the accumulated `wrong` tags so the
question doesn't instantly re-hide. Admin cannot delete other users' feedback
rows under RLS, so use a definer RPC:

```sql
create or replace function public.admin_restore_question(qid text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  delete from public.question_feedback where question_id = qid and tag = 'wrong';
  update public.questions
    set hidden = false, hidden_at = null, wrong_count = 0
    where id = qid;
end;
$$;

grant execute on function public.admin_restore_question(text) to authenticated;
```

Deleting a reported question outright uses the **existing** `deleteQuestions`
path (`api.js`) — cascades remove its feedback and reward rows.

### 5.9 Update `leaderboard()` to include rewards

Extend the function from `0004_gamification.sql` so tallies include reward
points. Daily = answers answered today (by `answered_at`) **plus** rewards
created today (by `created_at`), Israel local time (Q8).

```sql
create or replace function public.leaderboard(period text default 'all')
returns table (user_id uuid, name text, avatar_url text, points bigint, rank bigint)
language sql
security definer
set search_path = public
stable
as $$
  with answer_tally as (
    select ua.user_id, sum(public.answer_points(ua.correct))::bigint as pts
    from public.user_answers ua
    where ua.answered_at is not null
      and (period is distinct from 'daily'
           or (ua.answered_at at time zone 'Asia/Jerusalem')::date
              = (now() at time zone 'Asia/Jerusalem')::date)
    group by ua.user_id
  ),
  reward_tally as (
    select r.user_id, sum(r.points)::bigint as pts
    from public.rewards r
    where (period is distinct from 'daily'
           or (r.created_at at time zone 'Asia/Jerusalem')::date
              = (now() at time zone 'Asia/Jerusalem')::date)
    group by r.user_id
  ),
  tallies as (
    select user_id, sum(pts)::bigint as points from (
      select user_id, pts from answer_tally
      union all
      select user_id, pts from reward_tally
    ) u
    group by user_id
  )
  select t.user_id,
         coalesce(p.name, 'משתמש') as name,
         p.avatar_url,
         t.points,
         rank() over (order by t.points desc) as rank
  from tallies t
  left join public.profiles p on p.id = t.user_id
  where t.points > 0
  order by t.points desc, name asc
$$;
```

---

## 6. Config constants (single source of truth)

Add to `src/lib/points.js` (and mirror the numeric literals in the SQL above —
they are inlined there because Postgres has no shared-constant mechanism):

```js
export const TAG_REWARD = 2;          // points for tagging (once per question)
export const ONBOARDING_REWARD = 10;  // points for completing onboarding (once)
export const WRONG_THRESHOLD = 3;     // 'wrong' tags → auto-hide  (also in SQL trigger)
export const QUALITY_THRESHOLD = 2;   // 'quality' tags → eligible for high-quality filter
```

Any change to `WRONG_THRESHOLD` or the reward values **must** be made in both
`points.js` and `0005_question_feedback.sql`.

---

## 7. User experience & flows

### 7.1 Tagging during practice (`Practice.jsx`)

**When it appears (Q4):** the tag icons render as soon as the first attempt is
recorded (`attempted === true`) — independent of whether the pick was correct
(the runner never reveals the answer on a wrong pick, and a "wrong" tag is often
exactly the reaction to a confident pick being marked wrong). It stays visible
until the user advances. Available in every context a question is answered,
including mistakes-review and re-answers (Q5).

**Layout (AS BUILT, 2026-07-21 — supersedes the original "compact bar below the
options" design):** two small icons tucked into the question card's **meta row**,
pushed to the far end so they sit inline with the course / answered-state chips.
No standing bar; the affordance is nearly invisible until wanted, which matches
the "tag outliers, not everything" principle better than the original bar did.

```
  ┌── question card ──────────────────────────────────────────┐
  │  [☆] [🗎✗]                    [נענתה שגוי] [סוציולוגיה]     │
  │                                                            │
  │             ?שאלת התרגול — מהו המושג המתאים                 │
  │  ...                                                       │
  └────────────────────────────────────────────────────────────┘
       ↓ tapping an icon opens a confirm popover beneath it
     ┌────────────────────────────┐
     │ דיווח על שאלה שגויה         │
     │ <explanation paragraph>     │
     │ [    דווח כשגויה    ]       │
     └────────────────────────────┘
```

- **Icons:** `IconFileX` (a page with an X) for wrong, `IconStar` for quality.
  Both were added to `Icons.jsx` for this feature. A warning triangle was tried
  first and rejected: it reads as "careful", which is exactly the wrong nudge
  for a question that is merely hard.
- **Asymmetric interaction — this is deliberate:**
  - **Tagging takes two steps.** Tap the icon → popover with title, explanation
    and a single confirm button → tap confirm. The second step is the guardrail
    against reflex-reporting a hard question as wrong.
  - **Untagging takes one step.** Tapping a lit icon clears the tag immediately,
    no popover. Retraction is harmless, so it is cheap on purpose.
- The two tags remain **mutually exclusive** (enforced structurally by the PK).
- A tag you hold keeps its icon coloured (red for wrong, amber for quality), so
  your own tag is visible at a glance on return (Q14 — own tag, never others').
  In practice this is only reachable for `quality`: a question you tagged
  `wrong` is no longer served to you at all (see §9, "Self-reported questions").
- **On first-ever tag of a question:** the popover swaps to a thank-you with
  `+2 נק׳` and auto-closes after ~1.8s; the local point total bumps
  optimistically. Re-tagging an already-rewarded question shows the same
  thank-you **without** the points line and changes no total.
- Popover dismisses on outside click or Escape, and is anchored to the inline
  **end** — anchoring to the start runs it off the screen edge in RTL, since
  the icons sit at the far edge of the row.

**Microcopy (AS BUILT — approved by the owner 2026-07-21):**

| Element | Copy |
|---|---|
| Wrong — icon aria-label | `דיווח על שאלה שגויה` |
| Wrong — popover title | `דיווח על שאלה שגויה` |
| Wrong — popover body | `יתכן וישנם שאלות שגויות. אם אתם בטוחים שהשאלה שגוייה, נא דווחו עליה. שאלה שדווחה כשגוייה ע״י {WRONG_THRESHOLD} סטודנטים תוסר מהמערכת.` |
| Wrong — confirm button | `דווח כשגויה` |
| Quality — icon aria-label | `סימון שאלה איכותית` |
| Quality — popover title | `סמן כשאלה איכותית` |
| Quality — popover body | `חושבים שהשאלה טובה מהממוצע? סמנו אותה כאיכותית והיא תצורף למאגר השאלות האיכותיות. אם תרצו, תוכלו לבחור לתרגל רק שאלות איכותיות בתרגולים הבאים.` |
| Quality — confirm button | `סמן כאיכותית` |
| Thank-you | `תודה! התיוג שלכם משפר את המאגר 🙌` (+ `+2 נק׳` on first tag only) |

The threshold in the wrong-report copy is **interpolated from
`WRONG_THRESHOLD`**, not typed as a literal, so the sentence can never drift
from the constant (or from its mirror in the SQL trigger).

> **Known copy gap, deliberately left open:** the popover says a question is
> removed after `WRONG_THRESHOLD` reports, but the reporter sees it disappear
> from their own pool after *their* report (§9). Some users may read that as
> "my single report deleted it". A line like `לא נציג לכם אותה שוב` would close
> the gap if it proves confusing.

### 7.2 High-quality filter (`SessionSetup.jsx`)

Add a toggle to the setup screen, e.g. under the state filters:

> `רק שאלות איכותיות` — with a one-line hint: `שאלות שסטודנטים סימנו כאיכותיות`.
> Once the filter is on, the hint is replaced by the matched count
> (`N מתוך M שאלות בבחירה הזו`).

- Backed by the **community** signal (Q13): a question is "high quality" when
  `quality_count >= QUALITY_THRESHOLD` (=2).
- Composes with all existing filters (course / unit / topic / difficulty /
  state). Implemented as an extra predicate in `applyFilters` (`session.js`).
- **Expected early-stage behaviour:** until tags accumulate, few questions
  qualify and the filter yields small sessions. This is acceptable and fills in
  with usage. Consider showing the matched count in setup (the setup screen
  already reasons about pool sizes) so an empty result isn't surprising.

### 7.3 Onboarding (Home screen modal)

**Trigger (Q15):** shown once, on the **Home screen**, when
`profile.onboarded_at == null`. Deliberately on Home — *not* mid-practice — so
the interactive demo's tag buttons are obviously operating on a **mock sample
question inside the modal**, and the user never worries it will tag the real
question they just answered.

**Content:** an interactive mini-demo that mirrors the real tag control (icons +
confirm popover, §7.1):
1. Intro line: what tagging is for ("help improve the bank; tag the rare
   outliers, not every question").
2. A **mock** sample question with options already "answered", showing the real
   tag icons. Prompt: `נסו לתייג את השאלה הזו`.
3. On the user tapping either tag (a **mock action — no DB writes, no real
   feedback rows**): confirm `מעולה! ככה מדווחים.` and reveal the meanings of
   both tags (reinforce "wrong ≠ hard").
4. **Complete** button → calls `complete_tag_onboarding()` RPC → +10 points →
   `onboarded_at` set → modal closes with `+10 נק׳` affirmation.

**Skip:** a `אולי אחר כך` / dismiss action → calls `dismiss_tag_onboarding()`
(sets `onboarded_at`, **no points**). The modal won't auto-appear again.

**Re-open:** available later from the account menu / a small help affordance on
Home. Re-opening never re-awards (RPC is idempotent via the unique index).

**Onboarding microcopy (draft):**

| Element | Copy |
|---|---|
| Title | `עזרו לשפר את מאגר השאלות` |
| Intro | `השאלות נוצרות ע״י בינה מלאכותית ולפעמים יש טעויות. אתם יכולים לתייג את החריגות — לא צריך לתייג כל שאלה.` |
| Demo prompt | `נסו לתייג את השאלה לדוגמה:` |
| After demo tap | `מעולה! ככה מדווחים. שימו לב: "שגויה" = טעות עובדתית, לא שאלה קשה.` |
| Complete button | `סיום (+10 נק׳)` |
| Skip button | `אולי אחר כך` |
| Completion toast | `תודה! קיבלתם 10 נק׳ 🎉` |

### 7.4 Admin moderation (`ImportExport.jsx`, the Manage tab)

Add a **"שאלות שדווחו"** (Reported questions) card. Source data is already in
`db.questions` for the admin (who receives hidden rows and the counter columns):

- List every question with `wrong_count > 0` **or** `hidden`, sorted by
  `wrong_count` desc.
- Each row shows: question text (truncated), course label, `wrong_count`, and a
  **מוסתרת** (hidden) badge when `hidden`.
- Actions per row:
  - **שחזר** (Restore) → `admin_restore_question(id)` → un-hide + clear wrong
    tags + refresh.
  - **מחק** (Delete) → existing `deleteQuestions([id])` path (with the existing
    confirm pattern) → cascades feedback + rewards.
- No reporter identities surfaced in v1 (Q11).

---

## 8. Implementation checklist (files & changes)

### 8.1 `supabase/migrations/0005_question_feedback.sql` (new)
All of §5: `question_feedback` table + RLS; `questions` counter/hidden columns;
recount+auto-hide+admin-hide trigger; tag-reward insert; `questions_read` policy
swap; `rewards` table + partial unique indexes + read-own RLS; `profiles.onboarded_at`;
`complete_tag_onboarding` / `dismiss_tag_onboarding` / `admin_restore_question`
RPCs; updated `leaderboard()`. Idempotent (`if not exists`, `create or replace`,
`drop policy if exists`) so it's safe to run in the Supabase SQL editor like the
others.

### 8.2 `src/lib/api.js`
- Extend `QUESTION_COLUMNS` with `hidden, wrong_count, quality_count`.
- In `fetchRemoteDb`: additionally fetch
  - the user's `question_feedback` rows → merge `my_tag` (`'wrong'|'quality'|null`)
    onto each question (same pattern as answer state), and
  - the user's `rewards` rows → compute `rewards_total` (and today's subset if
    convenient) and include on the returned db object.
  - Also fetch `profiles.onboarded_at` for the current user (or fold into the
    existing profile handling) so the app knows whether to show onboarding.
- New functions:
  - `setTag(userId, questionId, tag)` → upsert `question_feedback`
    `onConflict: 'user_id,question_id'`.
  - `clearTag(userId, questionId)` → delete the row.
  - `claimOnboarding()` → `supabase.rpc('complete_tag_onboarding')`.
  - `dismissOnboarding()` → `supabase.rpc('dismiss_tag_onboarding')`.
  - `adminRestoreQuestion(id)` → `supabase.rpc('admin_restore_question', { qid: id })`.
- Preview/dev (`?preview`) branches: mirror the existing dev short-circuits so
  local design work keeps working without a backend.

### 8.3 `src/lib/points.js`
- Add the four constants (§6).
- `totalPoints` stays a function of questions, but the app's displayed total must
  become `totalPoints(questions) + rewards_total`. Add a small helper, e.g.
  `grandTotal(db)` returning answer points + `db.rewards_total`, and use it where
  the Home hero and any total is shown.

### 8.4 `src/App.jsx` (reducer + persistence)
- New reducer actions:
  - `TAG_QUESTION { id, tag }` — set `q.my_tag = tag`; if this question had no
    prior reward (track via a `rewardedQuestionIds` set derived from fetched
    rewards, or a `rewarded` flag merged per question), optimistically bump
    `rewards_total` by `TAG_REWARD` and mark it rewarded.
  - `CLEAR_TAG { id }` — set `q.my_tag = null`; **no** point change.
  - Optionally `ONBOARDING_DONE` / `ONBOARDING_SKIP` to update local
    `onboarded_at` and (for done) bump `rewards_total` by `ONBOARDING_REWARD`
    optimistically.
- `persistDispatch`: on `TAG_QUESTION` call `setTag`; on `CLEAR_TAG` call
  `clearTag` (fire-and-forget with `console.error` on failure, matching the
  existing optimistic pattern).
- **Exclude hidden client-side** everywhere except the admin panel: when building
  the practice pool, Home tallies, and setup filters, filter `!q.hidden`. (Only
  the admin ever receives hidden rows; they must not leak into normal play.)

### 8.5 `src/lib/session.js`
- `applyFilters`: add a `highQualityOnly` option → keep only
  `q.quality_count >= QUALITY_THRESHOLD`.
- Ensure hidden questions are excluded from session building (either here or at
  the App layer per §8.4 — pick one place and be consistent).

### 8.6 `src/components/Practice.jsx` — DONE
- Render `<TagBar>` **inside `.question-meta`** (not below the card) once
  `attempted`.
- Wire to `dispatch({ type: 'TAG_QUESTION' | 'CLEAR_TAG', ... })` via a single
  `handleTag(next)` where `next` is a tag value or `null` to retract.
- The thank-you lives in `TagBar`, not here — Practice holds no tag UI state.
- `activeQuestions()` is applied to the mistakes-review (`overrideQuestionIds`)
  pool too, so a question hidden or self-reported between sessions can't be
  served for review.

### 8.7 `src/components/TagBar.jsx` (new) — DONE
Owns the icon buttons **and** the confirm-popover interaction (open state,
outside-click/Escape dismissal, the auto-closing thank-you). Props are
`{ myTag, tagRewarded, onChange }` — `onChange(tag | null)`. It needs
`tagRewarded` to decide whether to show `+2 נק׳`, since only the first-ever tag
of a question pays out. See §7.1 for the interaction rules and copy.

### 8.8 `src/components/SessionSetup.jsx`
- Add the `רק שאלות איכותיות` toggle bound to `config.highQualityOnly`
  (add to `DEFAULT_CONFIG` in `App.jsx`).
- Pass through to `applyFilters` when building the session.

### 8.9 `src/components/Home.jsx`
- Points hero uses the grand total (answer + rewards).
- Onboarding: if `onboarded_at == null`, render `OnboardingModal.jsx` once.
- Add a small help affordance (e.g. in the account menu) to re-open onboarding.

### 8.10 `src/components/OnboardingModal.jsx` (new)
The interactive demo (§7.3), operating on a hard-coded mock question with **no**
DB writes for the demo tap; Complete → `claimOnboarding()`; Skip →
`dismissOnboarding()`.

### 8.11 `src/components/ImportExport.jsx`
Add the "Reported questions" moderation card (§7.4) with Restore/Delete.

### 8.12 `src/styles.css`
Tag icons + confirm popover are DONE (`.tag-actions`, `.tag-action`,
`.tag-icon*`, `.tag-pop*`). Still to add: onboarding modal (reuse the existing
`modal-overlay`/`modal` pattern from `ImportExport.jsx`) and the moderation
list. RTL, mobile-first, matching existing tokens.

### 8.13 Docs
Update `SCHEMA.md` (new tables/columns, the "points = answers + rewards" model,
hidden semantics) and `README.md` (feature bullet). **Both still outstanding.**

Icons: this feature **added** `IconFileX` and `IconStar` to `Icons.jsx` (the
original advice to reuse only was overtaken — see §7.1 for why the warning
triangle was rejected). Existing icons available for the remaining sessions:
`IconFlame`, `IconAlert`, `IconSparkles`, `IconTrophy`, `IconCheck`, `IconX`,
`IconInbox`, `IconTrash`, `IconReset`.

---

## 9. Edge cases & rules

- **Self-reported questions (added 2026-07-21, supersedes the original §7.1
  assumption):** a user who tags a question `wrong` stops being served it
  **immediately**, without waiting for `WRONG_THRESHOLD` others to agree. Having
  told us a question is broken, they shouldn't have to keep answering it while
  it waits on a quorum. Implemented as a client-side predicate in
  `activeQuestions()` (`q.my_tag !== 'wrong'`), *not* in the RLS policy — the row
  must still be fetched so the user can retract the tag, and a per-row subquery
  on every question read would be needlessly expensive. Consequences:
  - Retracting the tag brings the question straight back into the pool.
  - Home tallies and the setup pool count drop by one, so the counts keep
    promising only what a session can actually serve.
  - It does **not** yank the question out of the session in progress — the
    session list is built once at mount, so reporting the question you're
    looking at never disrupts the current run.
  - Only `wrong` suppresses; a `quality` tag leaves the question in play.
- **A question hidden after a user already answered it:** their `user_answers`
  row and earned answer-points remain; the question simply stops being fetched
  (non-admin) or is filtered out (admin), so it drops from Home tallies and new
  sessions. No answer state or points are ever disturbed.
- **KNOWN DISCREPANCY (accepted, not a bug to "fix" blindly):** the server counts
  answer-points for hidden questions — `leaderboard()` sums all `user_answers`
  regardless of `hidden` — but a non-admin client never *receives* those rows, so
  `grandTotal()` can't include them. A user who answered a question that later
  got auto-hidden will therefore see a Home hero total slightly **lower** than
  their own leaderboard row. This follows directly from "answer state is never
  disturbed" (above) and is self-limiting: it only affects questions that were
  answered *and* later hidden. Do not fix it by filtering hidden rows out of
  `leaderboard()` without deciding, deliberately, that hidden questions should
  retroactively cost users points — that is a product call, not a bug fix.
- **Retraction after hide:** once hidden, non-admins can't see the question, so
  no new "wrong" tags or retractions arrive — it's effectively sticky (Q12).
  Only `admin_restore_question` brings it back (and resets its wrong tags).
- **Farming attempts:** re-tagging / switching / clearing never yields extra
  points (partial unique index on `rewards`). Onboarding reward is once-per-user.
  Clients cannot insert into `rewards` at all (no RLS write policy).
- **Admin practicing:** admin receives hidden rows from the DB; client-side
  `!q.hidden` filtering keeps them out of the admin's own practice/Home. They
  appear only in the moderation panel.
- **High-quality filter empties a session:** setup should surface the matched
  count / an empty-state so the user understands why (few questions qualify
  early on).
- **Offline / write failure:** tag writes are optimistic and fire-and-forget
  with `console.error`, matching `recordAnswer`. The next full fetch reconciles
  (server counts/rewards are authoritative). If a tag write failed, the +2 shown
  locally may not have persisted; it self-corrects on next load.
- **Preview/dev mode (`?preview`):** keep the existing dev short-circuits so
  design/screenshot work needs no backend.

---

## 10. Rollout

1. ✅ **DONE (2026-07-21)** — `0005_question_feedback.sql` applied to the
   `Arrow Quiz` project (ref `lyfzjsgverchjdjgvnfv`). Idempotent, so re-running
   is harmless, but it is no longer a pending step.
2. Ship the client changes. **Session 1's client code is written but not yet
   committed or deployed.**
3. No backfill needed: existing answers already carry answer-points; the rewards
   ledger starts empty; all `wrong_count`/`quality_count` start at 0; nothing is
   hidden until users tag. (Confirmed post-migration: 0 feedback rows, 0 reward
   rows, 0 hidden, 550 questions and 10,501 answers untouched.)

**Manual QA:**

Already verified against the live DB, via a self-aborting transaction so nothing
persisted (see `IMPLEMENTATION-PLAN.md` → STATUS for the full results):
- ✅ Tag `wrong` → +2 once; re-tag/switch/clear → no further points.
- ✅ Three different users tag one question `wrong` → auto-hidden.
- ✅ Retract after the threshold → stays hidden (sticky).
- ✅ Non-admin cannot forge `rewards` rows, tag as another user, read others'
  tags, or call `admin_restore_question`.
- ✅ `leaderboard()` returns answer + reward points and still ranks correctly.

Still to verify (needs the real client and/or later sessions):
- ⬜ **The client→Supabase round trip** — tag one question from the real app and
  confirm a `question_feedback` row and a `rewards` row actually appear. Writes
  are fire-and-forget, so a malformed call fails *silently*. Do this first.
- ⬜ Admin tags a question `wrong` → hides immediately (needs a real admin JWT;
  the definer path is verified, the `is_admin()` branch is not).
- ⬜ Reported question appears in the admin panel; Restore brings it back
  (Session 2).
- ⬜ Two users tag `quality` → appears under `רק שאלות איכותיות` (Session 2).
- ⬜ New user sees onboarding once; Complete grants +10 once; Skip grants
  nothing (Session 3).
- ⬜ Daily board counts today's rewards (needs real reward rows).

---

## 11. Future (explicitly deferred)
- "Bad phrasing / too complex" and "trivial" tags (needs a design that separates
  them from "hard but good").
- Surfacing reporter identities / abuse detection in the admin panel.
- Free-text feedback.
- Admin notifications when a question is auto-hidden.
- Tunable thresholds from an admin UI instead of code constants.
