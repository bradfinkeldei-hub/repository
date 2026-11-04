-- A separate Pilot group for testing the Focus walkthrough and Group board.
-- Run on its own before 0018: Postgres only lets a new enum value be used
-- after the statement adding it has committed.
alter type public.team add value if not exists 'Pilot';
