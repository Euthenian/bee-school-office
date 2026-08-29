create or replace function public.delete_trial_lesson_mvp(p_trial_lesson_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted_communications integer := 0;
  v_deleted_integration_actions integer := 0;
  v_deleted_participants integer := 0;
  v_deleted_prospect_id uuid;
  v_deleted_trial_lessons integer := 0;
  v_preserved_student_communications integer := 0;
  v_prospect_id uuid;
  v_trial public.trial_lessons%rowtype;
  v_unlinked_integration_actions integer := 0;
  v_unlinked_pending_imports integer := 0;
begin
  if p_trial_lesson_id is null then
    raise exception 'Trial lesson is required.';
  end if;

  select * into v_trial
  from public.trial_lessons tl
  where tl.id = p_trial_lesson_id
  for update;

  if not found then
    raise exception 'Trial lesson % was not found or is not accessible.', p_trial_lesson_id;
  end if;

  if not public.can_manage_school(v_trial.school_id) then
    raise exception 'You do not have permission to delete this trial lesson.';
  end if;

  v_prospect_id = v_trial.prospect_id;

  select count(*) into v_deleted_participants
  from public.trial_lesson_participants tlp
  where tlp.trial_lesson_id = v_trial.id;

  update public.pending_trial_booking_imports p
  set converted_trial_lesson_id = null,
      converted_at = null,
      converted_by = null,
      review_status = 'reviewed',
      updated_at = now()
  where p.converted_trial_lesson_id = v_trial.id;
  get diagnostics v_unlinked_pending_imports = row_count;

  update public.communication_integration_actions cia
  set trial_lesson_id = null,
      updated_at = now()
  where cia.trial_lesson_id = v_trial.id
    and exists (
      select 1
      from public.communications c
      where c.id = cia.communication_id
        and c.student_id is not null
    );
  get diagnostics v_unlinked_integration_actions = row_count;

  delete from public.communication_integration_actions cia
  where cia.trial_lesson_id = v_trial.id
     or exists (
       select 1
       from public.communications c
       where c.id = cia.communication_id
         and c.trial_lesson_id = v_trial.id
         and c.student_id is null
     );
  get diagnostics v_deleted_integration_actions = row_count;

  update public.communications c
  set trial_lesson_id = null,
      updated_at = now()
  where c.trial_lesson_id = v_trial.id
    and c.student_id is not null;
  get diagnostics v_preserved_student_communications = row_count;

  delete from public.communications c
  where c.trial_lesson_id = v_trial.id
    and c.student_id is null;
  get diagnostics v_deleted_communications = row_count;

  delete from public.trial_lessons tl
  where tl.id = v_trial.id;
  get diagnostics v_deleted_trial_lessons = row_count;

  if v_deleted_trial_lessons <> 1 then
    raise exception 'Trial lesson % could not be deleted.', p_trial_lesson_id;
  end if;

  delete from public.prospects pr
  where pr.id = v_prospect_id
    and not exists (
      select 1
      from public.trial_lessons tl
      where tl.prospect_id = pr.id
    )
    and not exists (
      select 1
      from public.communications c
      where c.prospect_id = pr.id
    )
  returning pr.id into v_deleted_prospect_id;

  return jsonb_build_object(
    'status', 'deleted',
    'trial_lesson_id', v_trial.id,
    'deleted_participants', v_deleted_participants,
    'deleted_communications', v_deleted_communications,
    'deleted_integration_actions', v_deleted_integration_actions,
    'deleted_prospect', v_deleted_prospect_id is not null,
    'deleted_prospect_id', v_deleted_prospect_id,
    'preserved_student_communications', v_preserved_student_communications,
    'unlinked_integration_actions', v_unlinked_integration_actions,
    'unlinked_pending_imports', v_unlinked_pending_imports
  );
end;
$$;

revoke all on function public.delete_trial_lesson_mvp(uuid) from public, anon;
grant execute on function public.delete_trial_lesson_mvp(uuid) to authenticated;

notify pgrst, 'reload schema';
