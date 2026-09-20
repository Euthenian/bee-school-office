create or replace function public.create_class_mvp(
  p_school_id uuid,
  p_lesson_type public.class_lesson_type,
  p_class_level_id text,
  p_lesson_day public.class_lesson_day,
  p_lesson_time time,
  p_assigned_teacher_profile_id uuid default null,
  p_status text default 'active'
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_class_id uuid;
  v_organization_id uuid;
begin
  select s.organization_id into v_organization_id
  from public.schools s
  where s.id = p_school_id
    and s.status = 'active';

  if v_organization_id is null then
    raise exception 'School % was not found or is not active.', p_school_id;
  end if;

  if not public.can_manage_school(p_school_id) then
    raise exception 'You do not have permission to manage classes for this school.';
  end if;

  if p_status not in ('active', 'inactive') then
    raise exception 'Class status must be active or inactive.';
  end if;

  if p_lesson_type is null
    or nullif(trim(coalesce(p_class_level_id, '')), '') is null
    or p_lesson_day is null
    or p_lesson_time is null
  then
    raise exception 'Lesson type, level, lesson day, and lesson time are required.';
  end if;

  if not exists (
    select 1
    from public.class_levels cl
    where cl.id = p_class_level_id
      and cl.status = 'active'
  ) then
    raise exception 'Class level % was not found or is not active.', p_class_level_id;
  end if;

  insert into public.classes (
    organization_id,
    school_id,
    assigned_teacher_profile_id,
    lesson_type,
    level_id,
    lesson_day,
    lesson_time,
    status
  )
  values (
    v_organization_id,
    p_school_id,
    p_assigned_teacher_profile_id,
    p_lesson_type,
    p_class_level_id,
    p_lesson_day,
    p_lesson_time,
    p_status
  )
  returning id into v_class_id;

  return v_class_id;
end;
$$;

revoke all on function public.create_class_mvp(uuid, public.class_lesson_type, text, public.class_lesson_day, time, uuid, text) from public, anon;
grant execute on function public.create_class_mvp(uuid, public.class_lesson_type, text, public.class_lesson_day, time, uuid, text) to authenticated;

create or replace function public.update_class_mvp(
  p_class_id uuid,
  p_school_id uuid,
  p_lesson_type public.class_lesson_type,
  p_class_level_id text,
  p_lesson_day public.class_lesson_day,
  p_lesson_time time,
  p_assigned_teacher_profile_id uuid default null,
  p_status text default 'active'
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_class public.classes%rowtype;
  v_organization_id uuid;
begin
  select * into v_class
  from public.classes c
  where c.id = p_class_id
  for update;

  if not found then
    raise exception 'Class % was not found.', p_class_id;
  end if;

  select s.organization_id into v_organization_id
  from public.schools s
  where s.id = p_school_id;

  if v_organization_id is null then
    raise exception 'School % was not found.', p_school_id;
  end if;

  if v_organization_id <> v_class.organization_id then
    raise exception 'Class cannot be moved outside its organization.';
  end if;

  if p_school_id <> v_class.school_id and exists (
    select 1
    from public.student_enrollments se
    where se.class_id = p_class_id
  ) then
    raise exception 'A class with student enrollments cannot be moved to another school.';
  end if;

  if not public.can_manage_school(v_class.school_id) or not public.can_manage_school(p_school_id) then
    raise exception 'You do not have permission to manage this class.';
  end if;

  if p_status not in ('active', 'inactive') then
    raise exception 'Class status must be active or inactive.';
  end if;

  if p_lesson_type is null
    or nullif(trim(coalesce(p_class_level_id, '')), '') is null
    or p_lesson_day is null
    or p_lesson_time is null
  then
    raise exception 'Lesson type, level, lesson day, and lesson time are required.';
  end if;

  if not exists (
    select 1
    from public.class_levels cl
    where cl.id = p_class_level_id
      and cl.status = 'active'
  ) then
    raise exception 'Class level % was not found or is not active.', p_class_level_id;
  end if;

  update public.classes
  set school_id = p_school_id,
      assigned_teacher_profile_id = p_assigned_teacher_profile_id,
      lesson_type = p_lesson_type,
      level_id = p_class_level_id,
      lesson_day = p_lesson_day,
      lesson_time = p_lesson_time,
      status = p_status
  where id = p_class_id;

  return p_class_id;
end;
$$;

revoke all on function public.update_class_mvp(uuid, uuid, public.class_lesson_type, text, public.class_lesson_day, time, uuid, text) from public, anon;
grant execute on function public.update_class_mvp(uuid, uuid, public.class_lesson_type, text, public.class_lesson_day, time, uuid, text) to authenticated;

create or replace function public.update_student_class_assignment_billing_mvp(
  p_student_id uuid,
  p_billing_plan_id uuid default null,
  p_monthly_fee_yen integer default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_billing_id uuid;
  v_current_billing_plan_id uuid;
  v_monthly_fee_yen integer;
  v_plan public.billing_plans%rowtype;
  v_student public.students%rowtype;
begin
  select * into v_student
  from public.students st
  where st.id = p_student_id
  for update;

  if not found then
    raise exception 'Student % was not found.', p_student_id;
  end if;

  if not public.can_manage_student_finance_org(v_student.organization_id, v_student.school_id) then
    raise exception 'You do not have permission to update student finance details.';
  end if;

  select sbp.id, sbp.billing_plan_id into v_billing_id, v_current_billing_plan_id
  from public.student_billing_profiles sbp
  where sbp.student_id = p_student_id
    and sbp.organization_id = v_student.organization_id
    and sbp.school_id = v_student.school_id
  order by sbp.updated_at desc, sbp.created_at desc
  limit 1
  for update;

  if p_billing_plan_id is not null then
    select * into v_plan
    from public.billing_plans bp
    where bp.id = p_billing_plan_id;

    if not found then
      raise exception 'Lesson Package is not available for this student.';
    end if;

    if v_plan.organization_id <> v_student.organization_id
      or (v_plan.school_id is not null and v_plan.school_id <> v_student.school_id)
    then
      raise exception 'Lesson Package is not available for this student.';
    end if;

    if v_current_billing_plan_id is distinct from p_billing_plan_id and not v_plan.active then
      raise exception 'Inactive Lesson Packages cannot be newly assigned.';
    end if;
  end if;

  v_monthly_fee_yen = coalesce(p_monthly_fee_yen, case when p_billing_plan_id is not null then v_plan.monthly_fee_yen else null end);

  if v_monthly_fee_yen is not null and (v_monthly_fee_yen < 0 or v_monthly_fee_yen > 100000) then
    raise exception 'Monthly fee must be between 0 and 100000.';
  end if;

  if v_billing_id is not null then
    update public.student_billing_profiles
    set billing_plan_id = p_billing_plan_id,
        monthly_fee_yen = v_monthly_fee_yen,
        currency = 'JPY'
    where id = v_billing_id;
  elsif p_billing_plan_id is not null or v_monthly_fee_yen is not null then
    insert into public.student_billing_profiles (
      organization_id,
      school_id,
      student_id,
      billing_plan_id,
      monthly_fee_yen,
      currency,
      source_type
    )
    values (
      v_student.organization_id,
      v_student.school_id,
      p_student_id,
      p_billing_plan_id,
      v_monthly_fee_yen,
      'JPY',
      'manual'
    );
  end if;

  return p_student_id;
end;
$$;

revoke all on function public.update_student_class_assignment_billing_mvp(uuid, uuid, integer) from public, anon;
grant execute on function public.update_student_class_assignment_billing_mvp(uuid, uuid, integer) to authenticated;

create or replace function public.assign_student_to_class_mvp(
  p_student_id uuid,
  p_school_id uuid,
  p_student_status public.student_status,
  p_start_date date default null,
  p_existing_class_id uuid default null,
  p_create_new_class boolean default false,
  p_assigned_teacher_profile_id uuid default null,
  p_lesson_type public.class_lesson_type default null,
  p_class_level_id text default null,
  p_lesson_day public.class_lesson_day default null,
  p_lesson_time time default null,
  p_billing_plan_id uuid default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_class public.classes%rowtype;
  v_class_id uuid;
  v_enrollment public.student_enrollments%rowtype;
  v_enrollment_status public.enrollment_status;
  v_level_label text;
  v_organization_id uuid;
  v_plan_lesson_type public.class_lesson_type;
  v_student public.students%rowtype;
begin
  if p_existing_class_id is not null and p_create_new_class then
    raise exception 'Choose either an existing class or a new class, not both.';
  end if;

  select * into v_student
  from public.students st
  where st.id = p_student_id
  for update;

  if not found then
    raise exception 'Student % was not found.', p_student_id;
  end if;

  if v_student.school_id <> p_school_id then
    raise exception 'Student school does not match the requested class assignment school.';
  end if;

  v_organization_id = v_student.organization_id;

  if p_billing_plan_id is not null then
    select bp.lesson_type into v_plan_lesson_type
    from public.billing_plans bp
    where bp.id = p_billing_plan_id
      and bp.organization_id = v_organization_id
      and (bp.school_id is null or bp.school_id = p_school_id);

    if not found then
      raise exception 'Lesson Package is not available for this student.';
    end if;
  end if;

  if p_existing_class_id is null and not p_create_new_class then
    raise exception 'Select an existing class or create a new class.';
  end if;

  if p_existing_class_id is not null then
    select * into v_class
    from public.classes c
    where c.id = p_existing_class_id
      and c.organization_id = v_organization_id
      and c.school_id = p_school_id
      and c.status = 'active';

    if not found then
      raise exception 'Selected class is not active or is not in this student school.';
    end if;

    v_class_id = v_class.id;
  else
    if v_plan_lesson_type is not null and p_lesson_type is distinct from v_plan_lesson_type then
      raise exception 'New class lesson type must match the selected Lesson Package.';
    end if;

    v_class_id = public.create_class_mvp(
      p_school_id,
      p_lesson_type,
      p_class_level_id,
      p_lesson_day,
      p_lesson_time,
      p_assigned_teacher_profile_id,
      'active'
    );

    select * into v_class
    from public.classes c
    where c.id = v_class_id;
  end if;

  if v_plan_lesson_type is not null and v_class.lesson_type is distinct from v_plan_lesson_type then
    raise exception 'Selected class lesson type does not match the selected Lesson Package.';
  end if;

  select cl.label into v_level_label
  from public.class_levels cl
  where cl.id = v_class.level_id;

  v_enrollment_status = case
    when p_student_status in ('active', 'pending', 'paused', 'withdrawn') then p_student_status::text::public.enrollment_status
    else 'active'::public.enrollment_status
  end;

  select * into v_enrollment
  from public.student_enrollments se
  where se.student_id = p_student_id
  order by (se.status = 'active') desc, se.created_at desc, se.id
  limit 1
  for update;

  if v_enrollment.id is null then
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
        start_date = p_start_date,
        end_date = null
    where id = v_enrollment.id;
  end if;

  return v_class_id;
end;
$$;

revoke all on function public.assign_student_to_class_mvp(uuid, uuid, public.student_status, date, uuid, boolean, uuid, public.class_lesson_type, text, public.class_lesson_day, time, uuid) from public, anon;
grant execute on function public.assign_student_to_class_mvp(uuid, uuid, public.student_status, date, uuid, boolean, uuid, public.class_lesson_type, text, public.class_lesson_day, time, uuid) to authenticated;

create or replace function public.create_student_with_class_assignment_mvp(
  p_school_id uuid,
  p_first_name text,
  p_last_name text,
  p_preferred_name text default null,
  p_status public.student_status default 'active',
  p_start_date date default null,
  p_date_of_birth date default null,
  p_age_override smallint default null,
  p_contacts jsonb default '[]'::jsonb,
  p_billing_plan_id uuid default null,
  p_monthly_fee_yen integer default null,
  p_assigned_teacher_profile_id uuid default null,
  p_lesson_type public.class_lesson_type default null,
  p_class_level_id text default null,
  p_create_new_class boolean default false,
  p_existing_class_id uuid default null,
  p_lesson_day public.class_lesson_day default null,
  p_lesson_time time default null,
  p_guardian_full_name text default null,
  p_guardian_relationship text default null,
  p_guardian_email citext default null,
  p_guardian_phone text default null,
  p_internal_note text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_student_id uuid;
begin
  v_student_id = public.create_student_mvp(
    p_school_id,
    p_first_name,
    p_last_name,
    p_preferred_name,
    p_status,
    p_start_date,
    p_date_of_birth,
    p_age_override,
    p_contacts,
    null,
    null,
    null,
    null,
    null,
    p_guardian_full_name,
    p_guardian_relationship,
    p_guardian_email,
    p_guardian_phone,
    p_internal_note
  );

  perform public.assign_student_to_class_mvp(
    v_student_id,
    p_school_id,
    p_status,
    p_start_date,
    p_existing_class_id,
    p_create_new_class,
    p_assigned_teacher_profile_id,
    p_lesson_type,
    p_class_level_id,
    p_lesson_day,
    p_lesson_time,
    p_billing_plan_id
  );

  perform public.update_student_class_assignment_billing_mvp(
    v_student_id,
    p_billing_plan_id,
    p_monthly_fee_yen
  );

  return v_student_id;
end;
$$;

revoke all on function public.create_student_with_class_assignment_mvp(
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
  integer,
  uuid,
  public.class_lesson_type,
  text,
  boolean,
  uuid,
  public.class_lesson_day,
  time,
  text,
  text,
  citext,
  text,
  text
) from public, anon;

grant execute on function public.create_student_with_class_assignment_mvp(
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
  integer,
  uuid,
  public.class_lesson_type,
  text,
  boolean,
  uuid,
  public.class_lesson_day,
  time,
  text,
  text,
  citext,
  text,
  text
) to authenticated;

create or replace function public.update_student_with_class_assignment_mvp(
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
  p_billing_plan_id uuid default null,
  p_monthly_fee_yen integer default null,
  p_assigned_teacher_profile_id uuid default null,
  p_lesson_type public.class_lesson_type default null,
  p_class_level_id text default null,
  p_create_new_class boolean default false,
  p_existing_class_id uuid default null,
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
  v_student_id uuid;
begin
  v_student_id = public.update_student_mvp(
    p_student_id,
    p_school_id,
    p_first_name,
    p_last_name,
    p_preferred_name,
    p_status,
    p_start_date,
    p_date_of_birth,
    p_age_override,
    p_contacts,
    null,
    null,
    null,
    null,
    null,
    p_guardians,
    p_notes
  );

  perform public.assign_student_to_class_mvp(
    p_student_id,
    p_school_id,
    p_status,
    p_start_date,
    p_existing_class_id,
    p_create_new_class,
    p_assigned_teacher_profile_id,
    p_lesson_type,
    p_class_level_id,
    p_lesson_day,
    p_lesson_time,
    p_billing_plan_id
  );

  perform public.update_student_class_assignment_billing_mvp(
    p_student_id,
    p_billing_plan_id,
    p_monthly_fee_yen
  );

  return v_student_id;
end;
$$;

revoke all on function public.update_student_with_class_assignment_mvp(
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
  integer,
  uuid,
  public.class_lesson_type,
  text,
  boolean,
  uuid,
  public.class_lesson_day,
  time,
  jsonb,
  jsonb
) from public, anon;

grant execute on function public.update_student_with_class_assignment_mvp(
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
  integer,
  uuid,
  public.class_lesson_type,
  text,
  boolean,
  uuid,
  public.class_lesson_day,
  time,
  jsonb,
  jsonb
) to authenticated;

notify pgrst, 'reload schema';
