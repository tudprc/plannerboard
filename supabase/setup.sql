-- PlannerBoard database setup.
-- Run once in Supabase: SQL Editor → New query → paste this → Run.

-- One row per person: their whole board, plus a small summary for the widgets.
create table if not exists public.boards (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  widget jsonb not null default '{}'::jsonb,
  -- A private key the home-screen widget uses instead of your password.
  widget_key text not null unique default replace(gen_random_uuid()::text, '-', ''),
  updated_at timestamptz not null default now()
);

-- Only you can read or change your own board.
alter table public.boards enable row level security;

drop policy if exists "Own board" on public.boards;
create policy "Own board" on public.boards
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.boards to authenticated;

-- The widget reads only the summary, and only with the right widget key.
create or replace function public.widget_feed(key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select b.widget || jsonb_build_object('syncedAt', b.updated_at)
  from public.boards b
  where b.widget_key = key;
$$;

revoke all on function public.widget_feed(text) from public;
grant execute on function public.widget_feed(text) to anon, authenticated;

-- If the widget key ever leaks, run this line to get a new one
-- (then copy the widget script again from Profile → Sync):
-- update public.boards set widget_key = replace(gen_random_uuid()::text, '-', '');
