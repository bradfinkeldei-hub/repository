-- A member's other focuses can be answered like the main one.
-- later_details maps each name on the "later" list to its answers
-- (outcome, measure, meaning, start_point, held_by, confirmed_at, ...).
alter table public.focus_cards
  add column if not exists later_details jsonb not null default '{}'::jsonb;
