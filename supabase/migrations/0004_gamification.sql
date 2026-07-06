-- Gamification: points + leaderboards — run once in Supabase → SQL Editor.
--
-- Design: points are a PURE FUNCTION of each user's current answer state.
-- Every answered question is worth points once — correct answers more than
-- incorrect ones — so a user's total is just the sum over their user_answers
-- rows. Consequences:
--   * No retroactive backfill of points is needed: every answer that already
--     exists counts the moment this ships.
--   * It can't be farmed: a user has at most one answer row per question, so
--     re-answering only toggles that question's single value, never stacks.
-- The point values here MUST stay in sync with src/lib/points.js.

-- ---------------------------------------------------------------------------
-- profiles: display identity for the leaderboard (Google name + avatar).
-- Needed because auth.users metadata isn't readable from the frontend key.
-- Everyone signed in can READ (to render the board); each user writes only
-- their own row (the app upserts it on sign-in).
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text,
  avatar_url text,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read
  on public.profiles
  for select
  to authenticated
  using (true);

drop policy if exists profiles_write_own on public.profiles;
create policy profiles_write_own
  on public.profiles
  for all
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- One-time backfill of profiles from existing auth users, so everyone who has
-- already been practicing shows up on the leaderboard immediately (before they
-- next open the app). Runs with SQL-editor privileges, which can read
-- auth.users. Safe to re-run.
insert into public.profiles (id, name, avatar_url)
select
  u.id,
  coalesce(
    u.raw_user_meta_data ->> 'full_name',
    u.raw_user_meta_data ->> 'name',
    u.email
  ),
  coalesce(
    u.raw_user_meta_data ->> 'avatar_url',
    u.raw_user_meta_data ->> 'picture'
  )
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Points model. Mirror of src/lib/points.js — keep the two in sync.
-- ---------------------------------------------------------------------------
create or replace function public.answer_points(is_correct boolean)
returns integer
language sql
immutable
as $$
  select case when is_correct then 10 else 3 end
$$;

-- Speeds up the daily board's date filter.
create index if not exists user_answers_answered_at_idx
  on public.user_answers (answered_at);

-- ---------------------------------------------------------------------------
-- leaderboard(period): ranked point totals across ALL users.
--
-- period = 'daily'  -> only points from questions answered *today* (Israel
--                      local time, so days flip together for the whole group).
-- period = 'all'    -> cumulative points (default).
--
-- SECURITY DEFINER so it can aggregate across every user's answers (which RLS
-- otherwise hides). It only ever returns aggregates + public display identity
-- (name/avatar) — never anyone's individual answer rows. Returns the full
-- ranking (the group is small); the client slices the top-5 and locates the
-- caller's own row.
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
  with tallies as (
    select
      ua.user_id,
      sum(public.answer_points(ua.correct))::bigint as points
    from public.user_answers ua
    where ua.answered_at is not null
      and (
        period is distinct from 'daily'
        or (ua.answered_at at time zone 'Asia/Jerusalem')::date
           = (now() at time zone 'Asia/Jerusalem')::date
      )
    group by ua.user_id
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
