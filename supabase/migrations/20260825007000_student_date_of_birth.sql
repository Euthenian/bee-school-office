alter table public.students
add column if not exists date_of_birth date;

drop function if exists public.create_student_mvp(
  uuid,
  text,
  text,
  text,
  public.student_status,
  date,
  jsonb,
  text,
  text,
  citext,
  text,
  text,
  text,
  text
);

create or replace function public.create_student_mvp(
  p_school_id uuid,
  p_first_name text,
  p_last_name text,
  p_preferred_name text default null,
  p_status public.student_status default 'active',
  p_start_date date default null,
  p_date_of_birth date default null,
  p_contacts jsonb default '[]'::jsonb,
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
  v_contact jsonb;
  v_contact_type public.contact_type;
  v_contact_type_text text;
  v_email_count integer := 0;
  v_email_primary_used boolean := false;
  v_enrollment_status public.enrollment_status;
  v_is_primary boolean;
  v_label text;
  v_organization_id uuid;
  v_phone_count integer := 0;
  v_phone_primary_used boolean := false;
  v_student_id uuid;
  v_value text;
begin
  if nullif(trim(p_first_name), '') is null then
    raise exception 'First name is required.';
  end if;

  if nullif(trim(p_last_name), '') is null then
    raise exception 'Last name is required.';
  end if;

  if jsonb_typeof(coalesce(p_contacts, '[]'::jsonb)) <> 'array' then
    raise exception 'Contacts must be submitted as a JSON array.';
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
    start_date,
    date_of_birth
  )
  values (
    v_organization_id,
    p_school_id,
    trim(p_first_name),
    trim(p_last_name),
    nullif(trim(coalesce(p_preferred_name, '')), ''),
    p_status,
    p_start_date,
    p_date_of_birth
  )
  returning id into v_student_id;

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
    values (v_student_id, v_contact_type, v_label, v_value, v_is_primary);
  end loop;

  if v_email_count > 0 and not v_email_primary_used then
    update public.student_contacts sc
    set is_primary = true
    where sc.id = (
      select first_email.id
      from public.student_contacts first_email
      where first_email.student_id = v_student_id
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
      where first_phone.student_id = v_student_id
        and first_phone.contact_type = 'phone'
      order by first_phone.created_at, first_phone.id
      limit 1
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
  date,
  jsonb,
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
  date,
  jsonb,
  text,
  text,
  citext,
  text,
  text,
  text,
  text
) to authenticated;
