alter table public.student_enrollments
  add column if not exists assigned_teacher_staff_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'student_enrollments_assigned_teacher_staff_id_organization_id_fkey'
      and conrelid = 'public.student_enrollments'::regclass
  ) then
    alter table public.student_enrollments
      add constraint student_enrollments_assigned_teacher_staff_id_organization_id_fkey
      foreign key (assigned_teacher_staff_id, organization_id)
      references public.staff (id, organization_id)
      on delete restrict;
  end if;
end $$;

create index if not exists student_enrollments_assigned_teacher_staff_idx
on public.student_enrollments (assigned_teacher_staff_id)
where assigned_teacher_staff_id is not null;

comment on column public.student_enrollments.assigned_teacher_staff_id is
'Staff identity assigned as the student teacher. This is the authoritative teacher assignment and does not require a linked login/profile account.';

update public.student_enrollments se
set assigned_teacher_staff_id = st.id
from public.staff st
join public.staff_school_assignments ssa
  on ssa.staff_id = st.id
  and ssa.organization_id = st.organization_id
where se.assigned_teacher_staff_id is null
  and se.assigned_teacher_profile_id is not null
  and st.profile_id = se.assigned_teacher_profile_id
  and st.organization_id = se.organization_id
  and ssa.school_id = se.school_id
  and ssa.can_teach = true
  and ssa.status = 'active';

create or replace function public.has_active_staff_teacher_staff_assignment(
  p_school_id uuid,
  p_staff_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_school_assignments ssa
    join public.staff st
      on st.id = ssa.staff_id
      and st.organization_id = ssa.organization_id
    join public.schools s
      on s.id = ssa.school_id
      and s.organization_id = ssa.organization_id
    where ssa.school_id = p_school_id
      and ssa.staff_id = p_staff_id
      and s.status = 'active'
      and st.status = 'active'
      and ssa.status = 'active'
      and ssa.can_teach = true
      and (ssa.start_date is null or ssa.start_date <= current_date)
      and (ssa.end_date is null or ssa.end_date >= current_date)
  );
$$;

revoke all on function public.has_active_staff_teacher_staff_assignment(uuid, uuid) from public, anon;
grant execute on function public.has_active_staff_teacher_staff_assignment(uuid, uuid) to authenticated;

create or replace function public.ensure_student_enrollment_teacher_staff_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
begin
  if new.assigned_teacher_staff_id is null then
    return new;
  end if;

  if not public.has_active_staff_teacher_staff_assignment(new.school_id, new.assigned_teacher_staff_id) then
    raise exception 'Assigned teacher must be active teaching staff assigned to this school.';
  end if;

  select st.profile_id into v_profile_id
  from public.staff st
  where st.id = new.assigned_teacher_staff_id
    and st.organization_id = new.organization_id;

  if v_profile_id is not null then
    new.assigned_teacher_profile_id = v_profile_id;
  else
    new.assigned_teacher_profile_id = null;
  end if;

  return new;
end;
$$;

revoke all on function public.ensure_student_enrollment_teacher_staff_assignment() from public, anon, authenticated;
grant execute on function public.ensure_student_enrollment_teacher_staff_assignment() to authenticated;

drop trigger if exists student_enrollments_teacher_staff_assignment_check on public.student_enrollments;
create trigger student_enrollments_teacher_staff_assignment_check
before insert or update of school_id, organization_id, assigned_teacher_staff_id on public.student_enrollments
for each row execute function public.ensure_student_enrollment_teacher_staff_assignment();

drop function if exists public.school_teacher_options(uuid);

