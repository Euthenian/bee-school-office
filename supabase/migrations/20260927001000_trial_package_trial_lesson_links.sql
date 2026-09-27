alter table public.trial_package_lessons
  add column if not exists trial_lesson_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'trial_package_lessons_trial_lesson_id_organization_id_school_id_fkey'
      and conrelid = 'public.trial_package_lessons'::regclass
  ) then
    alter table public.trial_package_lessons
      add constraint trial_package_lessons_trial_lesson_id_organization_id_school_id_fkey
      foreign key (trial_lesson_id, organization_id, school_id)
      references public.trial_lessons (id, organization_id, school_id)
      on delete restrict;
  end if;
end;
$$;

create unique index if not exists trial_package_lessons_trial_lesson_id_uidx
on public.trial_package_lessons (trial_lesson_id)
where trial_lesson_id is not null;

create index if not exists trial_package_lessons_linked_trial_idx
on public.trial_package_lessons (trial_lesson_id, trial_package_id)
where trial_lesson_id is not null;

comment on column public.trial_package_lessons.trial_lesson_id is
'Optional link to an existing trial_lessons booking. When set, trial_lessons remains the source of truth for that package lesson date, time, teacher, and attendance status.';

create or replace function public.trial_package_lesson_status_from_trial_lesson_status(
  p_status public.trial_lesson_status
)
returns public.trial_package_lesson_status
language sql
immutable
set search_path = public
as $$
  select case p_status
    when 'completed' then 'completed'::public.trial_package_lesson_status
    when 'joined' then 'completed'::public.trial_package_lesson_status
    when 'did_not_join' then 'completed'::public.trial_package_lesson_status
    when 'no_show' then 'no_show'::public.trial_package_lesson_status
    when 'cancelled' then 'cancelled'::public.trial_package_lesson_status
    else 'scheduled'::public.trial_package_lesson_status
  end;
$$;

revoke all on function public.trial_package_lesson_status_from_trial_lesson_status(public.trial_lesson_status) from public, anon;
grant execute on function public.trial_package_lesson_status_from_trial_lesson_status(public.trial_lesson_status) to authenticated;

create or replace function public.ensure_trial_package_lesson_trial_lesson_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_package public.trial_packages%rowtype;
  v_trial public.trial_lessons%rowtype;
begin
  if new.trial_lesson_id is null then
    return new;
  end if;

  select * into v_package
  from public.trial_packages tp
  where tp.id = new.trial_package_id;

  if not found then
    raise exception 'Trial package % was not found.', new.trial_package_id;
  end if;

  select * into v_trial
  from public.trial_lessons tl
  where tl.id = new.trial_lesson_id;

  if not found then
    raise exception 'Trial lesson % was not found.', new.trial_lesson_id;
  end if;

  if v_trial.organization_id <> new.organization_id
    or v_trial.school_id <> new.school_id
    or v_trial.organization_id <> v_package.organization_id
    or v_trial.school_id <> v_package.school_id
    or v_trial.prospect_id <> v_package.prospect_id
  then
    raise exception 'Linked trial lesson must belong to the same prospect, organization, and school as the trial package.';
  end if;

  new.lesson_date = v_trial.trial_date;
  new.lesson_time = v_trial.trial_time;
  new.status = public.trial_package_lesson_status_from_trial_lesson_status(v_trial.status);

  return new;
end;
$$;

revoke all on function public.ensure_trial_package_lesson_trial_lesson_link() from public, anon, authenticated;

drop trigger if exists trial_package_lessons_trial_lesson_link_check on public.trial_package_lessons;
create trigger trial_package_lessons_trial_lesson_link_check
before insert or update of trial_lesson_id, organization_id, school_id, trial_package_id, lesson_date, lesson_time, status
on public.trial_package_lessons
for each row execute function public.ensure_trial_package_lesson_trial_lesson_link();

create or replace function public.sync_trial_package_lesson_from_trial_lesson()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.trial_package_lessons
  set lesson_date = new.trial_date,
      lesson_time = new.trial_time,
      status = public.trial_package_lesson_status_from_trial_lesson_status(new.status),
      updated_at = now()
  where trial_lesson_id = new.id;

  return new;
end;
$$;

revoke all on function public.sync_trial_package_lesson_from_trial_lesson() from public, anon, authenticated;

drop trigger if exists trial_lessons_sync_package_lesson on public.trial_lessons;
create trigger trial_lessons_sync_package_lesson
after update of trial_date, trial_time, status
on public.trial_lessons
for each row execute function public.sync_trial_package_lesson_from_trial_lesson();

