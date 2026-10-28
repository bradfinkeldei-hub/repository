-- Eight weeks of made-up accountability history for the Example team, so the
-- tracker has something to show. Run after migration 0006_commitment_log.sql.
-- Safe to run twice. To remove it:
--   delete from public.commitment_log where member_id in
--     (select id from public.member_contacts where email like 'demo-%@example.com');
insert into public.commitment_log (member_id, week, commitment, done)
select p.id,
  to_char((now() at time zone 'America/Chicago') - make_interval(weeks => n), 'IYYY-"W"IW'),
  p.accountability,
  -- Everyone misses now and then; some people more than others.
  (abs(hashtext(p.id::text || n::text)) % 10) < 4 + (abs(hashtext(p.id::text)) % 6)
from public.profiles p
join public.member_contacts c on c.id = p.id
cross join generate_series(1, 8) as n
where c.email like 'demo-%@example.com'
on conflict do nothing;
