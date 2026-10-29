-- "The intention of this group is:" at the top of each team's Team tab.
-- The coach writes it; members read their own team's only. Starts blank
-- (no row means blank).
create table public.team_intentions (
  team public.team primary key,
  body text not null default '' check (char_length(body) <= 500),
  updated_at timestamptz not null default now()
);

alter table public.team_intentions enable row level security;
create policy "own team, or all as coach" on public.team_intentions
  for select to authenticated using (team = public.my_team() or public.is_coach());
create policy "coach writes intentions" on public.team_intentions
  for all using (public.is_coach()) with check (public.is_coach());
