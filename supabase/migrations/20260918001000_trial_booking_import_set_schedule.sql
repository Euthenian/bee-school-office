alter table public.pending_trial_booking_imports
  add column if not exists set_date date,
  add column if not exists set_time time;

comment on column public.pending_trial_booking_imports.set_date is
'Staff-confirmed scheduled trial date. This is operational scheduling data and does not replace first/second preferred source dates.';

comment on column public.pending_trial_booking_imports.set_time is
'Staff-confirmed scheduled trial time. This is operational scheduling data and does not replace first/second preferred source times.';

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

  v_trial_date = coalesce(p_trial_date, v_import.set_date);
  if v_trial_date is null then
    raise exception 'Set Date is required before conversion.';
  end if;

  v_trial_time = coalesce(p_trial_time, v_import.set_time);
  if v_trial_time is null then
    raise exception 'Set Time is required before conversion.';
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
  set set_date = v_trial_date,
      set_time = v_trial_time,
      converted_trial_lesson_id = v_trial_lesson_id,
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
