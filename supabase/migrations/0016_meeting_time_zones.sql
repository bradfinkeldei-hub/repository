-- The time zone each team's meeting time is in, like 'America/New_York'.
-- Empty means the app's default zone (REMINDER_TIMEZONE, Central), which is
-- what every meeting time meant before this column existed.
alter table public.team_names
  add column meeting_tz text not null default ''
    check (meeting_tz = '' or meeting_tz ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)*$');
