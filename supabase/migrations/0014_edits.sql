-- Lets people change what they wrote, not just add or delete it.
--
-- Comments: the author or the coach can edit them. Milestones: the member on
-- their own card, or the coach. Private notes: the coach (the existing "only
-- the coach" policy already covers updates). Kudos: the giver can add or change
-- a short note on theirs, and can still take it back as before.
--
-- An edit can only change the words (and a milestone's date). Who wrote it,
-- whose card it's on and when it was posted stay as they were, and the
-- database stamps when it was edited and by whom so the app can say "edited".

alter table public.card_comments
  add column edited_at timestamptz,
  add column edited_by uuid references public.profiles (id) on delete set null;
alter table public.milestones
  add column edited_at timestamptz,
  add column edited_by uuid references public.profiles (id) on delete set null;
alter table public.coach_notes
  add column edited_at timestamptz,
  add column edited_by uuid references public.profiles (id) on delete set null;
alter table public.kudos
  add column note text not null default '' check (char_length(note) <= 140);

-- Keeps every column except the ones named in the trigger's arguments as they
-- were, then stamps edited_at and edited_by if anything did change.
create function public.guard_edit() returns trigger
language plpgsql set search_path = public as $$
begin
  new := jsonb_populate_record(new, to_jsonb(old) - tg_argv);
  if to_jsonb(new) ? 'edited_at' and to_jsonb(new) is distinct from to_jsonb(old) then
    new := jsonb_populate_record(new, jsonb_build_object('edited_at', now(), 'edited_by', auth.uid()));
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_edit() from public, anon, authenticated;

create trigger guard_edit before update on public.card_comments
  for each row execute function public.guard_edit('body');
create trigger guard_edit before update on public.milestones
  for each row execute function public.guard_edit('title', 'achieved_on');
create trigger guard_edit before update on public.coach_notes
  for each row execute function public.guard_edit('body');
create trigger guard_edit before update on public.kudos
  for each row execute function public.guard_edit('note');

create policy "edit your own comment, or any as coach" on public.card_comments
  for update using (author_id = auth.uid() or public.is_coach())
  with check (author_id = auth.uid() or public.is_coach());
create policy "edit milestones on your own card, or anyone's as coach" on public.milestones
  for update using (member_id = auth.uid() or public.is_coach())
  with check (member_id = auth.uid() or public.is_coach());
create policy "change the note on your own kudos" on public.kudos
  for update using (author_id = auth.uid()) with check (author_id = auth.uid());
