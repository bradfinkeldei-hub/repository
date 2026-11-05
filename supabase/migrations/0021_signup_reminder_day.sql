-- A new member's reminder day used to be their team's name, which breaks for teams
-- that aren't weekdays (Pilot, Example, Tuesday2). Use the team's meeting weekday,
-- or Monday when it has none.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
    case
      when inv.team::text in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday') then inv.team::text
      when inv.team::text = 'Tuesday2' then 'Tuesday'
      else 'Monday'
    end
  );
  insert into public.member_contacts (id, email) values (new.id, coalesce(new.email, ''));
  if inv.id is not null then
    update public.invites set accepted_at = now() where id = inv.id;
  end if;
  return new;
end;
$$;
