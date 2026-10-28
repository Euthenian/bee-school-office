-- A class is identified by school, day, time, and class teacher, so two teachers can
-- run separate classes in the same slot. student_enrollments.assigned_teacher_staff_id
-- stays the authoritative teacher; this migration never rewrites enrollment rows.
-- Apply manually after 20261027001000_trial_package_student_conversion.sql.

alter table public.classes
  add column if not exists assigned_teacher_staff_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'classes_assigned_teacher_staff_id_organization_id_fkey'
      and conrelid = 'public.classes'::regclass
  ) then
    alter table public.classes
      add constraint classes_assigned_teacher_staff_id_organization_id_fkey
      foreign key (assigned_teacher_staff_id, organization_id)
      references public.staff (id, organization_id)
      on delete restrict;
  end if;
end $$;

comment on column public.classes.assigned_teacher_staff_id is
'Staff teacher who runs this class. Distinguishes simultaneous classes; enrolled students must match it. Null means the class has no class-level teacher yet.';

-- Label only classes whose current students all share one teacher. Mixed or partly
-- unassigned classes keep a null class teacher until staff split them.
update public.classes c
set assigned_teacher_staff_id = t.staff_id
from (
  select se.class_id, (array_agg(se.assigned_teacher_staff_id))[1] as staff_id
  from public.student_enrollments se
  where se.status in ('active', 'pending', 'paused')
  group by se.class_id
  having count(*) = count(se.assigned_teacher_staff_id)
    and count(distinct se.assigned_teacher_staff_id) = 1
) t
where c.id = t.class_id
  and c.assigned_teacher_staff_id is null;

-- One class per school/day/time/teacher; a null teacher counts as one value.
create unique index if not exists classes_school_day_time_teacher_uidx
on public.classes (school_id, lesson_day, lesson_time, assigned_teacher_staff_id) nulls not distinct;

drop index if exists public.classes_school_day_time_uidx;

drop function if exists public.create_class_mvp(uuid, public.class_lesson_type, text, public.class_lesson_day, time, uuid, text);

create or replace function public.create_class_mvp(
  p_school_id uuid,
  p_lesson_type public.class_lesson_type,
  p_class_level_id text,
  p_lesson_day public.class_lesson_day,
  p_lesson_time time,
  p_assigned_teacher_profile_id uuid default null,
  p_status text default 'active',
  p_assigned_teacher_staff_id uuid default null
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

  if p_assigned_teacher_staff_id is not null
    and not public.has_active_staff_teacher_staff_assignment(p_school_id, p_assigned_teacher_staff_id) then
    raise exception 'Class teacher must be active teaching staff assigned to this school.';
  end if;

  -- The same school, day, time, and teacher reuses the existing class.
  insert into public.classes (
    organization_id,
    school_id,
    assigned_teacher_staff_id,
    lesson_day,
    lesson_time,
    status
  )
  values (
    v_organization_id,
    p_school_id,
    p_assigned_teacher_staff_id,
    p_lesson_day,
    p_lesson_time,
    p_status
  )
  on conflict (school_id, lesson_day, lesson_time, assigned_teacher_staff_id)
  do update set status = excluded.status
  returning id into v_class_id;

  return v_class_id;
end;
$$;

revoke all on function public.create_class_mvp(uuid, public.class_lesson_type, text, public.class_lesson_day, time, uuid, text, uuid) from public, anon;
grant execute on function public.create_class_mvp(uuid, public.class_lesson_type, text, public.class_lesson_day, time, uuid, text, uuid) to authenticated;

drop function if exists public.update_class_mvp(uuid, uuid, public.class_lesson_type, text, public.class_lesson_day, time, uuid, text);

create or replace function public.update_class_mvp(
  p_class_id uuid,
  p_school_id uuid,
  p_lesson_type public.class_lesson_type,
  p_class_level_id text,
  p_lesson_day public.class_lesson_day,
  p_lesson_time time,
  p_assigned_teacher_profile_id uuid default null,
  p_status text default 'active',
  p_assigned_teacher_staff_id uuid default null
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

  -- Keeping a teacher who has since left the school must not block other edits.
  if p_assigned_teacher_staff_id is not null
    and (p_assigned_teacher_staff_id is distinct from v_class.assigned_teacher_staff_id
      or p_school_id <> v_class.school_id)
    and not public.has_active_staff_teacher_staff_assignment(p_school_id, p_assigned_teacher_staff_id) then
    raise exception 'Class teacher must be active teaching staff assigned to this school.';
  end if;

  if p_assigned_teacher_staff_id is not null and exists (
    select 1
    from public.student_enrollments se
    where se.class_id = p_class_id
      and se.status in ('active', 'pending', 'paused')
      and se.assigned_teacher_staff_id is not null
      and se.assigned_teacher_staff_id <> p_assigned_teacher_staff_id
  ) then
    raise exception 'Students in this class are assigned to a different teacher. Move them to the matching class first.';
  end if;

  select c.id into v_conflicting_class_id
  from public.classes c
  where c.school_id = p_school_id
    and c.lesson_day = p_lesson_day
    and c.lesson_time = p_lesson_time
    and c.assigned_teacher_staff_id is not distinct from p_assigned_teacher_staff_id
    and c.id <> p_class_id
  limit 1;

  if v_conflicting_class_id is not null then
    raise exception 'A class already exists for this school, day, time, and teacher.';
  end if;

  update public.classes
  set school_id = p_school_id,
      lesson_day = p_lesson_day,
      lesson_time = p_lesson_time,
      assigned_teacher_staff_id = p_assigned_teacher_staff_id,
      status = p_status
  where id = p_class_id;

  return p_class_id;
end;
$$;

revoke all on function public.update_class_mvp(uuid, uuid, public.class_lesson_type, text, public.class_lesson_day, time, uuid, text, uuid) from public, anon;
grant execute on function public.update_class_mvp(uuid, uuid, public.class_lesson_type, text, public.class_lesson_day, time, uuid, text, uuid) to authenticated;

-- Runs before student_enrollments_teacher_staff_assignment_check (triggers fire in
-- name order). It only fills a missing teacher, never replaces one.
create or replace function public.ensure_student_enrollment_matches_class_teacher()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_class_teacher_staff_id uuid;
begin
  if new.class_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and new.class_id is not distinct from old.class_id
    and new.assigned_teacher_staff_id is not distinct from old.assigned_teacher_staff_id then
    return new;
  end if;

  select c.assigned_teacher_staff_id into v_class_teacher_staff_id
  from public.classes c
  where c.id = new.class_id;

  if v_class_teacher_staff_id is null then
    return new;
  end if;

  if new.assigned_teacher_staff_id is null then
    if public.has_active_staff_teacher_staff_assignment(new.school_id, v_class_teacher_staff_id) then
      new.assigned_teacher_staff_id = v_class_teacher_staff_id;
      select st.profile_id into new.assigned_teacher_profile_id
      from public.staff st
      where st.id = v_class_teacher_staff_id
        and st.organization_id = new.organization_id;
    end if;
  elsif new.assigned_teacher_staff_id <> v_class_teacher_staff_id then
    raise exception 'This class is taught by a different teacher. Choose the class for the student''s assigned teacher.';
  end if;

  return new;
end;
$$;

revoke all on function public.ensure_student_enrollment_matches_class_teacher() from public, anon;

drop trigger if exists student_enrollments_class_teacher_check on public.student_enrollments;
create trigger student_enrollments_class_teacher_check
before insert or update of class_id, assigned_teacher_staff_id on public.student_enrollments
for each row execute function public.ensure_student_enrollment_matches_class_teacher();

notify pgrst, 'reload schema';
