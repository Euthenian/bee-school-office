alter table public.pending_trial_booking_imports
add column if not exists converted_trial_lesson_id uuid,
add column if not exists converted_at timestamptz,
add column if not exists converted_by uuid;

alter table public.pending_trial_booking_imports
drop constraint if exists pending_trial_booking_imports_review_status_check;

alter table public.pending_trial_booking_imports
add constraint pending_trial_booking_imports_review_status_check
check (review_status in ('pending_review', 'reviewed', 'dismissed', 'converted'));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pending_trial_booking_imports_converted_trial_lesson_id_fkey'
      and conrelid = 'public.pending_trial_booking_imports'::regclass
  ) then
    alter table public.pending_trial_booking_imports
    add constraint pending_trial_booking_imports_converted_trial_lesson_id_fkey
    foreign key (converted_trial_lesson_id, organization_id, school_id)
    references public.trial_lessons (id, organization_id, school_id)
    on delete restrict;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pending_trial_booking_imports_converted_by_fkey'
      and conrelid = 'public.pending_trial_booking_imports'::regclass
  ) then
    alter table public.pending_trial_booking_imports
    add constraint pending_trial_booking_imports_converted_by_fkey
    foreign key (converted_by)
    references public.profiles (id)
    on delete set null;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pending_trial_booking_imports_conversion_trace_check'
      and conrelid = 'public.pending_trial_booking_imports'::regclass
  ) then
    alter table public.pending_trial_booking_imports
    add constraint pending_trial_booking_imports_conversion_trace_check
    check (
      (
        converted_trial_lesson_id is null
        and converted_at is null
        and review_status <> 'converted'
      )
      or (
        converted_trial_lesson_id is not null
        and converted_at is not null
        and review_status = 'converted'
      )
    );
  end if;
end;
$$;

create unique index if not exists pending_trial_booking_imports_converted_trial_lesson_id_k
on public.pending_trial_booking_imports (converted_trial_lesson_id)
where converted_trial_lesson_id is not null;

create index if not exists pending_trial_booking_imports_converted_at_idx
on public.pending_trial_booking_imports (converted_at desc)
where converted_at is not null;

