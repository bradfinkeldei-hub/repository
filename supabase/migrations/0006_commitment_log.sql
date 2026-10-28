-- Accountability tracker: one row per member per meeting week, holding what
-- they committed to that week and whether they followed through.
-- week is an ISO week like '2026-W44'. A week with no row was not marked done;
-- its commitment is carried forward from the last week that has one.
create table public.commitment_log (
  member_id uuid not null references public.profiles (id) on delete cascade,
  week text not null check (week ~ '^\d{4}-W\d{2}$'),
  commitment text not null default '',
  done boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (member_id, week)
);

alter table public.commitment_log enable row level security;

-- Same reach as profiles: yourself, your own team, or everyone as coach.
create policy "see own, own team, or all as coach" on public.commitment_log
  for select using (
    public.is_coach() or member_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = member_id and p.team is not null and p.team = public.my_team())
  );
create policy "log for yourself or anyone as coach" on public.commitment_log
  for insert with check (member_id = auth.uid() or public.is_coach());
create policy "update own or anyone as coach" on public.commitment_log
  for update using (member_id = auth.uid() or public.is_coach())
  with check (member_id = auth.uid() or public.is_coach());
create policy "coach removes log rows" on public.commitment_log
  for delete using (public.is_coach());

-- Start everyone's history from what the profiles already hold.
insert into public.commitment_log (member_id, week, commitment, done)
select id, done_week, accountability, true from public.profiles
where done_week ~ '^\d{4}-W\d{2}$'
on conflict do nothing;
insert into public.commitment_log (member_id, week, commitment, done)
select id, to_char(now() at time zone 'America/Chicago', 'IYYY-"W"IW'), accountability, false from public.profiles
where accountability <> '' and role = 'member'
on conflict do nothing;
