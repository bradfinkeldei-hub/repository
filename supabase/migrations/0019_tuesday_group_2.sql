-- A second Tuesday group, on the Focus cards, beside the original Tuesday group.
-- (ALTER TYPE ... ADD VALUE can't be used in the same transaction as the new value,
-- so the team_names row is added in a separate statement after this commits.)
alter type public.team add value if not exists 'Tuesday2' after 'Tuesday';
