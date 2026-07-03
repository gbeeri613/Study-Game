-- Study app backend schema — run once in Supabase → SQL Editor.
--
-- Model: one shared question store (admin-managed) + per-user answer state.
-- Security is enforced entirely by Row Level Security below, because the
-- frontend talks to the database directly with the public/anon key.

-- ---------------------------------------------------------------------------
-- questions: the shared content store. Mirrors schema_version 1 in SCHEMA.md.
-- Everyone signed in can READ; only the admin can write.
-- ---------------------------------------------------------------------------
create table if not exists public.questions (
  id                  text primary key,
  course              text,
  unit                integer,
  topic               text,
  difficulty          text,
  question            text not null,
  options             jsonb not null,
  answer              integer not null,
  option_explanations jsonb,
  explanation         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- user_answers: each user's answer state, one row per (user, question).
-- These are the fields that used to live inline on the question objects.
-- ---------------------------------------------------------------------------
create table if not exists public.user_answers (
  user_id     uuid not null references auth.users (id) on delete cascade,
  question_id text not null references public.questions (id) on delete cascade,
  answered_at timestamptz,
  last_choice integer,
  correct     boolean,
  updated_at  timestamptz not null default now(),
  primary key (user_id, question_id)
);

create index if not exists user_answers_user_idx
  on public.user_answers (user_id);

-- ---------------------------------------------------------------------------
-- Admin identity. The admin is identified by their Google email as it appears
-- in the JWT. Change the address here if the admin ever changes.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'gbeeri613@gmail.com'
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.questions   enable row level security;
alter table public.user_answers enable row level security;

-- questions: all authenticated users may read.
drop policy if exists questions_read on public.questions;
create policy questions_read
  on public.questions
  for select
  to authenticated
  using (true);

-- questions: only the admin may insert/update/delete.
drop policy if exists questions_admin_write on public.questions;
create policy questions_admin_write
  on public.questions
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- user_answers: a user may read/write only their own rows.
drop policy if exists user_answers_own on public.user_answers;
create policy user_answers_own
  on public.user_answers
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
