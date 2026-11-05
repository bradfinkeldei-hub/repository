-- Teams the coach creates and deletes. Until now a team was a value of the
-- fixed enum public.team, which can't gain or lose values from the app. Team
-- keys become plain text, and team_names becomes the list of teams: every team
-- has a row there, and deleting the row deletes the team. Existing keys
-- ('Tuesday', 'Tuesday2', 'Example', ...) stay as they are.
--
-- The meeting weekday used to come from the key ('Tuesday' meets Tuesday). It
-- now lives in team_names.meeting_day ('' = no fixed day, like the Example team).

-- 1. Policies and my_team() depend on the enum type, so they come down first.
drop policy "see own, own team, or all as coach" on public.commitment_log;
drop policy "see own, own team, or all as coach" on public.attendance;
drop policy "team sees its own, coach sees all" on public.roll_calls;
drop policy "see self, own team, or everything as coach" on public.profiles;
drop policy "own team, or all as coach" on public.team_intentions;
drop function public.my_team();

-- 2. Enum columns become text.
alter table public.team_names alter column team type text using team::text;
alter table public.profiles alter column team type text using team::text;
alter table public.invites alter column team type text using team::text;
alter table public.roll_calls alter column team type text using team::text;
alter table public.team_intentions alter column team type text using team::text;
drop type public.team;

-- 3. team_names is the list of teams.
alter table public.team_names
  add constraint team_names_key check (team ~ '^[A-Za-z0-9_-]{1,40}$'),
  add column meeting_day text not null default ''
    check (meeting_day in ('', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
  add column created_at timestamptz not null default now();
update public.team_names set meeting_day = case
  when team in ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday') then team
  when team = 'Tuesday2' then 'Tuesday'
  else '' end;
-- Keep today's order (the order the enum listed them) for the existing teams.
update public.team_names set created_at = timestamptz '2026-10-01' + (case team
  when 'Monday' then 1 when 'Tuesday' then 2 when 'Tuesday2' then 3 when 'Wednesday' then 4
  when 'Thursday' then 5 when 'Example' then 6 when 'Pilot' then 7 else 8 end) * interval '1 minute';

-- Every team value elsewhere must be a real team. Deleting a team leaves its
-- members with no team (the app moves or archives them first) and removes the
-- team's pending invites, roll calls and intention.
alter table public.profiles add constraint profiles_team_fkey
  foreign key (team) references public.team_names (team) on update cascade on delete set null;
alter table public.invites add constraint invites_team_fkey
  foreign key (team) references public.team_names (team) on update cascade on delete cascade;
alter table public.roll_calls add constraint roll_calls_team_fkey
  foreign key (team) references public.team_names (team) on update cascade on delete cascade;
alter table public.team_intentions add constraint team_intentions_team_fkey
  foreign key (team) references public.team_names (team) on update cascade on delete cascade;
create index if not exists profiles_team_idx on public.profiles (team);

-- 4. my_team() and the policies come back unchanged, now on text.
create function public.my_team() returns text
language sql stable security definer set search_path = public as $$
  select team from public.profiles where id = auth.uid() and archived_at is null;
$$;

create policy "see own, own team, or all as coach" on public.commitment_log
  for select using (public.is_coach() or member_id = auth.uid() or exists (
    select 1 from public.profiles p where p.id = commitment_log.member_id and p.team is not null and p.team = public.my_team()));
create policy "see own, own team, or all as coach" on public.attendance
  for select using (public.is_coach() or member_id = auth.uid() or exists (
    select 1 from public.profiles p where p.id = attendance.member_id and p.team is not null and p.team = public.my_team()));
create policy "team sees its own, coach sees all" on public.roll_calls
  for select using (public.is_coach() or team = public.my_team());
create policy "see self, own team, or everything as coach" on public.profiles
  for select using (public.is_coach() or id = auth.uid() or (team is not null and team = public.my_team() and archived_at is null));
create policy "own team, or all as coach" on public.team_intentions
  for select to authenticated using (team = public.my_team() or public.is_coach());

-- 5. A new member's reminder day is their team's meeting day, or Monday.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invites;
  coach text;
  day text;
begin
  select * into inv from public.invites
    where lower(email) = lower(new.email) and accepted_at is null
    order by invited_at desc limit 1;
  select value into coach from public.app_settings where key = 'coach_email';
  select nullif(meeting_day, '') into day from public.team_names where team = inv.team;

  insert into public.profiles (id, name, role, team, reminder_day)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), nullif(new.raw_user_meta_data->>'name', ''), split_part(new.email, '@', 1)),
    case when coach is not null and lower(new.email) = lower(coach) then 'coach'::public.member_role else 'member'::public.member_role end,
    inv.team,
    coalesce(day, 'Monday')
  );
  insert into public.member_contacts (id, email) values (new.id, coalesce(new.email, ''));
  if inv.id is not null then
    update public.invites set accepted_at = now() where id = inv.id;
  end if;
  return new;
end;
$$;
