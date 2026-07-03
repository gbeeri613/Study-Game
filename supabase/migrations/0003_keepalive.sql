-- A trivial table the keep-alive workflow can read to generate real database
-- activity, so the free-tier project isn't paused after 7 idle days.
-- Run once in Supabase -> SQL Editor.

create table if not exists public.health (
  id         smallint primary key,
  checked_at timestamptz not null default now()
);

insert into public.health (id) values (1)
on conflict (id) do nothing;

-- Readable by anyone (including the unauthenticated keep-alive ping). It holds
-- no sensitive data.
alter table public.health enable row level security;

drop policy if exists health_read on public.health;
create policy health_read
  on public.health
  for select
  to anon, authenticated
  using (true);
