create or replace function public.create_student_mvp(
  p_school_id uuid,
  p_first_name text,
  p_last_name text,
  p_preferred_name text default null,
  p_status public.student_status default 'active',
  p_start_date date default null,
  p_contact_email text default null,
  p_contact_phone text default null,
  p_guardian_full_name text default null,
  p_guardian_relationship text default null,
  p_guardian_email citext default null,
  p_guardian_phone text default null,
  p_enrollment_level text default null,
  p_enrollment_class_name text default null,
  p_internal_note text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_organization_id uuid;
  v_student_id uuid;
  v_enrollment_status public.enrollment_status;
begin
  if nullif(trim(p_first_name), '') is null then
    raise exception 'First name is required.';
  end if;

  if nullif(trim(p_last_name), '') is null then
    raise exception 'Last name is required.';
  end if;

  select s.organization_id into v_organization_id
  from public.schools s
  where s.id = p_school_id;

  if v_organization_id is null then
    raise exception 'School % was not found or is not accessible.', p_school_id;
  end if;

  if nullif(trim(coalesce(p_guardian_email::text, '')), '') is not null
    or nullif(trim(coalesce(p_guardian_phone, '')), '') is not null
    or nullif(trim(coalesce(p_guardian_relationship, '')), '') is not null
  then
    if nullif(trim(coalesce(p_guardian_full_name, '')), '') is null then
      raise exception 'Guardian name is required when guardian details are provided.';
    end if;
  end if;

  insert into public.students (
    organization_id,
    school_id,
    first_name,
    last_name,
    preferred_name,
    status,
    start_date
  )
  values (
    v_organization_id,
    p_school_id,
    trim(p_first_name),
    trim(p_last_name),
    nullif(trim(coalesce(p_preferred_name, '')), ''),
    p_status,
    p_start_date
  )
  returning id into v_student_id;

  if nullif(trim(coalesce(p_contact_email, '')), '') is not null then
    insert into public.student_contacts (student_id, contact_type, label, value, is_primary)
    values (v_student_id, 'email', 'Email', trim(p_contact_email), true);
  end if;

  if nullif(trim(coalesce(p_contact_phone, '')), '') is not null then
    insert into public.student_contacts (student_id, contact_type, label, value, is_primary)
    values (
      v_student_id,
      'phone',
      'Phone',
      trim(p_contact_phone),
      nullif(trim(coalesce(p_contact_email, '')), '') is null
    );
  end if;

  if nullif(trim(coalesce(p_guardian_full_name, '')), '') is not null then
    insert into public.student_guardians (
      student_id,
      full_name,
      relationship,
      email,
      phone
    )
    values (
      v_student_id,
      trim(p_guardian_full_name),
      nullif(trim(coalesce(p_guardian_relationship, '')), ''),
      nullif(trim(coalesce(p_guardian_email::text, '')), '')::citext,
      nullif(trim(coalesce(p_guardian_phone, '')), '')
    );
  end if;

  if nullif(trim(coalesce(p_enrollment_level, '')), '') is not null
    or nullif(trim(coalesce(p_enrollment_class_name, '')), '') is not null
  then
    v_enrollment_status = case
      when p_status in ('active', 'pending', 'paused', 'withdrawn') then p_status::text::public.enrollment_status
      else 'active'::public.enrollment_status
    end;

    insert into public.student_enrollments (
      organization_id,
      school_id,
      student_id,
      status,
      level,
      class_name,
      start_date
    )
    values (
      v_organization_id,
      p_school_id,
      v_student_id,
      v_enrollment_status,
      nullif(trim(coalesce(p_enrollment_level, '')), ''),
      nullif(trim(coalesce(p_enrollment_class_name, '')), ''),
      p_start_date
    );
  end if;

  if nullif(trim(coalesce(p_internal_note, '')), '') is not null then
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
      v_student_id,
      (select auth.uid()),
      'admin',
      trim(p_internal_note)
    );
  end if;

  return v_student_id;
end;
$$;

revoke all on function public.create_student_mvp(
  uuid,
  text,
  text,
  text,
  public.student_status,
  date,
  text,
  text,
  text,
  text,
  citext,
  text,
  text,
  text,
  text
) from public, anon;

grant execute on function public.create_student_mvp(
  uuid,
  text,
  text,
  text,
  public.student_status,
  date,
  text,
  text,
  text,
  text,
  citext,
  text,
  text,
  text,
  text
) to authenticated;
