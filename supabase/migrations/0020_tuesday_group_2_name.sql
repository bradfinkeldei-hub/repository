-- Name the second Tuesday group and give it the original group's meeting link and time.
insert into public.team_names (team, name, meeting_time, meeting_minutes, meeting_url, meeting_tz)
select 'Tuesday2', 'Tuesday Night Mens Group 2', meeting_time, meeting_minutes, meeting_url, meeting_tz
from public.team_names where team = 'Tuesday'
on conflict (team) do nothing;
