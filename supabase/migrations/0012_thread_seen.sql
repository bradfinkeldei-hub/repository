-- When each member last opened the kudos & comments under their own card, so
-- the app can show them a "New" signal for anything posted since. In-app only:
-- nothing is emailed. Kept off profiles so opening comments doesn't count as
-- the member updating their profile.
create table public.thread_seen (
  member_id uuid primary key references public.profiles (id) on delete cascade,
  seen_at timestamptz not null default now()
);

alter table public.thread_seen enable row level security;

create policy "your own, or all as coach" on public.thread_seen
  for select using (member_id = auth.uid() or public.is_coach());
create policy "mark your own as seen" on public.thread_seen
  for insert with check (member_id = auth.uid());
create policy "update your own" on public.thread_seen
  for update using (member_id = auth.uid()) with check (member_id = auth.uid());