create or replace function public.school_teacher_options(p_school_id uuid)
returns table (
  staff_id uuid,
  profile_id uuid,
  full_name text,
  email citext,
  school_id uuid,
  staff_status text,
  assignment_status text,
  can_teach boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select teacher_options.staff_id,
         teacher_options.profile_id,
         teacher_options.full_name,
         teacher_options.email,
         teacher_options.school_id,
         teacher_options.staff_status,
         teacher_options.assignment_status,
         teacher_options.can_teach
  from (
    select distinct on (st.id)
           st.id as staff_id,
           st.profile_id,
           coalesce(nullif(trim(st.display_name), ''), nullif(trim(st.legal_name), ''), st.email::text, p.email::text) as full_name,
           coalesce(st.email, p.email) as email,
           ssa.school_id,
           st.status as staff_status,
           ssa.status as assignment_status,
           ssa.can_teach
    from public.staff_school_assignments ssa
    join public.staff st
      on st.id = ssa.staff_id
      and st.organization_id = ssa.organization_id
    join public.schools s on s.id = ssa.school_id
    left join public.profiles p on p.id = st.profile_id
    where ssa.school_id = p_school_id
      and public.can_manage_school(p_school_id)
      and s.status = 'active'
      and st.status = 'active'
      and ssa.status = 'active'
      and ssa.can_teach = true
      and (ssa.start_date is null or ssa.start_date <= current_date)
      and (ssa.end_date is null or ssa.end_date >= current_date)
    order by st.id, st.created_at
  ) teacher_options
  order by teacher_options.full_name nulls last, teacher_options.email nulls last;
$$;

revoke all on function public.school_teacher_options(uuid) from public, anon;
grant execute on function public.school_teacher_options(uuid) to authenticated;

drop function if exists public.assign_student_to_class_mvp(uuid, uuid, public.student_status, date, uuid, boolean, uuid, public.class_lesson_type, text, public.class_lesson_day, time, uuid);

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
  p_billing_plan_id uuid default null,
  p_assigned_teacher_staff_id uuid default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_assigned_teacher_profile_id uuid := p_assigned_teacher_profile_id;
  v_assigned_teacher_staff_id uuid := p_assigned_teacher_staff_id;
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

  if v_assigned_teacher_staff_id is not null then
    if not public.has_active_staff_teacher_staff_assignment(p_school_id, v_assigned_teacher_staff_id) then
      raise exception 'Assigned teacher is not active for this school.';
    end if;

    select st.profile_id into v_assigned_teacher_profile_id
    from public.staff st
    where st.id = v_assigned_teacher_staff_id
      and st.organization_id = v_organization_id;
  elsif p_assigned_teacher_profile_id is not null then
    if not public.has_active_staff_teacher_assignment(p_school_id, p_assigned_teacher_profile_id) then
      raise exception 'Assigned teacher is not active for this school.';
    end if;

    select st.id into v_assigned_teacher_staff_id
    from public.staff st
    join public.staff_school_assignments ssa
      on ssa.staff_id = st.id
      and ssa.organization_id = st.organization_id
    where st.profile_id = p_assigned_teacher_profile_id
      and st.organization_id = v_organization_id
      and ssa.school_id = p_school_id
      and ssa.status = 'active'
      and ssa.can_teach = true
    order by st.created_at
    limit 1;
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
      assigned_teacher_staff_id,
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
      v_assigned_teacher_staff_id,
      v_assigned_teacher_profile_id,
      v_enrollment_status,
      v_level_label,
      p_start_date
    );
  else
    update public.student_enrollments
    set organization_id = v_organization_id,
        school_id = p_school_id,
        class_id = v_class_id,
        assigned_teacher_staff_id = v_assigned_teacher_staff_id,
        assigned_teacher_profile_id = v_assigned_teacher_profile_id,
        status = v_enrollment_status,
        level = v_level_label,
        start_date = p_start_date,
        end_date = null
    where id = v_enrollment.id;
  end if;

  return v_class_id;
end;
$$;

revoke all on function public.assign_student_to_class_mvp(uuid, uuid, public.student_status, date, uuid, boolean, uuid, public.class_lesson_type, text, public.class_lesson_day, time, uuid, uuid) from public, anon;
grant execute on function public.assign_student_to_class_mvp(uuid, uuid, public.student_status, date, uuid, boolean, uuid, public.class_lesson_type, text, public.class_lesson_day, time, uuid, uuid) to authenticated;

drop function if exists public.create_student_with_class_assignment_mvp(uuid, text, text, text, public.student_status, date, date, smallint, jsonb, uuid, integer, uuid, public.class_lesson_type, text, boolean, uuid, public.class_lesson_day, time, text, text, citext, text, text);

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
  p_internal_note text default null,
  p_assigned_teacher_staff_id uuid default null
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
    p_billing_plan_id,
    p_assigned_teacher_staff_id
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
  text,
  uuid
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
  text,
  uuid
) to authenticated;

drop function if exists public.update_student_with_class_assignment_mvp(uuid, uuid, text, text, text, public.student_status, date, date, smallint, jsonb, uuid, integer, uuid, public.class_lesson_type, text, boolean, uuid, public.class_lesson_day, time, jsonb, jsonb);

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
  p_notes jsonb default '[]'::jsonb,
  p_assigned_teacher_staff_id uuid default null
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
    p_billing_plan_id,
    p_assigned_teacher_staff_id
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
  jsonb,
  uuid
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
  jsonb,
  uuid
) to authenticated;

notify pgrst, 'reload schema';
