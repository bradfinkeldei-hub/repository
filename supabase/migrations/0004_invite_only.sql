-- Only invited people (and the coach) can get an account, whether they arrive
-- by invite email, Google, or a direct sign-up call with the public key. This
-- holds even if "Allow new users to sign up" is left on in Supabase.
create function public.require_invite() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.app_settings where key = 'coach_email' and lower(value) = lower(new.email))
     or exists (select 1 from public.invites where lower(email) = lower(new.email) and accepted_at is null) then
    return new;
  end if;
  raise exception 'This email has not been invited';
end;
$$;
create trigger require_invite before insert on auth.users
  for each row execute function public.require_invite();
revoke execute on function public.require_invite() from public, anon, authenticated;
