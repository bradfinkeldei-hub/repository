-- Kudos, comments and milestones under each member's card.
--
-- Teammates (same team only) and the coach can comment on a member's card and
-- give them kudos, one kudos per person per meeting week. The member can close
-- their thread to new comments; the coach can still post. Milestones are wins
-- the member or the coach adds to the card (the app also shows ones it works
-- out from the accountability tracker). Anything written by an archived member
-- is hidden until the coach restores them.

-- The member's choice: open to new comments, or closed.
alter table public.profiles add column thread_open boolean not null default true;

-- True for a profile that exists and isn't archived. security definer so it
-- works for authors a teammate can't see, like the coach.
create function public.is_active(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = uid and archived_at is null);
$$;
revoke execute on function public.is_active(uuid) from public, anon;
grant execute on function public.is_active(uuid) to authenticated;

-- Whose card a row sits under: yourself, a teammate, or anyone as coach.
create function public.can_see_card(member uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_coach() or member = auth.uid()
    or exists (select 1 from public.profiles p where p.id = member and p.archived_at is null
               and p.team is not null and p.team = public.my_team());
$$;
revoke execute on function public.can_see_card(uuid) from public, anon;
grant execute on function public.can_see_card(uuid) to authenticated;

-- Who wrote it, stamped by the database so it can't be faked and so teammates
-- see the coach's name even though they can't read the coach's profile.
create function public.stamp_author() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.author_id := auth.uid();
  end if;
  new.author_name := coalesce((select name from public.profiles where id = new.author_id), '');
  return new;
end;
$$;
revoke execute on function public.stamp_author() from public, anon, authenticated;

create table public.card_comments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  author_name text not null default '',
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index card_comments_member on public.card_comments (member_id, created_at);
create trigger stamp_author before insert on public.card_comments
  for each row execute function public.stamp_author();

alter table public.card_comments enable row level security;

create policy "see comments on cards you can see" on public.card_comments
  for select using (public.can_see_card(member_id) and public.is_active(author_id));
-- Teammates only while the thread is open. The member and the coach always can.
create policy "comment on your own card, an open teammate's, or any as coach" on public.card_comments
  for insert with check (
    author_id = auth.uid() and (
      public.is_coach() or member_id = auth.uid()
      or (public.can_see_card(member_id)
          and exists (select 1 from public.profiles p where p.id = member_id and p.thread_open))
    )
  );
-- The author, the member whose card it is, or the coach can take a comment down.
create policy "remove your own comment, any on your card, or any as coach" on public.card_comments
  for delete using (author_id = auth.uid() or member_id = auth.uid() or public.is_coach());

-- One kudos per person per card per meeting week. week is an ISO week like '2026-W44'.
create table public.kudos (
  member_id uuid not null references public.profiles (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  author_name text not null default '',
  week text not null check (week ~ '^\d{4}-W\d{2}$'),
  created_at timestamptz not null default now(),
  primary key (member_id, author_id, week),
  check (member_id <> author_id)
);
create trigger stamp_author before insert on public.kudos
  for each row execute function public.stamp_author();

alter table public.kudos enable row level security;

create policy "see kudos on cards you can see" on public.kudos
  for select using (public.can_see_card(member_id) and public.is_active(author_id));
create policy "give kudos to a teammate, or anyone as coach" on public.kudos
  for insert with check (author_id = auth.uid() and member_id <> auth.uid() and public.can_see_card(member_id));
create policy "take back your own kudos" on public.kudos
  for delete using (author_id = auth.uid() or public.is_coach());

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  author_name text not null default '',
  title text not null check (char_length(title) between 1 and 120),
  achieved_on date not null default current_date,
  created_at timestamptz not null default now()
);
create index milestones_member on public.milestones (member_id, achieved_on);
create trigger stamp_author before insert on public.milestones
  for each row execute function public.stamp_author();

alter table public.milestones enable row level security;

create policy "see milestones on cards you can see" on public.milestones
  for select using (public.can_see_card(member_id));
create policy "add milestones to your own card, or anyone's as coach" on public.milestones
  for insert with check (author_id = auth.uid() and (member_id = auth.uid() or public.is_coach()));
create policy "remove milestones from your own card, or anyone's as coach" on public.milestones
  for delete using (member_id = auth.uid() or public.is_coach());
