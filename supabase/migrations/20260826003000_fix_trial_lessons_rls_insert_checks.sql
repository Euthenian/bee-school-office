drop policy if exists "prospects_insert_staff" on public.prospects;
create policy "prospects_insert_staff"
on public.prospects
for insert
to authenticated
with check (public.can_manage_school(school_id));

drop policy if exists "prospects_update_staff" on public.prospects;
create policy "prospects_update_staff"
on public.prospects
for update
to authenticated
using (public.can_manage_school(school_id))
with check (public.can_manage_school(school_id));

drop policy if exists "prospect_contacts_insert_staff" on public.prospect_contacts;
create policy "prospect_contacts_insert_staff"
on public.prospect_contacts
for insert
to authenticated
with check (
  public.can_manage_prospect(prospect_id)
  and public.can_manage_school(school_id)
);

drop policy if exists "prospect_contacts_update_staff" on public.prospect_contacts;
create policy "prospect_contacts_update_staff"
on public.prospect_contacts
for update
to authenticated
using (public.can_manage_prospect(prospect_id))
with check (
  public.can_manage_prospect(prospect_id)
  and public.can_manage_school(school_id)
);

drop policy if exists "trial_lessons_insert_staff" on public.trial_lessons;
create policy "trial_lessons_insert_staff"
on public.trial_lessons
for insert
to authenticated
with check (public.can_manage_school(school_id));

drop policy if exists "trial_lessons_update_staff" on public.trial_lessons;
create policy "trial_lessons_update_staff"
on public.trial_lessons
for update
to authenticated
using (public.can_manage_school(school_id))
with check (public.can_manage_school(school_id));

drop policy if exists "trial_lesson_participants_insert_staff" on public.trial_lesson_participants;
create policy "trial_lesson_participants_insert_staff"
on public.trial_lesson_participants
for insert
to authenticated
with check (
  public.can_manage_trial_lesson(trial_lesson_id)
  and public.can_manage_school(school_id)
);

drop policy if exists "trial_lesson_participants_update_staff" on public.trial_lesson_participants;
create policy "trial_lesson_participants_update_staff"
on public.trial_lesson_participants
for update
to authenticated
using (public.can_manage_trial_lesson(trial_lesson_id))
with check (
  public.can_manage_trial_lesson(trial_lesson_id)
  and public.can_manage_school(school_id)
);

notify pgrst, 'reload schema';
