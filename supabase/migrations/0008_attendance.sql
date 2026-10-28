-- Meeting check-in: who's coming to a team's meeting.
-- meeting is the meeting's date, like '2026-10-28', in the coach's time zone.
create table public.attendance (
  member_id uuid not null references public.profiles (id) on delete cascade,
  meeting date not null,
  going boolean not null,
  updated_at timestamptz not null default now(),
  primary key (member_id, meeting)
);

alter table public.attendance enable row level security;

-- Same reach as profiles: yourself, your own team, or everyone as coach.
create policy "see own, own team, or all as coach" on public.attendance
  for select using (
    public.is_coach() or member_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = member_id and p.team is not null and p.team = public.my_team())
  );
create policy "answer for yourself or anyone as coach" on public.attendance
  for insert with check (member_id = auth.uid() or public.is_coach());
create policy "change own answer or anyone's as coach" on public.attendance
  for update using (member_id = auth.uid() or public.is_coach())
  with check (member_id = auth.uid() or public.is_coach());
create policy "coach removes answers" on public.attendance
  for delete using (public.is_coach());

-- When the coach last emailed a team to ask who's coming, and the meeting link
-- (Zoom, Meet...) they shared. The latest link fills in the next ask.
create table public.roll_calls (
  team public.team not null,
  meeting date not null,
  sent_at timestamptz not null default now(),
  meeting_url text not null default '' check (meeting_url = '' or meeting_url ~ '^https?://'),
  primary key (team, meeting)
);

alter table public.roll_calls enable row level security;

create policy "team sees its own, coach sees all" on public.roll_calls
  for select using (public.is_coach() or team = public.my_team());
create policy "coach sends roll calls" on public.roll_calls
  for all using (public.is_coach()) with check (public.is_coach());
