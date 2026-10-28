-- "Who am I going to be?": the person each member is choosing to be,
-- shown on their card next to what they're creating. Same reach as the
-- other profile fields, so no new policies.
alter table public.profiles add column becoming text not null default '';
