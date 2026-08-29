drop policy if exists "prospects_select_visible" on public.prospects;
create policy "prospects_select_visible"
on public.prospects
for select
to authenticated
using (
  public.can_manage_school(school_id)
  or exists (
    select 1
    from public.trial_lessons tl
    where tl.prospect_id = public.prospects.id
      and tl.assigned_teacher_profile_id = (select auth.uid())
  )
);

drop policy if exists "prospect_contacts_select_visible" on public.prospect_contacts;
create policy "prospect_contacts_select_visible"
on public.prospect_contacts
for select
to authenticated
using (
  public.can_manage_school(school_id)
  or exists (
    select 1
    from public.trial_lessons tl
    where tl.prospect_id = public.prospect_contacts.prospect_id
      and tl.assigned_teacher_profile_id = (select auth.uid())
  )
);

drop policy if exists "prospect_contacts_insert_staff" on public.prospect_contacts;
create policy "prospect_contacts_insert_staff"
on public.prospect_contacts
for insert
to authenticated
with check (public.can_manage_school(school_id));

drop policy if exists "prospect_contacts_update_staff" on public.prospect_contacts;
create policy "prospect_contacts_update_staff"
on public.prospect_contacts
for update
to authenticated
using (public.can_manage_school(school_id))
with check (public.can_manage_school(school_id));

drop policy if exists "prospect_contacts_delete_staff" on public.prospect_contacts;
create policy "prospect_contacts_delete_staff"
on public.prospect_contacts
for delete
to authenticated
using (public.can_manage_school(school_id));

drop policy if exists "trial_lessons_select_visible" on public.trial_lessons;
create policy "trial_lessons_select_visible"
on public.trial_lessons
for select
to authenticated
using (
  public.can_manage_school(school_id)
  or assigned_teacher_profile_id = (select auth.uid())
);

drop policy if exists "trial_lesson_participants_select_visible" on public.trial_lesson_participants;
create policy "trial_lesson_participants_select_visible"
on public.trial_lesson_participants
for select
to authenticated
using (
  public.can_manage_school(school_id)
  or exists (
    select 1
    from public.trial_lessons tl
    where tl.id = public.trial_lesson_participants.trial_lesson_id
      and tl.assigned_teacher_profile_id = (select auth.uid())
  )
);

drop policy if exists "trial_lesson_participants_insert_staff" on public.trial_lesson_participants;
create policy "trial_lesson_participants_insert_staff"
on public.trial_lesson_participants
for insert
to authenticated
with check (public.can_manage_school(school_id));

drop policy if exists "trial_lesson_participants_update_staff" on public.trial_lesson_participants;
create policy "trial_lesson_participants_update_staff"
on public.trial_lesson_participants
for update
to authenticated
using (public.can_manage_school(school_id))
with check (public.can_manage_school(school_id));

drop policy if exists "trial_lesson_participants_delete_staff" on public.trial_lesson_participants;
create policy "trial_lesson_participants_delete_staff"
on public.trial_lesson_participants
for delete
to authenticated
using (public.can_manage_school(school_id));

notify pgrst, 'reload schema';
