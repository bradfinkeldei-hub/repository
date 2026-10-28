-- The coach can rename teams. Teams keep their weekday key (public.team), which
-- still sets their meeting day; team_names holds what everyone sees instead.
create table public.team_names (
  team public.team primary key,
  name text not null check (char_length(btrim(name)) between 1 and 40)
);
insert into public.team_names (team, name)
select t, t::text || ' team' from unnest(enum_range(null::public.team)) as t
on conflict do nothing;

alter table public.team_names enable row level security;
create policy "anyone signed in sees team names" on public.team_names
  for select to authenticated using (true);
create policy "coach renames teams" on public.team_names
  for all using (public.is_coach()) with check (public.is_coach());

-- The name the coach typed on the invite, for the invite list and resends.
alter table public.invites add column name text not null default '';