create or replace function public.create_trial_package_from_trial_lesson_mvp(
  p_trial_lesson_id uuid
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_lesson_number integer;
  v_package_id uuid;
  v_trial public.trial_lessons%rowtype;
begin
  if p_trial_lesson_id is null then
    raise exception 'Trial lesson is required.';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_trial_lesson_id::text), 20260927);

  select tpl.trial_package_id into v_package_id
  from public.trial_package_lessons tpl
  where tpl.trial_lesson_id = p_trial_lesson_id
  order by tpl.created_at, tpl.id
  limit 1;

  if v_package_id is not null then
    return v_package_id;
  end if;

  select * into v_trial
  from public.trial_lessons tl
  where tl.id = p_trial_lesson_id
  for update;

  if not found then
    raise exception 'Trial lesson % was not found.', p_trial_lesson_id;
  end if;

  if not public.can_manage_school(v_trial.school_id) then
    raise exception 'You do not have permission to create a trial package for this trial lesson.';
  end if;

  if v_trial.lesson_type <> 'group'::public.class_lesson_type then
    raise exception 'Only group trial lessons can create a 4-lesson trial package.';
  end if;

  if nullif(trim(coalesce(v_trial.level_id, '')), '') is null then
    raise exception 'Trial lesson level is required before creating a trial package.';
  end if;

  insert into public.trial_packages (
    organization_id,
    school_id,
    prospect_id,
    package_type,
    lesson_type,
    level_id,
    total_lessons,
    customer_request,
    internal_notes
  )
  values (
    v_trial.organization_id,
    v_trial.school_id,
    v_trial.prospect_id,
    'group_english',
    v_trial.lesson_type,
    v_trial.level_id,
    4,
    v_trial.customer_request,
    v_trial.internal_notes
  )
  returning id into v_package_id;

  for v_lesson_number in 1..4 loop
    insert into public.trial_package_lessons (
      organization_id,
      school_id,
      trial_package_id,
      lesson_number,
      trial_lesson_id,
      lesson_date,
      lesson_time,
      status
    )
    values (
      v_trial.organization_id,
      v_trial.school_id,
      v_package_id,
      v_lesson_number,
      case when v_lesson_number = 1 then v_trial.id else null end,
      case when v_lesson_number = 1 then v_trial.trial_date else null end,
      case when v_lesson_number = 1 then v_trial.trial_time else null end,
      case
        when v_lesson_number = 1 then public.trial_package_lesson_status_from_trial_lesson_status(v_trial.status)
        else 'not_scheduled'::public.trial_package_lesson_status
      end
    );
  end loop;

  return v_package_id;
end;
$$;

revoke all on function public.create_trial_package_from_trial_lesson_mvp(uuid) from public, anon;
grant execute on function public.create_trial_package_from_trial_lesson_mvp(uuid) to authenticated;

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
  v_lesson public.trial_package_lessons%rowtype;
  v_status public.trial_package_lesson_status;
begin
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

  if v_lesson.trial_lesson_id is not null then
    if p_notes is distinct from v_lesson.notes then
      update public.trial_package_lessons
      set notes = nullif(trim(coalesce(p_notes, '')), ''),
          updated_at = now()
      where id = v_lesson.id;
    end if;

    return v_lesson.id;
  end if;

  v_status = coalesce(p_status, v_lesson.status);

  if v_status = 'scheduled' and (p_lesson_date is null or p_lesson_time is null) then
    raise exception 'Scheduled package lessons require a date and time.';
  end if;

  update public.trial_package_lessons
  set lesson_date = p_lesson_date,
      lesson_time = p_lesson_time,
      assigned_teacher_staff_id = p_assigned_teacher_staff_id,
      status = v_status,
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      updated_at = now()
  where id = v_lesson.id;

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
  v_trial_package_id uuid;
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
    select tl.lesson_type into v_lesson_type
    from public.trial_lessons tl
    where tl.id = v_import.converted_trial_lesson_id;

    if v_lesson_type = 'group'::public.class_lesson_type then
      v_trial_package_id = public.create_trial_package_from_trial_lesson_mvp(v_import.converted_trial_lesson_id);
    end if;

    return jsonb_build_object(
      'status', 'already_converted',
      'pending_import_id', v_import.id,
      'trial_lesson_id', v_import.converted_trial_lesson_id,
      'trial_package_id', v_trial_package_id,
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
    if v_lesson_type_text like '%private%' or v_lesson_type_text like '%' || U&'\30D7\30E9\30A4\30D9\30FC\30C8' || '%' then
      v_lesson_type = 'private';
    elsif v_lesson_type_text like '%group%' or v_lesson_type_text like '%' || U&'\30B0\30EB\30FC\30D7' || '%' then
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

  if v_lesson_type = 'group'::public.class_lesson_type then
    v_trial_package_id = public.create_trial_package_from_trial_lesson_mvp(v_trial_lesson_id);
  end if;

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
    'trial_package_id', v_trial_package_id,
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
