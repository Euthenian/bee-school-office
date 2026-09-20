create or replace function public.update_trial_lesson_conversion_details_mvp(
  p_trial_lesson_id uuid,
  p_lesson_type public.class_lesson_type default null,
  p_level_id text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_level_id text;
  v_lesson_type public.class_lesson_type;
  v_trial public.trial_lessons%rowtype;
begin
  select * into v_trial
  from public.trial_lessons tl
  where tl.id = p_trial_lesson_id
  for update;

  if not found then
    raise exception 'Trial lesson % was not found or is not accessible.', p_trial_lesson_id;
  end if;

  if not public.can_manage_school(v_trial.school_id) then
    raise exception 'You do not have permission to update this trial lesson.';
  end if;

  if v_trial.converted_student_id is not null then
    raise exception 'Converted trial lessons cannot be changed before conversion.';
  end if;

  v_lesson_type = coalesce(p_lesson_type, v_trial.lesson_type);
  v_level_id = coalesce(nullif(trim(coalesce(p_level_id, '')), ''), v_trial.level_id);

  if v_lesson_type is null then
    raise exception 'Lesson type is required before converting this trial lesson.';
  end if;

  if v_level_id is null then
    raise exception 'Level is required before converting this trial lesson.';
  end if;

  if not exists (
    select 1
    from public.class_levels cl
    where cl.id = v_level_id
      and cl.status = 'active'
  ) then
    raise exception 'Level % was not found or is not active.', v_level_id;
  end if;

  update public.trial_lessons
  set lesson_type = v_lesson_type,
      level_id = v_level_id,
      updated_at = now()
  where id = v_trial.id;

  return v_trial.id;
end;
$$;

revoke all on function public.update_trial_lesson_conversion_details_mvp(uuid, public.class_lesson_type, text) from public, anon;
grant execute on function public.update_trial_lesson_conversion_details_mvp(uuid, public.class_lesson_type, text) to authenticated;

create or replace function public.convert_trial_lesson_prospect_to_student(
  p_trial_lesson_id uuid,
  p_start_date date default current_date
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_participant_count integer;
  v_participant_id uuid;
  v_participant_name text;
  v_prospect public.prospects%rowtype;
  v_student_id uuid;
  v_trial public.trial_lessons%rowtype;
begin
  select * into v_trial
  from public.trial_lessons tl
  where tl.id = p_trial_lesson_id
  for update;

  if not found then
    raise exception 'Trial lesson % was not found or is not accessible.', p_trial_lesson_id;
  end if;

  if not public.can_manage_school(v_trial.school_id) then
    raise exception 'You do not have permission to convert this trial lesson.';
  end if;

  if v_trial.converted_student_id is not null then
    return v_trial.converted_student_id;
  end if;

  if v_trial.prospect_id is null then
    raise exception 'A prospect is required before converting this trial lesson.';
  end if;

  if v_trial.lesson_type is null or v_trial.level_id is null then
    raise exception 'Lesson type and level are required before converting this trial lesson.';
  end if;

  select * into v_prospect
  from public.prospects pr
  where pr.id = v_trial.prospect_id
    and pr.organization_id = v_trial.organization_id
    and pr.school_id = v_trial.school_id;

  if not found then
    raise exception 'The trial lesson prospect is not in the same organization and school.';
  end if;

  select count(*)::integer into v_participant_count
  from public.trial_lesson_participants tlp
  where tlp.trial_lesson_id = v_trial.id;

  if v_participant_count > 0 then
    select tlp.id into v_participant_id
    from public.trial_lesson_participants tlp
    where tlp.trial_lesson_id = v_trial.id
      and tlp.converted_student_id is null
    order by tlp.created_at, tlp.id
    limit 1;

    if v_participant_id is null then
      select tlp.converted_student_id into v_student_id
      from public.trial_lesson_participants tlp
      where tlp.trial_lesson_id = v_trial.id
        and tlp.converted_student_id is not null
      order by tlp.created_at, tlp.id
      limit 1;

      if v_student_id is not null then
        update public.trial_lessons
        set status = 'joined',
            converted_student_id = coalesce(converted_student_id, v_student_id),
            updated_at = now()
        where id = v_trial.id;

        return v_student_id;
      end if;

      raise exception 'No unconverted trial participant is available for this trial lesson.';
    end if;

    return public.convert_trial_lesson_participant_to_student(v_trial.id, v_participant_id, p_start_date);
  end if;

  v_participant_name = coalesce(
    nullif(trim(coalesce(v_prospect.japanese_name, '')), ''),
    nullif(trim(coalesce(v_prospect.alphabet_name, '')), '')
  );

  if v_participant_name is null then
    raise exception 'A prospect name is required before converting this trial lesson.';
  end if;

  insert into public.trial_lesson_participants (
    organization_id,
    school_id,
    trial_lesson_id,
    japanese_name,
    furigana,
    alphabet_name,
    requested_level_id
  )
  values (
    v_trial.organization_id,
    v_trial.school_id,
    v_trial.id,
    v_participant_name,
    nullif(trim(coalesce(v_prospect.furigana, '')), ''),
    nullif(trim(coalesce(v_prospect.alphabet_name, '')), ''),
    v_trial.level_id
  )
  returning id into v_participant_id;

  return public.convert_trial_lesson_participant_to_student(v_trial.id, v_participant_id, p_start_date);
end;
$$;

revoke all on function public.convert_trial_lesson_prospect_to_student(uuid, date) from public, anon;
grant execute on function public.convert_trial_lesson_prospect_to_student(uuid, date) to authenticated;

notify pgrst, 'reload schema';
