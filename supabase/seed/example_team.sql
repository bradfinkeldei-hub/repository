-- Example team: nine made-up members for demos.
--
-- Run in the Supabase SQL editor AFTER migration 0003_example_team.sql.
-- Safe to run twice: it skips anyone already there.
--
-- The members have no password and use @example.com addresses, which can't
-- receive mail, so nobody can sign in as them and no email goes anywhere.
-- To remove them all, run:
--   delete from auth.users where email like 'demo-%@example.com';
-- (their profiles and contacts are deleted with them).

with people (email, name) as (values
  ('demo-maya@example.com', 'Maya Torres'),
  ('demo-james@example.com', 'James Okafor'),
  ('demo-priya@example.com', 'Priya Shah'),
  ('demo-derek@example.com', 'Derek Lindqvist'),
  ('demo-alicia@example.com', 'Alicia Brooks'),
  ('demo-marcus@example.com', 'Marcus Bell'),
  ('demo-hannah@example.com', 'Hannah Kim'),
  ('demo-tom@example.com', 'Tom Reyes'),
  ('demo-grace@example.com', 'Grace Adeyemi')
),
new_users as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
    p.email, '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p.name), now(), now(), '', '', '', ''
  from people p
  where not exists (select 1 from auth.users u where lower(u.email) = p.email)
  returning id, email
)
select count(*) as members_added from new_users;

-- The sign-up trigger created a blank profile for each; fill them in.
update public.profiles pr set
  team = 'Example', role = 'member', name = d.name, wheel = d.wheel::jsonb,
  creating = d.creating, accountability = d.accountability, mission = d.mission,
  reminder_enabled = d.reminder_enabled, reminder_day = d.reminder_day,
  done_week = d.done_week, updated_at = d.updated_at
from (values
  ('demo-maya@example.com', 'Maya Torres', '{"health":6,"career":8,"money":5,"love":7,"family":8,"fun":4,"growth":9,"home":6}', 'Launching my own bookkeeping practice by spring', 'Reach out to 3 potential clients every week', 'To help small business owners stop dreading their numbers', true, 'Monday', to_char(now(), 'IYYY-"W"IW'), now() - interval '2 days'),
  ('demo-james@example.com', 'James Okafor', '{"health":3,"career":7,"money":6,"love":8,"family":9,"fun":5,"growth":6,"home":7}', 'A body that keeps up with my kids', 'Walk 30 minutes before work, 4 days a week', 'To be the steady, present dad I didn''t have', true, 'Tuesday', '', now() - interval '5 days'),
  ('demo-priya@example.com', 'Priya Shah', '{"health":7,"career":4,"money":5,"love":6,"family":7,"fun":6,"growth":8,"home":5}', 'A career change into UX design', 'Finish one online course module and one portfolio sketch each week', 'To make technology feel kind to the people using it', true, 'Wednesday', to_char(now(), 'IYYY-"W"IW'), now() - interval '1 day'),
  ('demo-derek@example.com', 'Derek Lindqvist', '{"health":8,"career":6,"money":3,"love":5,"family":6,"fun":7,"growth":5,"home":4}', 'Being debt-free in 18 months', 'Track every dollar I spend and review it Sunday night', 'To give my family freedom instead of stress', false, 'Sunday', '', now() - interval '3 days'),
  ('demo-alicia@example.com', 'Alicia Brooks', '{"health":5,"career":9,"money":8,"love":3,"family":6,"fun":3,"growth":7,"home":8}', 'Room in my life for a real relationship', 'Leave work by 6pm three nights a week and say yes to one social plan', 'To lead with heart at work and at home', true, 'Thursday', '', now() - interval '6 days'),
  ('demo-marcus@example.com', 'Marcus Bell', '{"health":6,"career":5,"money":6,"love":7,"family":5,"fun":8,"growth":4,"home":6}', 'A morning routine I actually keep', 'Up by 6:30 and 10 minutes of journaling, 5 days a week', 'To stop drifting and start choosing my days', true, 'Monday', to_char(now(), 'IYYY-"W"IW'), now() - interval '4 days'),
  ('demo-hannah@example.com', 'Hannah Kim', '{"health":9,"career":6,"money":7,"love":8,"family":4,"fun":7,"growth":6,"home":7}', 'A closer relationship with my mom and sister', 'Call my mom every Sunday and plan one visit this month', 'To be the bridge that brings my family back together', false, 'Friday', '', now() - interval '41 days'),
  ('demo-tom@example.com', 'Tom Reyes', '{"health":4,"career":3,"money":4,"love":6,"family":7,"fun":5,"growth":5,"home":6}', 'Clarity on what I want to do next after my layoff', 'Have 2 coffee conversations with people in fields I''m curious about each week', 'To find work that uses my hands and my heart', true, 'Wednesday', '', now() - interval '2 days'),
  ('demo-grace@example.com', 'Grace Adeyemi', '{"health":7,"career":7,"money":7,"love":7,"family":8,"fun":6,"growth":8,"home":9}', 'My first half marathon in April', 'Follow my training plan: 3 runs and 1 strength day each week', 'To prove to myself that I finish what I start', true, 'Tuesday', to_char(now(), 'IYYY-"W"IW'), now())
) as d(email, name, wheel, creating, accountability, mission, reminder_enabled, reminder_day, done_week, updated_at)
join public.member_contacts c on lower(c.email) = d.email
where pr.id = c.id;
