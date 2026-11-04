-- Focus cards for the Pilot group. A new Pilot member answers seven questions
-- one at a time on first sign-in; their answers become a Focus card on the
-- group's board. Saved as they go (step), finished when confirmed_at is set.
-- Visible to the member, their group and the coach, like the other card parts.

insert into public.team_names (team, name) values ('Pilot', 'Pilot group')
on conflict (team) do nothing;

create table public.focus_cards (
  member_id uuid primary key references public.profiles (id) on delete cascade,
  -- Everything they named in question 1, the one they picked, and the rest (the Later list).
  topics text[] not null default '{}' check (cardinality(topics) <= 10),
  focus text not null default '' check (char_length(focus) <= 300),
  later text[] not null default '{}' check (cardinality(later) <= 10),
  outcome text not null default '' check (char_length(outcome) <= 600),
  measure_kind text not null default '' check (measure_kind in ('', 'decision', 'plan', 'number', 'feeling')),
  measure text not null default '' check (char_length(measure) <= 600),
  -- For a number: 0 -> goal. For a feeling scale: start -> goal out of 10. "now" moves as they go.
  measure_start smallint check (measure_start between 0 and 1000),
  measure_goal smallint check (measure_goal between 0 and 1000),
  measure_now smallint check (measure_now between 0 and 1000),
  meaning text not null default '' check (char_length(meaning) <= 600),
  start_point text not null default '' check (char_length(start_point) <= 300),
  held_by text not null default '' check (char_length(held_by) <= 400),
  step smallint not null default 0 check (step between 0 and 20),
  confirmed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.focus_cards enable row level security;
create policy "see focus cards you can see" on public.focus_cards
  for select to authenticated using (public.can_see_card(member_id));
create policy "write your own focus card, or any as coach" on public.focus_cards
  for insert to authenticated with check (member_id = auth.uid() or public.is_coach());
create policy "change your own focus card, or any as coach" on public.focus_cards
  for update to authenticated using (member_id = auth.uid() or public.is_coach())
  with check (member_id = auth.uid() or public.is_coach());
create policy "coach removes focus cards" on public.focus_cards
  for delete to authenticated using (public.is_coach());
