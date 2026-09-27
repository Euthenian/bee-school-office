drop policy if exists "trial_packages_select_visible" on public.trial_packages;
create policy "trial_packages_select_visible"
on public.trial_packages
for select
to authenticated
using (
  public.can_manage_school(school_id)
  or exists (
    select 1
    from public.trial_package_lessons tpl
    join public.staff st
      on st.id = tpl.assigned_teacher_staff_id
      and st.organization_id = tpl.organization_id
    where tpl.trial_package_id = public.trial_packages.id
      and st.profile_id = (select auth.uid())
  )
);

notify pgrst, 'reload schema';
