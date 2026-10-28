-- Split one mixed-teacher class into one class per enrollment teacher.
-- Requires migration 20261028001000_teacher_specific_classes.sql to be applied first.
--
-- Variables (psql -v):
--   target_class     class to split; keeps its ID and the staying teacher's students
--   stay_teacher     staff ID whose students remain in target_class
--   move_teacher     staff ID whose students move to a new class at the same slot
--   move_enrollments comma-separated, single-quoted enrollment IDs expected to move
--   expected_move    number of enrollments that must move
--   expected_stay    number of enrollments that must stay
--   finish           rollback (default, dry run) or commit
--
-- Only student_enrollments.class_id changes; teachers, plans, prices, statuses,
-- dates and billing rows are untouched. Any unexpected state aborts the run.
\set ON_ERROR_STOP 1
\if :{?finish}
\else
  \set finish rollback
\endif

begin;

create temp table repair_before on commit drop as
select se.id, se.student_id, se.class_id, se.assigned_teacher_staff_id, se.assigned_teacher_profile_id,
  se.status, se.level, se.start_date, se.end_date
from public.student_enrollments se
where se.class_id = :'target_class';

create temp table billing_before on commit drop as
select sbp.* from public.student_billing_profiles sbp
where sbp.student_id in (select student_id from repair_before);

\echo == before
select rb.id enrollment_id, rb.student_id, rb.status, rb.assigned_teacher_staff_id,
  coalesce(st.display_name, st.legal_name) teacher
from repair_before rb left join public.staff st on st.id = rb.assigned_teacher_staff_id
order by teacher, rb.id;

-- Preconditions: the class still has exactly the audited membership.
select
  (select count(*) from public.classes where id = :'target_class' and assigned_teacher_staff_id is null) = 1 as target_unlabelled,
  (select count(*) from repair_before where status in ('active','pending','paused')
     and assigned_teacher_staff_id = :'move_teacher') = :expected_move as move_count_ok,
  (select count(*) from repair_before where status in ('active','pending','paused')
     and assigned_teacher_staff_id = :'stay_teacher') = :expected_stay as stay_count_ok,
  (select count(*) from repair_before where status in ('active','pending','paused')
     and assigned_teacher_staff_id is distinct from :'move_teacher'
     and assigned_teacher_staff_id is distinct from :'stay_teacher') = 0 as no_other_teachers,
  (select array_agg(id order by id) from repair_before where assigned_teacher_staff_id = :'move_teacher')
    = (select array_agg(id order by id) from unnest(array[:move_enrollments]::uuid[]) id) as move_ids_ok
\gset pre_

\if :pre_target_unlabelled
\else
  \echo ABORT: target class missing or already has a class teacher
  rollback;
  \quit
\endif
\if :pre_move_count_ok
\else
  \echo ABORT: moving-teacher enrollment count differs from the audit
  rollback;
  \quit
\endif
\if :pre_stay_count_ok
\else
  \echo ABORT: staying-teacher enrollment count differs from the audit
  rollback;
  \quit
\endif
\if :pre_no_other_teachers
\else
  \echo ABORT: class contains an enrollment for an unexpected teacher or none
  rollback;
  \quit
\endif
\if :pre_move_ids_ok
\else
  \echo ABORT: enrollment IDs to move differ from the audit
  rollback;
  \quit
\endif

-- 1. Reuse or create the moving teacher's class at the same school/day/time.
insert into public.classes (organization_id, school_id, lesson_day, lesson_time, status, assigned_teacher_staff_id)
select c.organization_id, c.school_id, c.lesson_day, c.lesson_time, 'active', :'move_teacher'
from public.classes c where c.id = :'target_class'
on conflict (school_id, lesson_day, lesson_time, assigned_teacher_staff_id) do update set status = 'active'
returning id as new_class_id
\gset

-- 2. Move only the audited enrollments.
update public.student_enrollments
set class_id = :'new_class_id'
where class_id = :'target_class'
  and id in (:move_enrollments)
  and assigned_teacher_staff_id = :'move_teacher';

-- 3. Label the original class with the staying teacher.
update public.classes set assigned_teacher_staff_id = :'stay_teacher' where id = :'target_class';

\echo == after
select c.id class_id, c.lesson_day, c.lesson_time, coalesce(ct.display_name, ct.legal_name) class_teacher,
  se.id enrollment_id, coalesce(et.display_name, et.legal_name) enrollment_teacher
from public.classes c
join public.student_enrollments se on se.class_id = c.id
left join public.staff ct on ct.id = c.assigned_teacher_staff_id
left join public.staff et on et.id = se.assigned_teacher_staff_id
where c.id in (:'target_class', :'new_class_id')
order by c.id, se.id;

\echo == invariants (all must be t)
select
  (select count(*) from public.student_enrollments se join repair_before rb using (id)
     where (se.student_id, se.assigned_teacher_staff_id, se.assigned_teacher_profile_id, se.status, se.level, se.start_date, se.end_date)
       is distinct from (rb.student_id, rb.assigned_teacher_staff_id, rb.assigned_teacher_profile_id, rb.status, rb.level, rb.start_date, rb.end_date)) = 0
    as enrollment_fields_unchanged,
  (select count(*) from (select * from public.student_billing_profiles where student_id in (select student_id from repair_before)
     except select * from billing_before) d) = 0 as billing_unchanged,
  (select count(*) from public.student_enrollments where id in (select id from repair_before)) = (select count(*) from repair_before)
    as no_enrollments_lost,
  (select count(*) from public.classes c join public.student_enrollments se on se.class_id = c.id
     where c.id in (:'target_class', :'new_class_id') and se.status in ('active','pending','paused')
       and se.assigned_teacher_staff_id is distinct from c.assigned_teacher_staff_id) = 0 as class_teachers_consistent;

:finish;
\echo finished with :finish
