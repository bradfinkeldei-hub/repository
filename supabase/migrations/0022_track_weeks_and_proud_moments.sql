-- How many weeks a member wants to be held accountable and tracked (null until they choose),
-- and Proud Moments: things they're proud of, written down to build confidence.

alter table public.focus_cards
  add column if not exists track_weeks smallint check (track_weeks between 1 and 52);

create table public.proud_moments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 600),
  happened_on date not null default current_date,
  -- Private: only the member and the coach see it.
  private boolean not null default false,
  created_at timestamptz not null default now()
);
create index proud_moments_member on public.proud_moments (member_id, happened_on desc);

alter table public.proud_moments enable row level security;
create policy "see proud moments you can see" on public.proud_moments
  for select to authenticated
  using (public.can_see_card(member_id) and (not private or member_id = auth.uid() or public.is_coach()));
create policy "add your own proud moments, or any as coach" on public.proud_moments
  for insert to authenticated with check (member_id = auth.uid() or public.is_coach());
create policy "change your own proud moments, or any as coach" on public.proud_moments
  for update to authenticated using (member_id = auth.uid() or public.is_coach())
  with check (member_id = auth.uid() or public.is_coach());
create policy "remove your own proud moments, or any as coach" on public.proud_moments
  for delete to authenticated using (member_id = auth.uid() or public.is_coach());
