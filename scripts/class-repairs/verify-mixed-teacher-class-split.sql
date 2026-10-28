-- Read-only postcondition check after split-mixed-teacher-class.sql has committed.
-- Validates the new class topology directly instead of the pre-repair state.
-- Takes the same psql variables as the repair script; optionally pass
-- expected_fingerprint (from the preflight) to also confirm enrollment and
-- billing fields are unchanged.
\set ON_ERROR_STOP 1

begin read only;

select c.school_id, c.lesson_day, c.lesson_time from public.classes c where c.id = :'target_class'
\gset slot_

-- The nil UUID stands in when no class exists yet, so the checks below report f.
select coalesce((select id from public.classes
  where school_id = :'slot_school_id' and lesson_day = :'slot_lesson_day' and lesson_time = :'slot_lesson_time'
    and assigned_teacher_staff_id = :'move_teacher' limit 1), '00000000-0000-0000-0000-000000000000') as new_class_id
\gset

\echo == classes at this slot
select c.id, coalesce(sf.display_name, sf.legal_name, '(no class teacher)') class_teacher, c.status,
  count(se.id) filter (where se.status in ('active','pending','paused')) current_students
from public.classes c
left join public.staff sf on sf.id = c.assigned_teacher_staff_id
left join public.student_enrollments se on se.class_id = c.id
where c.school_id = :'slot_school_id' and c.lesson_day = :'slot_lesson_day' and c.lesson_time = :'slot_lesson_time'
group by c.id, sf.display_name, sf.legal_name, c.status
order by class_teacher;

\echo == postconditions (all must be t)
select
  coalesce((select assigned_teacher_staff_id = :'stay_teacher' and status = 'active' from public.classes where id = :'target_class'), false)
    as original_class_kept_by_stay_teacher,
  (select count(*) = 1 from public.classes where school_id = :'slot_school_id' and lesson_day = :'slot_lesson_day'
     and lesson_time = :'slot_lesson_time' and assigned_teacher_staff_id = :'move_teacher' and status = 'active')
    as one_active_class_for_move_teacher,
  (select count(*) from public.student_enrollments where class_id = :'target_class'
     and status in ('active','pending','paused')) = :expected_stay as stay_count_ok,
  (select count(*) from public.student_enrollments where class_id = :'target_class'
     and status in ('active','pending','paused') and assigned_teacher_staff_id is distinct from :'stay_teacher') = 0
    as original_class_only_stay_teacher,
  coalesce((select array_agg(id order by id) from public.student_enrollments where class_id = :'new_class_id'
     and status in ('active','pending','paused'))
    = (select array_agg(id order by id) from unnest(array[:move_enrollments]::uuid[]) id), false) as new_class_has_exactly_moved_enrollments,
  coalesce((select bool_and(assigned_teacher_staff_id = :'move_teacher') from public.student_enrollments where id in (:move_enrollments)), false)
    as moved_enrollments_keep_teacher,
  not exists (select 1 from public.classes c join public.student_enrollments se on se.class_id = c.id
    where c.school_id = :'slot_school_id' and c.lesson_day = :'slot_lesson_day' and c.lesson_time = :'slot_lesson_time'
      and se.status in ('active','pending','paused')
      and (c.assigned_teacher_staff_id is null or se.assigned_teacher_staff_id is distinct from c.assigned_teacher_staff_id))
    as slot_has_no_mixed_or_unlabelled_class;

\if :{?expected_fingerprint}
\echo == optional: enrollment and billing fields match the preflight fingerprint
select md5(string_agg(row_text, '|' order by row_text)) = :'expected_fingerprint' as fingerprint_matches_preflight
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
\endif

rollback;
