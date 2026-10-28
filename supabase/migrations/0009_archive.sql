-- Archiving a member: the coach takes someone out of the circle without
-- deleting them. Their profile and history stay, they drop out of their team
-- (teammates no longer see them, and they no longer see the team), and the app
-- blocks their sign-in. Restoring clears archived_at and they're back as before.
alter table public.profiles add column archived_at timestamptz;

-- An archived member has no team as far as access goes.
create or replace function public.my_team() returns public.team
language sql stable security definer set search_path = public as $$
  select team from public.profiles where id = auth.uid() and archived_at is null;
$$;

-- Teammates don't see archived members.
drop policy "see self, own team, or everything as coach" on public.profiles;
create policy "see self, own team, or everything as coach" on public.profiles
  for select using (
    public.is_coach() or id = auth.uid()
    or (team is not null and team = public.my_team() and archived_at is null)
  );

-- Only the coach (or the service role) can archive or restore someone.
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_coach() then
    if new.team is distinct from old.team
       or new.role is distinct from old.role
       or new.last_reminder_week is distinct from old.last_reminder_week
       or new.archived_at is distinct from old.archived_at
       or new.id is distinct from old.id then
      raise exception 'Only the coach can change teams and roles';
    end if;
  end if;
  -- Background jobs (no signed-in user) don't count as the member updating.
  if auth.uid() is not null then
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_profile_update() from public, anon, authenticated;
