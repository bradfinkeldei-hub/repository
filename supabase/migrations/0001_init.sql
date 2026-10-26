-- The Coaching Circle: schema and access rules.
--
-- Access model
--   coach   sees and edits everything.
--   member  sees only the profiles on their own team, edits only their own
--           profile, and can never change their team or role.
--   anyone without a team (signed up without an invite) sees only themselves.

create type public.team as enum ('Monday', 'Tuesday', 'Wednesday', 'Thursday');
create type public.member_role as enum ('coach', 'member');

-- Settings the coach sets once, e.g. coach_email.
create table public.app_settings (
  key text primary key,
  value text not null
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  role public.member_role not null default 'member',
  team public.team,
  wheel jsonb not null default '{}'::jsonb,
  creating text not null default '',
  accountability text not null default '',
  mission text not null default '',
  reminder_enabled boolean not null default false,
  reminder_day text not null default 'Monday'
    check (reminder_day in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')),
  done_week text not null default '',
  last_reminder_week text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Email addresses are kept apart from profiles so teammates never see them.
create table public.member_contacts (
  id uuid primary key references public.profiles (id) on delete cascade,
  email text not null
);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  team public.team not null,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz
);
create unique index invites_open_email on public.invites (lower(email)) where accepted_at is null;

-- The coach's private action list: their own actions, plus done marks for
-- suggested actions (id = 'g_<week>_<member>_<kind>').
create table public.coach_actions (
  id text primary key default gen_random_uuid()::text,
  custom boolean not null default false,
  text text not null default '',
  member_id uuid references public.profiles (id) on delete cascade,
  done boolean not null default false,
  week text not null default '',
  created_at timestamptz not null default now()
);

-- One row each time a member starts booking a call. month = 'YYYY-MM'.
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete cascade,
  month text not null,
  kind text not null check (kind in ('free', 'paid')),
  created_at timestamptz not null default now()
);
create unique index bookings_one_free_per_month on public.bookings (member_id, month) where kind = 'free';

-- Helpers. security definer so they can read profiles without tripping RLS.
create function public.is_coach() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'coach');
$$;

create function public.my_team() returns public.team
language sql stable security definer set search_path = public as $$
  select team from public.profiles where id = auth.uid();
$$;

-- Members may edit their own profile but not their team, role or the
-- reminder bookkeeping. Only the coach (or the service role) can change those.
create function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_coach() then
    if new.team is distinct from old.team
       or new.role is distinct from old.role
       or new.last_reminder_week is distinct from old.last_reminder_week
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
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- Every new sign-in gets a profile. An open invite for the same email sets the
-- team; the email in app_settings.coach_email becomes the coach.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  inv public.invites;
  coach text;
begin
  select * into inv from public.invites
    where lower(email) = lower(new.email) and accepted_at is null
    order by invited_at desc limit 1;
  select value into coach from public.app_settings where key = 'coach_email';

  insert into public.profiles (id, name, role, team, reminder_day)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), nullif(new.raw_user_meta_data->>'name', ''), split_part(new.email, '@', 1)),
    case when coach is not null and lower(new.email) = lower(coach) then 'coach'::public.member_role else 'member'::public.member_role end,
    inv.team,
    coalesce(inv.team::text, 'Monday')
  );
  insert into public.member_contacts (id, email) values (new.id, coalesce(new.email, ''));
  if inv.id is not null then
    update public.invites set accepted_at = now() where id = inv.id;
  end if;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Row level security
alter table public.app_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.member_contacts enable row level security;
alter table public.invites enable row level security;
alter table public.coach_actions enable row level security;
alter table public.bookings enable row level security;

create policy "coach manages settings" on public.app_settings
  for all using (public.is_coach()) with check (public.is_coach());

create policy "see self, own team, or everything as coach" on public.profiles
  for select using (
    public.is_coach() or id = auth.uid() or (team is not null and team = public.my_team())
  );
create policy "edit self or anyone as coach" on public.profiles
  for update using (public.is_coach() or id = auth.uid())
  with check (public.is_coach() or id = auth.uid());
create policy "coach removes members" on public.profiles
  for delete using (public.is_coach());

create policy "see own email or all as coach" on public.member_contacts
  for select using (public.is_coach() or id = auth.uid());
create policy "coach edits emails" on public.member_contacts
  for update using (public.is_coach()) with check (public.is_coach());

create policy "coach manages invites" on public.invites
  for all using (public.is_coach()) with check (public.is_coach());

create policy "coach manages actions" on public.coach_actions
  for all using (public.is_coach()) with check (public.is_coach());

create policy "see own bookings or all as coach" on public.bookings
  for select using (public.is_coach() or member_id = auth.uid());
create policy "book for yourself" on public.bookings
  for insert with check (member_id = auth.uid() or public.is_coach());
create policy "coach adjusts bookings" on public.bookings
  for delete using (public.is_coach());
