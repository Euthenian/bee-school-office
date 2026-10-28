-- Read-only preflight for split-mixed-teacher-class.sql. Safe before or after
-- migration 20261028001000_teacher_specific_classes.sql: it never writes.
-- Takes the same psql variables as the repair script and reports the proposed
-- class structure plus whether every precondition still holds.
\set ON_ERROR_STOP 1

begin read only;

select exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'classes' and column_name = 'assigned_teacher_staff_id'
) as migrated
\gset

\echo == current members of the class
select se.id enrollment_id, st.last_name || ' ' || st.first_name student, se.status,
  coalesce(sf.display_name, sf.legal_name) enrollment_teacher, se.assigned_teacher_staff_id,
  bp.name plan, sbp.monthly_fee_yen fee,
  case when se.assigned_teacher_staff_id = :'move_teacher' then 'MOVE to new class'
       when se.assigned_teacher_staff_id = :'stay_teacher' then 'stay in ' || :'target_class'
       else 'UNEXPECTED' end proposal
from public.student_enrollments se
join public.students st on st.id = se.student_id
left join public.staff sf on sf.id = se.assigned_teacher_staff_id
left join public.student_billing_profiles sbp on sbp.student_id = se.student_id
left join public.billing_plans bp on bp.id = sbp.billing_plan_id
where se.class_id = :'target_class'
order by proposal, student;

\echo == proposed class structure
select c.lesson_day, c.lesson_time, t.role, coalesce(sf.display_name, sf.legal_name) class_teacher, t.class_id,
  (select count(*) from public.student_enrollments se where se.class_id = :'target_class'
     and se.status in ('active','pending','paused') and se.assigned_teacher_staff_id = t.staff_id) students
from public.classes c
cross join (values ('keeps original ID', :'stay_teacher'::uuid, :'target_class'),
                   ('new class', :'move_teacher'::uuid, '(created by repair)')) t(role, staff_id, class_id)
left join public.staff sf on sf.id = t.staff_id
where c.id = :'target_class';

\echo == preconditions (all must be t)
select
  (select count(*) = 1 from public.classes where id = :'target_class' and status = 'active') as target_active,
  (select count(*) from public.student_enrollments where class_id = :'target_class' and status in ('active','pending','paused')
     and assigned_teacher_staff_id = :'move_teacher') = :expected_move as move_count_ok,
  (select count(*) from public.student_enrollments where class_id = :'target_class' and status in ('active','pending','paused')
     and assigned_teacher_staff_id = :'stay_teacher') = :expected_stay as stay_count_ok,
  (select count(*) from public.student_enrollments where class_id = :'target_class' and status in ('active','pending','paused')
     and assigned_teacher_staff_id is distinct from :'move_teacher'
     and assigned_teacher_staff_id is distinct from :'stay_teacher') = 0 as no_other_teachers,
  (select array_agg(id order by id) from public.student_enrollments where class_id = :'target_class'
     and assigned_teacher_staff_id = :'move_teacher')
    = (select array_agg(id order by id) from unnest(array[:move_enrollments]::uuid[]) id) as move_ids_ok,
  public.has_active_staff_teacher_staff_assignment(
    (select school_id from public.classes where id = :'target_class'), :'move_teacher') as move_teacher_eligible,
  public.has_active_staff_teacher_staff_assignment(
    (select school_id from public.classes where id = :'target_class'), :'stay_teacher') as stay_teacher_eligible;

\if :migrated
\echo == post-migration checks (all must be t)
select
  (select assigned_teacher_staff_id is null from public.classes where id = :'target_class') as target_unlabelled,
  not exists (select 1 from public.classes c join public.classes t on t.id = :'target_class'
    where c.school_id = t.school_id and c.lesson_day = t.lesson_day and c.lesson_time = t.lesson_time
      and c.assigned_teacher_staff_id = :'stay_teacher') as no_existing_stay_teacher_class;
\else
\echo == migration not applied yet: run split-mixed-teacher-class.sql only after it is
\endif

-- Keyed on the audited students (current members plus moved enrollments), and
-- excluding class_id, so the value must be identical before and after the repair.
\echo == fingerprint of enrollments and billing (compare before and after the repair)
select md5(string_agg(row_text, '|' order by row_text)) fingerprint, count(*) rows_hashed
from (
  select format('e:%s:%s:%s:%s:%s:%s:%s:%s', se.id, se.student_id, se.assigned_teacher_staff_id,
    se.assigned_teacher_profile_id, se.status, se.level, se.start_date, se.end_date) row_text
  from public.student_enrollments se where se.student_id in (
    select student_id from public.student_enrollments
    where class_id = :'target_class' or id in (:move_enrollments))
  union all
  select format('b:%s:%s:%s:%s:%s:%s', sbp.id, sbp.student_id, sbp.billing_plan_id, sbp.monthly_fee_yen,
    sbp.billing_start_date, sbp.billing_end_date)
  from public.student_billing_profiles sbp where sbp.student_id in (
    select student_id from public.student_enrollments
    where class_id = :'target_class' or id in (:move_enrollments))
) rows;

rollback;
