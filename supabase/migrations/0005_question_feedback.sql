-- Question feedback & tagging — run once in Supabase → SQL Editor.
--
-- Questions are AI-generated, so quality varies. Users may attach at most ONE
-- optional tag to a question after answering it:
--   'wrong'   — a moderation signal. Enough of these auto-hide the question.
--   'quality' — a positive signal powering the "high quality only" filter.
--
-- Two design rules are enforced at the DB layer, not in the client:
--
--   NEUTRALITY. A user can only ever read their OWN tags (RLS on
--   question_feedback). Nobody sees aggregate counts or anyone else's tags.
--
--   POINTS ARE UNFORGEABLE. Until now a user's total was a pure function of
--   their answer state. Tag/onboarding rewards are *events*, so this migration
--   introduces the `rewards` ledger and the model becomes:
--
--       user total = answer-points (user_answers) + reward-points (rewards)
--
--   Clients may READ their own rewards but have no write policy at all — rows
--   are created solely by the SECURITY DEFINER code below. leaderboard() is
--   updated in step with this, and the values here MUST stay in sync with the
--   constants in src/lib/points.js.

-- ---------------------------------------------------------------------------
-- question_feedback: one optional tag per (user, question).
--
-- The single `tag` column plus the composite PK is what makes the two tags
-- mutually exclusive — there is no state in which a user holds both. Switching
-- tags is an UPDATE; clearing one is a DELETE.
-- ---------------------------------------------------------------------------
create table if not exists public.question_feedback (
  user_id     uuid not null references auth.users (id) on delete cascade,
  question_id text not null references public.questions (id) on delete cascade,
  tag         text not null check (tag in ('wrong', 'quality')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, question_id)
);

create index if not exists question_feedback_question_idx
  on public.question_feedback (question_id);

-- ---------------------------------------------------------------------------
-- rewards: the point ledger for everything that isn't answer state.
-- ---------------------------------------------------------------------------
create table if not exists public.rewards (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('tag', 'onboarding')),
  question_id text references public.questions (id) on delete cascade,
  points      integer not null,
  created_at  timestamptz not null default now()
);

-- Anti-farm: at most one 'tag' reward per (user, question) ever, and at most
-- one 'onboarding' reward per user ever. Re-tagging, switching or clearing a
-- tag therefore never pays out twice.
create unique index if not exists rewards_tag_once
  on public.rewards (user_id, question_id) where kind = 'tag';
create unique index if not exists rewards_onboarding_once
  on public.rewards (user_id) where kind = 'onboarding';

create index if not exists rewards_user_idx on public.rewards (user_id);
create index if not exists rewards_created_idx on public.rewards (created_at);

-- ---------------------------------------------------------------------------
-- Denormalized tag counters + the hidden flag, on the (admin-owned) questions
-- table. Maintained by the trigger below so reads never have to aggregate.
-- ---------------------------------------------------------------------------
alter table public.questions
  add column if not exists wrong_count   integer not null default 0,
  add column if not exists quality_count integer not null default 0,
  add column if not exists hidden        boolean not null default false,
  add column if not exists hidden_at     timestamptz;

-- Onboarding is "seen" (completing OR skipping sets it) — distinct from
-- "rewarded", which lives in the rewards ledger. Skipping must not pay out.
alter table public.profiles
  add column if not exists onboarded_at timestamptz;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.question_feedback enable row level security;
alter table public.rewards           enable row level security;

-- question_feedback: own rows only — mirrors user_answers. This is what makes
-- the neutrality guarantee structural rather than a client-side convention.
drop policy if exists question_feedback_own on public.question_feedback;
create policy question_feedback_own
  on public.question_feedback
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- rewards: read your own, write nothing. Deliberately no insert/update/delete
-- policy — only the SECURITY DEFINER code below may create reward rows.
drop policy if exists rewards_read_own on public.rewards;
create policy rewards_read_own
  on public.rewards
  for select
  to authenticated
  using (auth.uid() = user_id);

-- questions: hidden rows simply stop being returned to non-admins, so the
-- client needs no filtering to make them disappear — they never arrive. The
-- admin still receives them (to moderate), and filters them out client-side.
drop policy if exists questions_read on public.questions;
create policy questions_read
  on public.questions
  for select
  to authenticated
  using (not hidden or public.is_admin());

-- ---------------------------------------------------------------------------
-- recount_question_feedback(): the whole moderation + reward pipeline.
--
-- SECURITY DEFINER because it writes the admin-only questions table and the
-- no-write-policy rewards table on behalf of an ordinary user.
--
-- The threshold below mirrors WRONG_THRESHOLD in src/lib/points.js; Postgres
-- has no shared-constant mechanism, so it is inlined. Change both together.
-- ---------------------------------------------------------------------------
create or replace function public.recount_question_feedback()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  qid  text;
  w    integer;
  qual integer;
  wrong_threshold constant integer := 3;   -- WRONG_THRESHOLD
  tag_reward      constant integer := 2;   -- TAG_REWARD
