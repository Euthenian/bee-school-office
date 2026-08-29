create or replace function public.update_student_mvp(
  p_student_id uuid,
  p_school_id uuid,
  p_first_name text,
  p_last_name text,
  p_preferred_name text default null,
  p_status public.student_status default 'active',
  p_start_date date default null,
  p_date_of_birth date default null,
  p_age_override smallint default null,
  p_contacts jsonb default '[]'::jsonb,
  p_assigned_teacher_profile_id uuid default null,
  p_lesson_type public.class_lesson_type default null,
  p_class_level_id text default null,
  p_lesson_day public.class_lesson_day default null,
  p_lesson_time time default null,
  p_guardians jsonb default '[]'::jsonb,
  p_notes jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_class_id uuid;
  v_class_use_count integer := 0;
  v_contact jsonb;
  v_contact_type public.contact_type;
  v_contact_type_text text;
  v_email_count integer := 0;
  v_email_primary_used boolean := false;
  v_enrollment public.student_enrollments%rowtype;
  v_enrollment_status public.enrollment_status;
  v_guardian jsonb;
  v_has_class_details boolean;
  v_is_primary boolean;
  v_label text;
  v_level_label text;
  v_note jsonb;
  v_note_id uuid;
  v_note_text text;
  v_note_visibility public.note_visibility;
  v_note_visibility_text text;
  v_organization_id uuid;
  v_phone_count integer := 0;
  v_phone_primary_used boolean := false;
  v_school_changed boolean := false;
  v_student public.students%rowtype;
  v_submitted_note_ids uuid[] := '{}'::uuid[];
  v_value text;
begin
  select * into v_student
  from public.students st
  where st.id = p_student_id;

  if not found then
    raise exception 'Student % was not found or is not accessible.', p_student_id;
  end if;

  if not public.can_manage_student(p_student_id) then
    raise exception 'You do not have permission to edit this student.';
  end if;

  if nullif(trim(p_first_name), '') is null then
    raise exception 'First name is required.';
  end if;

  if nullif(trim(p_last_name), '') is null then
    raise exception 'Last name is required.';
  end if;

  if p_age_override is not null and (p_age_override < 0 or p_age_override > 120) then
    raise exception 'Student age must be a whole number between 0 and 120.';
  end if;

  if jsonb_typeof(coalesce(p_contacts, '[]'::jsonb)) <> 'array' then
    raise exception 'Contacts must be submitted as a JSON array.';
  end if;

  if jsonb_typeof(coalesce(p_guardians, '[]'::jsonb)) <> 'array' then
    raise exception 'Guardians must be submitted as a JSON array.';
  end if;

  if jsonb_typeof(coalesce(p_notes, '[]'::jsonb)) <> 'array' then
    raise exception 'Notes must be submitted as a JSON array.';
  end if;

  select s.organization_id into v_organization_id
  from public.schools s
  where s.id = p_school_id;

  if v_organization_id is null then
    raise exception 'School % was not found or is not accessible.', p_school_id;
  end if;

  if not public.can_manage_school(p_school_id) then
    raise exception 'You do not have permission to move this student to the selected school.';
  end if;

  v_school_changed = v_student.school_id <> p_school_id or v_student.organization_id <> v_organization_id;

  if v_school_changed and (
    exists (select 1 from public.trial_lessons tl where tl.converted_student_id = p_student_id)
    or exists (select 1 from public.trial_lesson_participants tlp where tlp.converted_student_id = p_student_id)
  ) then
    raise exception 'Students linked to converted trial lessons cannot be moved to another school through this workflow.';
  end if;

  v_has_class_details =
    p_assigned_teacher_profile_id is not null
    or p_lesson_type is not null
    or nullif(trim(coalesce(p_class_level_id, '')), '') is not null
    or p_lesson_day is not null
    or p_lesson_time is not null;

  if v_has_class_details then
    if p_lesson_type is null
      or nullif(trim(coalesce(p_class_level_id, '')), '') is null
      or p_lesson_day is null
      or p_lesson_time is null
    then
      raise exception 'Lesson type, level, lesson day, and lesson time are required for class details.';
    end if;

    select cl.label into v_level_label
    from public.class_levels cl
    where cl.id = p_class_level_id
      and cl.status = 'active';

    if v_level_label is null then
      raise exception 'Class level % was not found or is not active.', p_class_level_id;
    end if;
  end if;

  for v_guardian in
    select value
    from jsonb_array_elements(coalesce(p_guardians, '[]'::jsonb)) as guardian_row(value)
  loop
    if jsonb_typeof(v_guardian) <> 'object' then
      raise exception 'Each guardian must be an object.';
    end if;

    if nullif(trim(coalesce(v_guardian ->> 'relationship', '')), '') is not null
      or nullif(trim(coalesce(v_guardian ->> 'email', '')), '') is not null
      or nullif(trim(coalesce(v_guardian ->> 'phone', '')), '') is not null
      or nullif(trim(coalesce(v_guardian ->> 'notes', '')), '') is not null
    then
      if nullif(trim(coalesce(v_guardian ->> 'full_name', '')), '') is null then
        raise exception 'Guardian name is required when guardian details are provided.';
      end if;
    end if;
  end loop;

  select coalesce(array_agg((note_row.value ->> 'id')::uuid), '{}'::uuid[]) into v_submitted_note_ids
  from jsonb_array_elements(coalesce(p_notes, '[]'::jsonb)) as note_row(value)
  where nullif(trim(coalesce(note_row.value ->> 'id', '')), '') is not null
    and nullif(trim(coalesce(note_row.value ->> 'note', '')), '') is not null;

  if v_school_changed then
    delete from public.student_notes sn
    where sn.student_id = p_student_id;

    delete from public.student_enrollments se
    where se.student_id = p_student_id;
  else
    select * into v_enrollment
    from public.student_enrollments se
    where se.student_id = p_student_id
    order by (se.status = 'active') desc, se.created_at desc, se.id
    limit 1;
  end if;

  update public.students
  set organization_id = v_organization_id,
      school_id = p_school_id,
      first_name = trim(p_first_name),
      last_name = trim(p_last_name),
      preferred_name = nullif(trim(coalesce(p_preferred_name, '')), ''),
      status = p_status,
      start_date = p_start_date,
      date_of_birth = p_date_of_birth,
      age_override = case when p_date_of_birth is null then p_age_override else null end
  where id = p_student_id;

  v_enrollment_status = case
    when p_status in ('active', 'pending', 'paused', 'withdrawn') then p_status::text::public.enrollment_status
    else 'active'::public.enrollment_status
  end;

  if v_has_class_details then
    if not v_school_changed and v_enrollment.id is not null and v_enrollment.class_id is not null then
      select count(*) into v_class_use_count
      from public.student_enrollments se
      where se.class_id = v_enrollment.class_id;
    end if;

    if not v_school_changed and v_enrollment.id is not null and v_enrollment.class_id is not null and v_class_use_count <= 1 then
      update public.classes
      set organization_id = v_organization_id,
          school_id = p_school_id,
          assigned_teacher_profile_id = p_assigned_teacher_profile_id,
          lesson_type = p_lesson_type,
          level_id = p_class_level_id,
          lesson_day = p_lesson_day,
          lesson_time = p_lesson_time
      where id = v_enrollment.class_id
      returning id into v_class_id;
    else
      insert into public.classes (
        organization_id,
        school_id,
        assigned_teacher_profile_id,
        lesson_type,
        level_id,
        lesson_day,
        lesson_time
      )
      values (
        v_organization_id,
        p_school_id,
        p_assigned_teacher_profile_id,
        p_lesson_type,
        p_class_level_id,
        p_lesson_day,
        p_lesson_time
      )
      returning id into v_class_id;
    end if;

    if v_school_changed or v_enrollment.id is null then
      insert into public.student_enrollments (
        organization_id,
        school_id,
        student_id,
        class_id,
        status,
        level,
        start_date
      )
      values (
        v_organization_id,
        p_school_id,
        p_student_id,
        v_class_id,
        v_enrollment_status,
        v_level_label,
        p_start_date
      );
    else
      update public.student_enrollments
      set organization_id = v_organization_id,
          school_id = p_school_id,
          class_id = v_class_id,
          status = v_enrollment_status,
          level = v_level_label,
          start_date = p_start_date
      where id = v_enrollment.id;
    end if;
  end if;

  delete from public.student_contacts sc
  where sc.student_id = p_student_id;

  for v_contact in
    select value
    from jsonb_array_elements(coalesce(p_contacts, '[]'::jsonb)) as contact_row(value)
  loop
    if jsonb_typeof(v_contact) <> 'object' then
      raise exception 'Each contact must be an object.';
    end if;

    v_value = nullif(trim(coalesce(v_contact ->> 'value', '')), '');
    continue when v_value is null;

    v_contact_type_text = lower(nullif(trim(coalesce(v_contact ->> 'contact_type', '')), ''));
    if v_contact_type_text not in ('email', 'phone') then
      raise exception 'Unsupported contact type %. Use email or phone.', v_contact_type_text;
    end if;

    v_contact_type = v_contact_type_text::public.contact_type;
    v_label = coalesce(nullif(trim(coalesce(v_contact ->> 'label', '')), ''), 'Other');
    v_is_primary = coalesce((v_contact ->> 'is_primary')::boolean, false);

    if v_contact_type = 'email' then
      v_email_count = v_email_count + 1;
      if v_is_primary and not v_email_primary_used then
        v_email_primary_used = true;
      else
        v_is_primary = false;
      end if;
    else
      v_phone_count = v_phone_count + 1;
      if v_is_primary and not v_phone_primary_used then
        v_phone_primary_used = true;
      else
        v_is_primary = false;
      end if;
    end if;

    insert into public.student_contacts (student_id, contact_type, label, value, is_primary)
    values (p_student_id, v_contact_type, v_label, v_value, v_is_primary);
  end loop;

  if v_email_count > 0 and not v_email_primary_used then
    update public.student_contacts sc
    set is_primary = true
    where sc.id = (
      select first_email.id
      from public.student_contacts first_email
      where first_email.student_id = p_student_id
        and first_email.contact_type = 'email'
      order by first_email.created_at, first_email.id
      limit 1
    );
  end if;

  if v_phone_count > 0 and not v_phone_primary_used then
    update public.student_contacts sc
    set is_primary = true
    where sc.id = (
      select first_phone.id
      from public.student_contacts first_phone
      where first_phone.student_id = p_student_id
        and first_phone.contact_type = 'phone'
      order by first_phone.created_at, first_phone.id
      limit 1
    );
  end if;

  delete from public.student_guardians sg
  where sg.student_id = p_student_id;

  for v_guardian in
    select value
    from jsonb_array_elements(coalesce(p_guardians, '[]'::jsonb)) as guardian_row(value)
  loop
    if nullif(trim(coalesce(v_guardian ->> 'full_name', '')), '') is null then
      continue;
    end if;

    insert into public.student_guardians (
      student_id,
      full_name,
      relationship,
      email,
      phone,
      notes
    )
    values (
      p_student_id,
      trim(v_guardian ->> 'full_name'),
      nullif(trim(coalesce(v_guardian ->> 'relationship', '')), ''),
      nullif(trim(coalesce(v_guardian ->> 'email', '')), '')::citext,
      nullif(trim(coalesce(v_guardian ->> 'phone', '')), ''),
      nullif(trim(coalesce(v_guardian ->> 'notes', '')), '')
    );
  end loop;

  if not v_school_changed then
    delete from public.student_notes sn
    where sn.student_id = p_student_id
      and not (sn.id = any (v_submitted_note_ids));
  end if;

  for v_note in
    select value
    from jsonb_array_elements(coalesce(p_notes, '[]'::jsonb)) as note_row(value)
  loop
    if jsonb_typeof(v_note) <> 'object' then
      raise exception 'Each note must be an object.';
    end if;

    v_note_text = nullif(trim(coalesce(v_note ->> 'note', '')), '');
    continue when v_note_text is null;

    v_note_id = nullif(trim(coalesce(v_note ->> 'id', '')), '')::uuid;
    v_note_visibility_text = coalesce(nullif(trim(coalesce(v_note ->> 'visibility', '')), ''), 'admin');
    if v_note_visibility_text not in ('admin', 'education') then
      raise exception 'Unsupported note visibility %. Use admin or education.', v_note_visibility_text;
    end if;
    v_note_visibility = v_note_visibility_text::public.note_visibility;

    if not v_school_changed
      and v_note_id is not null
      and exists (
        select 1
        from public.student_notes sn
        where sn.id = v_note_id
          and sn.student_id = p_student_id
      )
    then
      update public.student_notes
      set visibility = v_note_visibility,
          note = v_note_text
      where id = v_note_id
        and student_id = p_student_id;
    else
      insert into public.student_notes (
        organization_id,
        school_id,
        student_id,
        author_profile_id,
        visibility,
        note
      )
      values (
        v_organization_id,
        p_school_id,
        p_student_id,
        (select auth.uid()),
        v_note_visibility,
        v_note_text
      );
    end if;
  end loop;

  return p_student_id;
end;
$$;

revoke all on function public.update_student_mvp(
  uuid,
  uuid,
  text,
  text,
  text,
  public.student_status,
  date,
  date,
  smallint,
  jsonb,
  uuid,
  public.class_lesson_type,
  text,
  public.class_lesson_day,
  time,
  jsonb,
  jsonb
) from public, anon;

grant execute on function public.update_student_mvp(
  uuid,
  uuid,
  text,
  text,
  text,
  public.student_status,
  date,
  date,
  smallint,
  jsonb,
  uuid,
  public.class_lesson_type,
  text,
  public.class_lesson_day,
  time,
  jsonb,
  jsonb
) to authenticated;

notify pgrst, 'reload schema';