create or replace function public.create_trial_lesson_for_prospect_mvp(
  p_school_id uuid,
  p_prospect_id uuid,
  p_contacts jsonb default '[]'::jsonb,
  p_trial_date date default null,
  p_trial_time time default null,
  p_assigned_teacher_profile_id uuid default null,
  p_lesson_type public.class_lesson_type default 'group',
  p_level_id text default null,
  p_status public.trial_lesson_status default 'booked',
  p_customer_request text default null,
  p_internal_notes text default null,
  p_participants jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_age_group_level_id text;
  v_age_override smallint;
  v_contact jsonb;
  v_contact_type public.contact_type;
  v_contact_type_text text;
  v_date_of_birth date;
  v_email_primary_exists boolean;
  v_existing_normalized_value text;
  v_inserted_participant_ids uuid[] := array[]::uuid[];
  v_is_primary boolean;
  v_label text;
  v_normalized_value text;
  v_organization_id uuid;
  v_participant jsonb;
  v_participant_id uuid;
  v_phone_primary_exists boolean;
  v_prospect public.prospects%rowtype;
  v_requested_level_id text;
  v_trial_lesson_id uuid;
  v_value text;
begin
  if p_prospect_id is null then
    raise exception 'Prospect is required.';
  end if;

  select * into v_prospect
  from public.prospects pr
  where pr.id = p_prospect_id
    and pr.school_id = p_school_id;

  if not found then
    raise exception 'Prospect % was not found for the selected school.', p_prospect_id;
  end if;

  v_organization_id = v_prospect.organization_id;

  if not public.can_manage_school(v_prospect.school_id) then
    raise exception 'You do not have permission to create trial lessons for this school.';
  end if;

  if p_trial_date is null then
    raise exception 'Trial date is required.';
  end if;

  if p_trial_time is null then
    raise exception 'Trial time is required.';
  end if;

  if nullif(trim(coalesce(p_level_id, '')), '') is null then
    raise exception 'Level is required.';
  end if;

  if not exists (
    select 1
    from public.class_levels cl
    where cl.id = p_level_id
      and cl.status = 'active'
  ) then
    raise exception 'Level % was not found or is not active.', p_level_id;
  end if;

  if jsonb_typeof(coalesce(p_contacts, '[]'::jsonb)) <> 'array' then
    raise exception 'Contacts must be submitted as a JSON array.';
  end if;

  if jsonb_typeof(coalesce(p_participants, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_participants, '[]'::jsonb)) = 0
  then
    raise exception 'At least one trial participant is required.';
  end if;

  select exists (
    select 1
    from public.prospect_contacts pc
    where pc.prospect_id = p_prospect_id
      and pc.contact_type = 'email'
      and pc.is_primary
  ) into v_email_primary_exists;

  select exists (
    select 1
    from public.prospect_contacts pc
    where pc.prospect_id = p_prospect_id
      and pc.contact_type = 'phone'
      and pc.is_primary
  ) into v_phone_primary_exists;

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
    if v_contact_type_text is null or v_contact_type_text not in ('email', 'phone') then
      raise exception 'Unsupported contact type %. Use email or phone.', coalesce(v_contact_type_text, '<empty>');
    end if;

    v_contact_type = v_contact_type_text::public.contact_type;
    v_label = coalesce(nullif(trim(coalesce(v_contact ->> 'label', '')), ''), 'Other');

    if v_contact_type = 'email' then
      v_normalized_value = lower(v_value);
    else
      v_normalized_value = regexp_replace(v_value, '[^0-9]+', '', 'g');
    end if;

    if exists (
      select 1
      from public.prospect_contacts pc
      where pc.prospect_id = p_prospect_id
        and pc.contact_type = v_contact_type
        and (
          case
            when pc.contact_type = 'email' then lower(trim(pc.value))
            else regexp_replace(pc.value, '[^0-9]+', '', 'g')
          end
        ) = v_normalized_value
    ) then
      continue;
    end if;

    if v_contact_type = 'email' then
      v_is_primary = not v_email_primary_exists;
      v_email_primary_exists = true;
    else
      v_is_primary = not v_phone_primary_exists;
      v_phone_primary_exists = true;
    end if;

    insert into public.prospect_contacts (
      organization_id,
      school_id,
      prospect_id,
      contact_type,
      label,
      value,
      is_primary
    )
    values (
      v_organization_id,
      p_school_id,
      p_prospect_id,
      v_contact_type,
      v_label,
      v_value,
      v_is_primary
    );
  end loop;

  insert into public.trial_lessons (
    organization_id,
    school_id,
    prospect_id,
    trial_date,
    trial_time,
    assigned_teacher_profile_id,
    lesson_type,
    level_id,
    customer_request,
    internal_notes,
    status
  )
  values (
    v_organization_id,
    p_school_id,
    p_prospect_id,
    p_trial_date,
    p_trial_time,
    p_assigned_teacher_profile_id,
    coalesce(p_lesson_type, 'group'),
    p_level_id,
    nullif(trim(coalesce(p_customer_request, '')), ''),
    nullif(trim(coalesce(p_internal_notes, '')), ''),
    coalesce(p_status, 'booked')
  )
  returning id into v_trial_lesson_id;

  for v_participant in
    select value
    from jsonb_array_elements(coalesce(p_participants, '[]'::jsonb)) as participant_row(value)
  loop
    if jsonb_typeof(v_participant) <> 'object' then
      raise exception 'Each participant must be an object.';
    end if;

    if nullif(trim(coalesce(v_participant ->> 'japanese_name', '')), '') is null then
      raise exception 'Each participant must have a Japanese name.';
    end if;

    v_date_of_birth = nullif(trim(coalesce(v_participant ->> 'date_of_birth', '')), '')::date;
    v_age_override = nullif(trim(coalesce(v_participant ->> 'age_override', '')), '')::smallint;
    v_age_group_level_id = nullif(trim(coalesce(v_participant ->> 'age_group_level_id', '')), '');
    v_requested_level_id = nullif(trim(coalesce(v_participant ->> 'requested_level_id', '')), '');

    if v_age_override is not null and (v_age_override < 0 or v_age_override > 120) then
      raise exception 'Participant age must be a whole number between 0 and 120.';
    end if;

    if v_age_group_level_id is not null and not exists (
      select 1 from public.class_levels cl where cl.id = v_age_group_level_id and cl.status = 'active'
    ) then
      raise exception 'Age group level % was not found or is not active.', v_age_group_level_id;
    end if;

    if v_requested_level_id is not null and not exists (
      select 1 from public.class_levels cl where cl.id = v_requested_level_id and cl.status = 'active'
    ) then
      raise exception 'Requested level % was not found or is not active.', v_requested_level_id;
    end if;

    insert into public.trial_lesson_participants (
      organization_id,
      school_id,
      trial_lesson_id,
      japanese_name,
      furigana,
      alphabet_name,
      date_of_birth,
      age_override,
      age_group_level_id,
      requested_level_id
    )
    values (
      v_organization_id,
      p_school_id,
      v_trial_lesson_id,
      trim(v_participant ->> 'japanese_name'),
      nullif(trim(coalesce(v_participant ->> 'furigana', '')), ''),
      nullif(trim(coalesce(v_participant ->> 'alphabet_name', '')), ''),
      v_date_of_birth,
      case when v_date_of_birth is null then v_age_override else null end,
      v_age_group_level_id,
      v_requested_level_id
    )
    returning id into v_participant_id;

    v_inserted_participant_ids = array_append(v_inserted_participant_ids, v_participant_id);
  end loop;

  return v_trial_lesson_id;
end;
$$;

revoke all on function public.create_trial_lesson_for_prospect_mvp(
  uuid,
  uuid,
  jsonb,
  date,
  time,
  uuid,
  public.class_lesson_type,
  text,
  public.trial_lesson_status,
  text,
  text,
  jsonb
) from public, anon;

grant execute on function public.create_trial_lesson_for_prospect_mvp(
  uuid,
  uuid,
  jsonb,
  date,
  time,
  uuid,
  public.class_lesson_type,
  text,
  public.trial_lesson_status,
  text,
  text,
  jsonb
) to authenticated;

create or replace function public.create_trial_lesson_mvp(
  p_school_id uuid,
  p_contact_japanese_name text,
  p_contact_furigana text default null,
  p_contact_alphabet_name text default null,
  p_contacts jsonb default '[]'::jsonb,
  p_inquiry_method_id text default null,
  p_acquisition_source_id text default null,
  p_trial_date date default null,
  p_trial_time time default null,
  p_assigned_teacher_profile_id uuid default null,
  p_lesson_type public.class_lesson_type default 'group',
  p_level_id text default null,
  p_status public.trial_lesson_status default 'booked',
  p_customer_request text default null,
  p_internal_notes text default null,
  p_participants jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_acquisition_source_id text;
  v_inquiry_method_id text;
  v_organization_id uuid;
  v_prospect_id uuid;
begin
  if nullif(trim(p_contact_japanese_name), '') is null then
    raise exception 'Contact name is required.';
  end if;

  select s.organization_id into v_organization_id
  from public.schools s
  where s.id = p_school_id;

  if v_organization_id is null then
    raise exception 'School % was not found or is not accessible.', p_school_id;
  end if;

  if not public.can_manage_school(p_school_id) then
    raise exception 'You do not have permission to create trial lessons for this school.';
  end if;

  v_inquiry_method_id = nullif(trim(coalesce(p_inquiry_method_id, '')), '');
  if v_inquiry_method_id is not null and not exists (
    select 1 from public.inquiry_methods im where im.id = v_inquiry_method_id and im.status = 'active'
  ) then
    raise exception 'Inquiry method % was not found or is not active.', v_inquiry_method_id;
  end if;

  v_acquisition_source_id = nullif(trim(coalesce(p_acquisition_source_id, '')), '');
  if v_acquisition_source_id is not null and not exists (
    select 1 from public.acquisition_sources src where src.id = v_acquisition_source_id and src.status = 'active'
  ) then
    raise exception 'Acquisition source % was not found or is not active.', v_acquisition_source_id;
  end if;

  insert into public.prospects (
    organization_id,
    school_id,
    japanese_name,
    furigana,
    alphabet_name,
    inquiry_method_id,
    acquisition_source_id
  )
  values (
    v_organization_id,
    p_school_id,
    trim(p_contact_japanese_name),
    nullif(trim(coalesce(p_contact_furigana, '')), ''),
    nullif(trim(coalesce(p_contact_alphabet_name, '')), ''),
    v_inquiry_method_id,
    v_acquisition_source_id
  )
  returning id into v_prospect_id;

  return public.create_trial_lesson_for_prospect_mvp(
    p_school_id,
    v_prospect_id,
    p_contacts,
    p_trial_date,
    p_trial_time,
    p_assigned_teacher_profile_id,
    p_lesson_type,
    p_level_id,
    p_status,
    p_customer_request,
    p_internal_notes,
    p_participants
  );
end;
$$;

revoke all on function public.create_trial_lesson_mvp(
  uuid,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  date,
  time,
  uuid,
  public.class_lesson_type,
  text,
  public.trial_lesson_status,
  text,
  text,
  jsonb
) from public, anon;

grant execute on function public.create_trial_lesson_mvp(
  uuid,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  date,
  time,
  uuid,
  public.class_lesson_type,
  text,
  public.trial_lesson_status,
  text,
  text,
  jsonb
) to authenticated;

create or replace function public.convert_pending_trial_booking_import_to_trial_lesson(
  p_pending_import_id uuid,
  p_prospect_id uuid default null,
  p_create_new_prospect boolean default false,
  p_trial_date date default null,
  p_trial_time time default null,
  p_lesson_type public.class_lesson_type default null,
  p_level_id text default null,
  p_assigned_teacher_profile_id uuid default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_contact_rows jsonb := '[]'::jsonb;
  v_created_new_prospect boolean := false;
  v_import public.pending_trial_booking_imports%rowtype;
  v_lesson_type public.class_lesson_type;
  v_lesson_type_text text;
  v_participant_ids uuid[];
  v_participants jsonb;
  v_prospect public.prospects%rowtype;
  v_prospect_id uuid;
  v_trial_date date;
  v_trial_lesson_id uuid;
  v_trial_time time;
begin
  if p_create_new_prospect and p_prospect_id is not null then
    raise exception 'Choose either an existing prospect or a new prospect, not both.';
  end if;

  if not p_create_new_prospect and p_prospect_id is null then
    raise exception 'A prospect choice is required before conversion.';
  end if;

  select * into v_import
  from public.pending_trial_booking_imports p
  where p.id = p_pending_import_id
  for update;

  if not found then
    raise exception 'Pending Trial Booking import % was not found.', p_pending_import_id;
  end if;

  if not public.can_manage_school(v_import.school_id) then
    raise exception 'You do not have permission to convert this pending booking.';
  end if;

  if v_import.converted_trial_lesson_id is not null then
    return jsonb_build_object(
      'status', 'already_converted',
      'pending_import_id', v_import.id,
      'trial_lesson_id', v_import.converted_trial_lesson_id,
      'prospect_id', (
        select tl.prospect_id from public.trial_lessons tl where tl.id = v_import.converted_trial_lesson_id
      ),
      'converted_at', v_import.converted_at,
      'created_new_prospect', false,
      'participant_ids', coalesce((
        select jsonb_agg(tlp.id order by tlp.created_at, tlp.id)
        from public.trial_lesson_participants tlp
        where tlp.trial_lesson_id = v_import.converted_trial_lesson_id
      ), '[]'::jsonb)
    );
  end if;

  if v_import.review_status <> 'reviewed' then
    raise exception 'Only reviewed pending bookings can be converted.';
  end if;

  if v_import.parse_status <> 'parsed' then
    raise exception 'Only successfully parsed pending bookings can be converted.';
  end if;

  if nullif(trim(coalesce(v_import.student_name, '')), '') is null then
    raise exception 'Student name is required before conversion.';
  end if;

  v_trial_date = coalesce(p_trial_date, v_import.first_preferred_date);
  if v_trial_date is null then
    raise exception 'Trial date is required before conversion.';
  end if;

  v_trial_time = coalesce(p_trial_time, v_import.first_preferred_time);
  if v_trial_time is null then
    raise exception 'Trial time is required before conversion.';
  end if;

  if nullif(trim(coalesce(p_level_id, '')), '') is null then
    raise exception 'Level must be selected before conversion. Imported course text is not mapped automatically.';
  end if;

  v_lesson_type = p_lesson_type;
  if v_lesson_type is null then
    v_lesson_type_text = lower(coalesce(v_import.lesson_type, ''));
    if v_lesson_type_text like '%private%' or v_lesson_type_text like '%プライベート%' then
      v_lesson_type = 'private';
    elsif v_lesson_type_text like '%group%' or v_lesson_type_text like '%グループ%' then
      v_lesson_type = 'group';
    else
      raise exception 'Lesson type must be selected before conversion.';
    end if;
  end if;

  if p_create_new_prospect then
    insert into public.prospects (
      organization_id,
      school_id,
      japanese_name
    )
    values (
      v_import.organization_id,
      v_import.school_id,
      trim(v_import.student_name)
    )
    returning * into v_prospect;

    v_prospect_id = v_prospect.id;
    v_created_new_prospect = true;
  else
    select * into v_prospect
    from public.prospects pr
    where pr.id = p_prospect_id
      and pr.organization_id = v_import.organization_id
      and pr.school_id = v_import.school_id;

    if not found then
      raise exception 'Selected prospect is not in the same organization and school as this pending booking.';
    end if;

    v_prospect_id = v_prospect.id;
  end if;

  if nullif(trim(coalesce(v_import.email, '')), '') is not null then
    v_contact_rows = v_contact_rows || jsonb_build_array(jsonb_build_object(
      'contact_type', 'email',
      'label', 'Email',
      'value', trim(v_import.email),
      'is_primary', true
    ));
  end if;

  if nullif(trim(coalesce(v_import.phone, '')), '') is not null then
    v_contact_rows = v_contact_rows || jsonb_build_array(jsonb_build_object(
      'contact_type', 'phone',
      'label', 'Phone',
      'value', trim(v_import.phone),
      'is_primary', true
    ));
  end if;

  v_participants = jsonb_build_array(jsonb_build_object(
    'japanese_name', trim(v_import.student_name),
    'age_override', v_import.student_age,
    'requested_level_id', p_level_id
  ));

  v_trial_lesson_id = public.create_trial_lesson_for_prospect_mvp(
    v_import.school_id,
    v_prospect_id,
    v_contact_rows,
    v_trial_date,
    v_trial_time,
    p_assigned_teacher_profile_id,
    v_lesson_type,
    p_level_id,
    'booked',
    v_import.customer_message,
    null,
    v_participants
  );

  update public.pending_trial_booking_imports
  set converted_trial_lesson_id = v_trial_lesson_id,
      converted_at = now(),
      converted_by = (select auth.uid()),
      review_status = 'converted',
      updated_at = now()
  where id = v_import.id
  returning * into v_import;

  select array_agg(tlp.id order by tlp.created_at, tlp.id) into v_participant_ids
  from public.trial_lesson_participants tlp
  where tlp.trial_lesson_id = v_trial_lesson_id;

  return jsonb_build_object(
    'status', 'converted',
    'pending_import_id', v_import.id,
    'trial_lesson_id', v_trial_lesson_id,
    'prospect_id', v_prospect_id,
    'converted_at', v_import.converted_at,
    'created_new_prospect', v_created_new_prospect,
    'participant_ids', coalesce(to_jsonb(v_participant_ids), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.convert_pending_trial_booking_import_to_trial_lesson(
  uuid,
  uuid,
  boolean,
  date,
  time,
  public.class_lesson_type,
  text,
  uuid
) from public, anon;

grant execute on function public.convert_pending_trial_booking_import_to_trial_lesson(
  uuid,
  uuid,
  boolean,
  date,
  time,
  public.class_lesson_type,
  text,
  uuid
) to authenticated;

notify pgrst, 'reload schema';