begin
  -- NEW is unassigned on DELETE, so pick the key explicitly rather than
  -- coalescing across the two records.
  if tg_op = 'DELETE' then
    qid := old.question_id;
  else
    qid := new.question_id;
  end if;

  select
    count(*) filter (where tag = 'wrong'),
    count(*) filter (where tag = 'quality')
  into w, qual
  from public.question_feedback
  where question_id = qid;

  -- The admin flagging a question as wrong hides it at once, no quorum needed.
  -- is_admin() reads the JWT of the *current request*, which during a user's
  -- own insert is that user — so this fires only for the admin's own tags.
  if tg_op <> 'DELETE' then
    if new.tag = 'wrong' and public.is_admin() then
      update public.questions
        set hidden = true, hidden_at = coalesce(hidden_at, now())
        where id = qid;
    end if;
  end if;

  update public.questions
  set wrong_count   = w,
      quality_count = qual,
      -- Sticky once hidden: only admin_restore_question() clears it. A hidden
      -- question is invisible to non-admins, so no retractions can arrive.
      hidden        = (hidden or w >= wrong_threshold),
      hidden_at     = case
                        when not hidden and w >= wrong_threshold then now()
                        else hidden_at
                      end
  where id = qid;

  -- First tag of this question by this user pays out, once ever. The partial
  -- unique index makes the re-tag / switch / clear-and-retag paths no-ops.
  if tg_op = 'INSERT' then
    insert into public.rewards (user_id, question_id, kind, points)
    values (new.user_id, new.question_id, 'tag', tag_reward)
    on conflict do nothing;
  end if;

  return null;
end;
$$;

drop trigger if exists question_feedback_recount on public.question_feedback;
create trigger question_feedback_recount
  after insert or update or delete on public.question_feedback
  for each row execute function public.recount_question_feedback();

-- ---------------------------------------------------------------------------
-- Onboarding RPCs. Both are idempotent; only `complete` pays out.
-- ---------------------------------------------------------------------------
create or replace function public.complete_tag_onboarding()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
    set onboarded_at = coalesce(onboarded_at, now())
    where id = auth.uid();
  insert into public.rewards (user_id, kind, points)
    values (auth.uid(), 'onboarding', 10)   -- ONBOARDING_REWARD
    on conflict do nothing;
end;
$$;

create or replace function public.dismiss_tag_onboarding()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
    set onboarded_at = coalesce(onboarded_at, now())
    where id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_restore_question(): un-hide a question and clear the reports against
-- it, so it doesn't immediately re-hide. Needs DEFINER because RLS forbids the
-- admin from deleting other users' feedback rows.
--
-- Order matters: deleting the 'wrong' rows fires the recount trigger (which
-- leaves `hidden` true, being sticky); the UPDATE afterwards is what actually
-- restores it.
-- ---------------------------------------------------------------------------
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

  delete from public.question_feedback
    where question_id = qid and tag = 'wrong';

  update public.questions
    set hidden = false, hidden_at = null, wrong_count = 0
    where id = qid;
end;
$$;

grant execute on function public.complete_tag_onboarding() to authenticated;
grant execute on function public.dismiss_tag_onboarding() to authenticated;
grant execute on function public.admin_restore_question(text) to authenticated;

-- ---------------------------------------------------------------------------
-- leaderboard(period): now answer-points PLUS reward-points.
--
-- Unchanged in shape from 0004 — same signature, same DEFINER rationale, same
-- Israel-local day boundary. A reward counts toward the daily board on the day
-- it was created, exactly as an answer counts on the day it was answered.
-- ---------------------------------------------------------------------------
create or replace function public.leaderboard(period text default 'all')
returns table (
  user_id    uuid,
  name       text,
  avatar_url text,
  points     bigint,
  rank       bigint
)
language sql
security definer
set search_path = public
stable
as $$
  with answer_tally as (
    select
      ua.user_id,
      sum(public.answer_points(ua.correct))::bigint as pts
    from public.user_answers ua
    where ua.answered_at is not null
      and (
        period is distinct from 'daily'
        or (ua.answered_at at time zone 'Asia/Jerusalem')::date
           = (now() at time zone 'Asia/Jerusalem')::date
      )
    group by ua.user_id
  ),
  reward_tally as (
    select
      r.user_id,
      sum(r.points)::bigint as pts
    from public.rewards r
    where (
        period is distinct from 'daily'
        or (r.created_at at time zone 'Asia/Jerusalem')::date
           = (now() at time zone 'Asia/Jerusalem')::date
      )
    group by r.user_id
  ),
  tallies as (
    select u.user_id, sum(u.pts)::bigint as points
    from (
      select user_id, pts from answer_tally
      union all
      select user_id, pts from reward_tally
    ) u
    group by u.user_id
  )
  select
    t.user_id,
    coalesce(p.name, 'משתמש') as name,
    p.avatar_url,
    t.points,
    rank() over (order by t.points desc) as rank
  from tallies t
  left join public.profiles p on p.id = t.user_id
  where t.points > 0
  order by t.points desc, name asc
$$;

grant execute on function public.leaderboard(text) to authenticated;
