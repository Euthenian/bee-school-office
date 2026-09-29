create or replace function public.update_trial_package_lesson_mvp(
  p_trial_package_lesson_id uuid,
  p_lesson_date date default null,
  p_lesson_time time default null,
  p_assigned_teacher_staff_id uuid default null,
  p_status public.trial_package_lesson_status default null,
  p_notes text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_assigned_teacher_profile_id uuid;
  v_lesson public.trial_package_lessons%rowtype;
  v_notes text;
  v_package public.trial_packages%rowtype;
  v_participants jsonb;
  v_source_trial_lesson_id uuid;
  v_status public.trial_package_lesson_status;
  v_trial_lesson public.trial_lessons%rowtype;
  v_trial_lesson_id uuid;
  v_trial_status public.trial_lesson_status;
begin
  if p_trial_package_lesson_id is null then
    raise exception 'Trial package lesson is required.';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_trial_package_lesson_id::text), 2026092703);

  select * into v_lesson
  from public.trial_package_lessons tpl
  where tpl.id = p_trial_package_lesson_id
  for update;

  if not found then
    raise exception 'Trial package lesson % was not found.', p_trial_package_lesson_id;
  end if;

  if not public.can_manage_trial_package(v_lesson.trial_package_id) then
    raise exception 'You do not have permission to update this trial package lesson.';
  end if;

  select * into v_package
  from public.trial_packages tp
  where tp.id = v_lesson.trial_package_id
  for update;

  if not found then
    raise exception 'Trial package % was not found.', v_lesson.trial_package_id;
  end if;

  v_status = coalesce(p_status, v_lesson.status);
  v_notes = nullif(trim(coalesce(p_notes, '')), '');

  if v_status = 'scheduled' and (p_lesson_date is null or p_lesson_time is null) then
    raise exception 'Scheduled package lessons require a date and time.';
  end if;

  if p_assigned_teacher_staff_id is not null then
    if not public.has_active_staff_teacher_staff_assignment(v_package.school_id, p_assigned_teacher_staff_id) then
      raise exception 'Assigned teacher is not active for this school.';
    end if;

    select st.profile_id into v_assigned_teacher_profile_id
    from public.staff st
    where st.id = p_assigned_teacher_staff_id
      and st.organization_id = v_package.organization_id;
  else
    v_assigned_teacher_profile_id = null;
  end if;

  if v_lesson.trial_lesson_id is not null then
    if v_status = 'not_scheduled' then
      raise exception 'Linked trial package lessons cannot be changed back to not scheduled. Update or cancel the linked booking instead.';
    end if;

    select * into v_trial_lesson
    from public.trial_lessons tl
    where tl.id = v_lesson.trial_lesson_id
      and tl.organization_id = v_lesson.organization_id
      and tl.school_id = v_lesson.school_id
    for update;

    if not found then
      raise exception 'Linked trial lesson % was not found.', v_lesson.trial_lesson_id;
    end if;

    v_trial_status = case v_status
      when 'completed' then 'completed'::public.trial_lesson_status
      when 'cancelled' then 'cancelled'::public.trial_lesson_status
      when 'no_show' then 'no_show'::public.trial_lesson_status
      else 'booked'::public.trial_lesson_status
    end;

    update public.trial_lessons
    set trial_date = p_lesson_date,
        trial_time = p_lesson_time,
        assigned_teacher_profile_id = v_assigned_teacher_profile_id,
        status = v_trial_status,
        customer_request = v_package.customer_request,
        internal_notes = nullif(trim(concat_ws(E'\n\n', v_package.internal_notes, v_notes)), ''),
        updated_at = now()
    where id = v_trial_lesson.id;

    update public.trial_package_lessons
    set assigned_teacher_staff_id = p_assigned_teacher_staff_id,
        notes = v_notes,
        updated_at = now()
    where id = v_lesson.id;

    return v_lesson.id;
  end if;

  if v_status <> 'scheduled' then
    update public.trial_package_lessons
    set lesson_date = p_lesson_date,
        lesson_time = p_lesson_time,
        assigned_teacher_staff_id = p_assigned_teacher_staff_id,
        status = v_status,
        notes = v_notes,
        updated_at = now()
    where id = v_lesson.id;

    return v_lesson.id;
  end if;

  select tpl.trial_lesson_id into v_source_trial_lesson_id
  from public.trial_package_lessons tpl
  where tpl.trial_package_id = v_package.id
    and tpl.organization_id = v_package.organization_id
    and tpl.school_id = v_package.school_id
    and tpl.trial_lesson_id is not null
  order by tpl.lesson_number, tpl.created_at, tpl.id
  limit 1;

  if v_source_trial_lesson_id is not null then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'japanese_name', tlp.japanese_name,
          'furigana', tlp.furigana,
          'alphabet_name', tlp.alphabet_name,
          'date_of_birth', tlp.date_of_birth,
          'age_override', tlp.age_override,
          'age_group_level_id', tlp.age_group_level_id,
          'requested_level_id', tlp.requested_level_id
        )
        order by tlp.created_at, tlp.id
      ),
      '[]'::jsonb
    ) into v_participants
    from public.trial_lesson_participants tlp
    where tlp.trial_lesson_id = v_source_trial_lesson_id;
  else
    select jsonb_build_array(jsonb_build_object(
      'japanese_name', pr.japanese_name,
      'furigana', pr.furigana,
      'alphabet_name', pr.alphabet_name,
      'requested_level_id', v_package.level_id
    )) into v_participants
    from public.prospects pr
    where pr.id = v_package.prospect_id
      and pr.organization_id = v_package.organization_id
      and pr.school_id = v_package.school_id;
  end if;

  if jsonb_array_length(coalesce(v_participants, '[]'::jsonb)) = 0 then
    raise exception 'A package lesson requires at least one participant before creating a linked trial lesson.';
  end if;

  v_trial_lesson_id = public.create_trial_lesson_for_prospect_mvp(
    v_package.school_id,
    v_package.prospect_id,
    '[]'::jsonb,
    p_lesson_date,
    p_lesson_time,
    v_assigned_teacher_profile_id,
    v_package.lesson_type,
    v_package.level_id,
    'booked',
    v_package.customer_request,
    nullif(trim(concat_ws(E'\n\n', v_package.internal_notes, v_notes)), ''),
    v_participants
  );

  update public.trial_package_lessons
  set trial_lesson_id = v_trial_lesson_id,
      lesson_date = p_lesson_date,
      lesson_time = p_lesson_time,
      assigned_teacher_staff_id = p_assigned_teacher_staff_id,
      status = 'scheduled',
      notes = v_notes,
      updated_at = now()
  where id = v_lesson.id
    and trial_lesson_id is null;

  if not found then
    raise exception 'Trial package lesson % was linked by another request. Retry the save.', v_lesson.id;
  end if;

  return v_lesson.id;
end;
$$;

revoke all on function public.update_trial_package_lesson_mvp(
  uuid,
  date,
  time,
  uuid,
  public.trial_package_lesson_status,
  text
) from public, anon;

grant execute on function public.update_trial_package_lesson_mvp(
  uuid,
  date,
  time,
  uuid,
  public.trial_package_lesson_status,
  text
) to authenticated;

notify pgrst, 'reload schema';
