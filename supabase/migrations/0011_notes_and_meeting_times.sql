-- Private notes the coach keeps on each member. Only the coach can see or
-- change them; members never get them, not even their own.
create table public.coach_notes (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index coach_notes_member on public.coach_notes (member_id, created_at desc);

alter table public.coach_notes enable row level security;
create policy "only the coach" on public.coach_notes
  for all using (public.is_coach()) with check (public.is_coach());

-- Each team's standing meeting, for "Add to calendar". meeting_time is like
-- '19:00' in the coach's time zone (REMINDER_TIMEZONE); '' means not set yet.
-- The team's weekday key still sets the day.
alter table public.team_names
  add column meeting_time text not null default ''
    check (meeting_time = '' or meeting_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add column meeting_minutes int not null default 60 check (meeting_minutes between 15 and 240),
  add column meeting_url text not null default '' check (meeting_url = '' or meeting_url ~ '^https?://');
