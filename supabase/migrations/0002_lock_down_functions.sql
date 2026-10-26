-- The trigger functions run with elevated rights, so nobody should be able to
-- call them directly through the API. is_coach() and my_team() stay callable:
-- the access rules use them, and they only report on the caller.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.guard_profile_update() from public, anon, authenticated;
