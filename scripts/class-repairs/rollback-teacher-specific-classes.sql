-- Roll back 20261028001000_teacher_specific_classes.sql.
-- Run only after every class split has been undone (undo-mixed-teacher-class-split.sql)
-- and while the pre-release front-end is live again: the old one-class-per-slot index
-- cannot be recreated while any school/day/time has two classes. Aborts otherwise.
-- Enrollment rows are not touched. Function bodies below are the exact production
-- definitions captured before the release.
\set ON_ERROR_STOP 1

begin;

select not exists (
  select 1 from public.classes group by school_id, lesson_day, lesson_time having count(*) > 1
) as single_class_per_slot
\gset
\if :single_class_per_slot
\else
  \echo ABORT: some school/day/time has more than one class; undo the class splits first
  select school_id, lesson_day, lesson_time, count(*) from public.classes
  group by 1, 2, 3 having count(*) > 1;
  rollback;
  \quit
\endif

drop trigger if exists student_enrollments_class_teacher_check on public.student_enrollments;
drop function if exists public.ensure_student_enrollment_matches_class_teacher();

drop function if exists public.create_class_mvp(uuid, public.class_lesson_type, text, public.class_lesson_day, time, uuid, text, uuid);
drop function if exists public.update_class_mvp(uuid, uuid, public.class_lesson_type, text, public.class_lesson_day, time, uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.create_class_mvp(p_school_id uuid, p_lesson_type class_lesson_type, p_class_level_id text, p_lesson_day class_lesson_day, p_lesson_time time without time zone, p_assigned_teacher_profile_id uuid DEFAULT NULL::uuid, p_status text DEFAULT 'active'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
$function$;

revoke all on function public.create_class_mvp(uuid, public.class_lesson_type, text, public.class_lesson_day, time, uuid, text) from public, anon, service_role;
grant execute on function public.create_class_mvp(uuid, public.class_lesson_type, text, public.class_lesson_day, time, uuid, text) to authenticated;

CREATE OR REPLACE FUNCTION public.update_class_mvp(p_class_id uuid, p_school_id uuid, p_lesson_type class_lesson_type, p_class_level_id text, p_lesson_day class_lesson_day, p_lesson_time time without time zone, p_assigned_teacher_profile_id uuid DEFAULT NULL::uuid, p_status text DEFAULT 'active'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
$function$;

revoke all on function public.update_class_mvp(uuid, uuid, public.class_lesson_type, text, public.class_lesson_day, time, uuid, text) from public, anon, service_role;
grant execute on function public.update_class_mvp(uuid, uuid, public.class_lesson_type, text, public.class_lesson_day, time, uuid, text) to authenticated;

create unique index if not exists classes_school_day_time_uidx
on public.classes (school_id, lesson_day, lesson_time);
drop index if exists public.classes_school_day_time_teacher_uidx;

alter table public.classes drop constraint if exists classes_assigned_teacher_staff_id_organization_id_fkey;
alter table public.classes drop column if exists assigned_teacher_staff_id;

notify pgrst, 'reload schema';

commit;
\echo rollback of 20261028001000 committed
