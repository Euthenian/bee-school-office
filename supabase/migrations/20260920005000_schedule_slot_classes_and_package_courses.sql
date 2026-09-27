alter table public.billing_plans
  add column if not exists class_level_id text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'billing_plans_class_level_id_fkey'
  ) then
    alter table public.billing_plans
      add constraint billing_plans_class_level_id_fkey
      foreign key (class_level_id)
      references public.class_levels (id)
      on delete restrict;
  end if;
end;
$$;

comment on column public.billing_plans.class_level_id is
'Optional course/category for this Lesson Package, reusing the existing class_levels catalog. This belongs to the package, not the schedule slot.';

alter table public.classes
  alter column lesson_type drop not null,
  alter column level_id drop not null;

comment on column public.classes.lesson_type is
'Deprecated for new records. Classes are schedule slots; Lesson Package carries lesson type.';

comment on column public.classes.level_id is
'Deprecated for new records. Classes are schedule slots; Lesson Package carries course/category.';

comment on column public.classes.assigned_teacher_profile_id is
'Deprecated for new records. Student enrollment stores the assigned teacher so students sharing a schedule slot may have different teachers.';

create unique index if not exists classes_school_day_time_uidx
on public.classes (school_id, lesson_day, lesson_time);

alter table public.student_enrollments
  add column if not exists assigned_teacher_profile_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'student_enrollments_assigned_teacher_profile_id_fkey'
  ) then
    alter table public.student_enrollments
      add constraint student_enrollments_assigned_teacher_profile_id_fkey
      foreign key (assigned_teacher_profile_id)
      references public.profiles (id)
      on delete restrict;
  end if;
end;
$$;

create index if not exists student_enrollments_assigned_teacher_idx
on public.student_enrollments (assigned_teacher_profile_id)
where assigned_teacher_profile_id is not null;

comment on column public.student_enrollments.assigned_teacher_profile_id is
'Teacher assigned to this student enrollment. Uses the existing eligible-teacher staff/profile model.';

create or replace function public.ensure_student_enrollment_teacher_assignment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.assigned_teacher_profile_id is not null
    and not public.has_active_staff_teacher_assignment(new.school_id, new.assigned_teacher_profile_id)
  then
    raise exception 'Assigned teacher is not active for this school.';
  end if;

  return new;
end;
$$;

drop trigger if exists student_enrollments_teacher_assignment_check on public.student_enrollments;
create trigger student_enrollments_teacher_assignment_check
before insert or update of school_id, assigned_teacher_profile_id on public.student_enrollments
for each row execute function public.ensure_student_enrollment_teacher_assignment();

drop function if exists public.get_student_billing_plan_options_mvp(uuid);
create or replace function public.get_student_billing_plan_options_mvp(p_student_id uuid)
returns table (
  id uuid,
  organization_id uuid,
  school_id uuid,
  name text,
  lesson_type public.class_lesson_type,
  lesson_duration_minutes integer,
  lessons_per_month integer,
  class_level_id text,
  monthly_fee_yen integer,
  active boolean,
  sort_order integer,
  is_current boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_current_billing_plan_id uuid;
  v_student public.students%rowtype;
begin
  select * into v_student
  from public.students st
  where st.id = p_student_id;

  if not found then
    raise exception 'Student finance details are not available.';
  end if;

  if not public.can_manage_student_finance_org(v_student.organization_id, v_student.school_id) then
    raise exception 'You do not have permission to view student finance details.';
  end if;

  select sbp.billing_plan_id into v_current_billing_plan_id
  from public.student_billing_profiles sbp
  where sbp.student_id = p_student_id
    and sbp.organization_id = v_student.organization_id
    and sbp.school_id = v_student.school_id
  order by sbp.updated_at desc, sbp.created_at desc
  limit 1;

  return query
  select
    bp.id,
    bp.organization_id,
    bp.school_id,
    bp.name,
    bp.lesson_type,
    bp.lesson_duration_minutes,
    bp.lessons_per_month,
    bp.class_level_id,
    bp.monthly_fee_yen,
    bp.active,
    bp.sort_order,
    bp.id = v_current_billing_plan_id,
    bp.created_at,
    bp.updated_at
  from public.billing_plans bp
  where bp.organization_id = v_student.organization_id
    and (
      (
        bp.active = true
        and (bp.school_id is null or bp.school_id = v_student.school_id)
      )
      or bp.id = v_current_billing_plan_id
    )
  order by bp.sort_order, bp.name;
end;
$$;

revoke all on function public.get_student_billing_plan_options_mvp(uuid) from public, anon;
grant execute on function public.get_student_billing_plan_options_mvp(uuid) to authenticated;

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

  if p_lesson_day is null or p_lesson_time is null then
    raise exception 'Class day and time are required.';
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
    null,
    null,
    null,
    p_lesson_day,
    p_lesson_time,
    p_status
  )
  on conflict (school_id, lesson_day, lesson_time)
  do update set status = excluded.status
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
  v_conflicting_class_id uuid;
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

  if p_lesson_day is null or p_lesson_time is null then
    raise exception 'Class day and time are required.';
  end if;

  select c.id into v_conflicting_class_id
  from public.classes c
  where c.school_id = p_school_id
    and c.lesson_day = p_lesson_day
    and c.lesson_time = p_lesson_time
    and c.id <> p_class_id
  limit 1;

  if v_conflicting_class_id is not null then
    raise exception 'A class already exists for this school, day, and time.';
  end if;

  update public.classes
  set school_id = p_school_id,
      lesson_day = p_lesson_day,
      lesson_time = p_lesson_time,
      status = p_status
  where id = p_class_id;

  return p_class_id;
