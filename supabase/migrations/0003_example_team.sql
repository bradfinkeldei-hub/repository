-- A fifth team for demos. Run this on its own before supabase/seed/example_team.sql:
-- Postgres only lets a new enum value be used after the statement adding it has committed.
alter type public.team add value if not exists 'Example';
