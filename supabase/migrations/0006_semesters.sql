-- Semesters — run once in Supabase → SQL Editor.
--
-- Until now the course list was *derived*: whatever `course` slugs happened to
-- appear in `questions` were the courses, and their Hebrew labels lived in a
-- hardcoded map in the client. That worked for one semester. It can't express
-- "this course belongs to 26-2" without repeating the semester on every
-- question row, so this migration promotes courses to a real table.
--
-- The key modelling decision: **semester belongs to the COURSE, not to the
-- question.** A slug therefore maps to exactly one semester, and a course that
-- runs again next semester gets a NEW slug (e.g. `psychology-263`) with its own
-- card and its own progress. That is what lets the rest of the app stay
-- semester-blind: session setup, the practice pool and the summary all filter
-- by course slug alone, exactly as they do today, and cannot accidentally mix
-- two semesters because two semesters can never share a slug.
--
-- Nothing here touches points, answer state, or the leaderboard.

-- ---------------------------------------------------------------------------
-- courses: the course registry. Shared content, so it mirrors the `questions`
-- policy pair exactly — everyone signed in reads, only the admin writes.
-- ---------------------------------------------------------------------------
create table if not exists public.courses (
  slug       text primary key,
  label      text not null,
  semester   text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists courses_semester_idx on public.courses (semester);

alter table public.courses enable row level security;

drop policy if exists courses_read on public.courses;
create policy courses_read
  on public.courses
  for select
  to authenticated
  using (true);

drop policy if exists courses_admin_write on public.courses;
create policy courses_admin_write
  on public.courses
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Backfill, in three steps that MUST run in this order.
--
--   1. Normalize the empty-string course to NULL, so "no course" is one case
--      rather than two. The client already buckets both under ללא קורס.
--   2. Seed one course row per distinct slug already in the bank, all at 26-2
--      (every course uploaded so far belongs to that semester), with the Hebrew
--      labels lifted out of the client's COURSE_LABELS map.
--   3. Only THEN add the foreign key — seeding first is what makes it safe to
--      add. From here on the FK is the guarantee that no question can carry a
--      slug with no course row, which would otherwise produce a card that is
--      invisible under every semester.
-- ---------------------------------------------------------------------------

update public.questions set course = null where course = '';

-- Seed one row per slug, label defaulting to the slug itself...
insert into public.courses (slug, label, semester)
select distinct q.course, q.course, '26-2'
from public.questions q
where q.course is not null
on conflict (slug) do nothing;

-- ...then apply the Hebrew names the client used to hardcode. Only rows whose
-- label is still the raw slug are touched, so re-running this never clobbers a
-- name the admin has since edited in the app.
update public.courses c
set label = m.label, updated_at = now()
from (values
  ('anthropology', 'אנתרופולוגיה'),
  ('sociology',    'סוציולוגיה'),
  ('psychology',   'פסיכולוגיה'),
  ('economy',      'כלכלה'),
  ('rome',         'רומא')
) as m (slug, label)
where c.slug = m.slug and c.label = c.slug;

-- ON UPDATE CASCADE so renaming a slug carries its questions along.
-- No ON DELETE rule: deleting a course that still has questions must FAIL, so
-- the admin UI has to delete the questions first (it does, in that order).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'questions_course_fkey'
  ) then
    alter table public.questions
      add constraint questions_course_fkey
      foreign key (course) references public.courses (slug)
      on update cascade;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- app_settings: admin-controlled, app-wide settings. Key/value so the next
-- setting needs no migration of its own.
--
-- `default_semester` is the semester every user's Home lands on at page load.
-- It is NOT validated against `courses` — pointing it at a semester with no
-- content yet is a deliberate no-op (the client falls back to the newest
-- semester that has questions), so the new semester can be armed in advance and
-- switches over by itself the moment its first course is imported.
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read
  on public.app_settings
  for select
  to authenticated
  using (true);

drop policy if exists app_settings_admin_write on public.app_settings;
create policy app_settings_admin_write
  on public.app_settings
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

insert into public.app_settings (key, value)
values ('default_semester', '"26-2"'::jsonb)
on conflict (key) do nothing;