end;
$$;

revoke all on function public.update_class_mvp(uuid, uuid, public.class_lesson_type, text, public.class_lesson_day, time, uuid, text) from public, anon;
grant execute on function public.update_class_mvp(uuid, uuid, public.class_lesson_type, text, public.class_lesson_day, time, uuid, text) to authenticated;

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

  if p_assigned_teacher_profile_id is not null
    and not public.has_active_staff_teacher_assignment(p_school_id, p_assigned_teacher_profile_id)
  then
    raise exception 'Assigned teacher is not active for this school.';
  end if;

  if p_billing_plan_id is not null then
    select cl.label into v_level_label
    from public.billing_plans bp
    left join public.class_levels cl on cl.id = bp.class_level_id
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
    v_class_id = public.create_class_mvp(
      p_school_id,
      null,
      null,
      p_lesson_day,
      p_lesson_time,
      null,
      'active'
    );
  end if;

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
      assigned_teacher_profile_id,
      status,
      level,
      start_date
    )
    values (
      v_organization_id,
      p_school_id,
      p_student_id,
      v_class_id,
      p_assigned_teacher_profile_id,
      v_enrollment_status,
      v_level_label,
      p_start_date
    );
  else
    update public.student_enrollments
    set organization_id = v_organization_id,
        school_id = p_school_id,
        class_id = v_class_id,
        assigned_teacher_profile_id = p_assigned_teacher_profile_id,
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

do $$
declare
  v_organization_id uuid;
  v_school_id uuid;
begin
  select s.id, s.organization_id
  into v_school_id, v_organization_id
  from public.schools s
  where lower(s.name) = 'ohashi'
  order by s.created_at
  limit 1;

  if v_school_id is null then
    raise notice 'Ohashi school was not found; schedule slot population skipped.';
    return;
  end if;

  with days(lesson_day) as (
    values
      ('monday'::public.class_lesson_day),
      ('tuesday'::public.class_lesson_day),
      ('wednesday'::public.class_lesson_day),
      ('thursday'::public.class_lesson_day),
      ('friday'::public.class_lesson_day),
      ('saturday'::public.class_lesson_day),
      ('sunday'::public.class_lesson_day)
  ),
  hours(lesson_time) as (
    values
      ('12:00'::time),
      ('13:00'::time),
      ('14:00'::time),
      ('15:00'::time),
      ('16:00'::time),
      ('17:00'::time),
      ('18:00'::time),
      ('19:00'::time),
      ('20:00'::time),
      ('21:00'::time)
  ),
  slots as (
    select d.lesson_day, h.lesson_time
    from days d
    cross join hours h
  )
  insert into public.classes (
    organization_id,
    school_id,
    lesson_day,
    lesson_time,
    status
  )
  select
    v_organization_id,
    v_school_id,
    slots.lesson_day,
    slots.lesson_time,
    'active'
  from slots
  on conflict (school_id, lesson_day, lesson_time)
  do update set status = 'active';
end;
$$;

notify pgrst, 'reload schema';
