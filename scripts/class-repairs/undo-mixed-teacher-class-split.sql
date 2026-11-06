-- Undo one split-mixed-teacher-class.sql run: move the audited enrollments back
-- into the original class, clear its class teacher, and delete the class the
-- split created. Takes the same psql variables as the repair script.
-- Defaults to rollback; pass -v finish=commit to apply. Aborts if the new class
-- holds any enrollment other than the audited ones (decide those by hand).
-- Only student_enrollments.class_id changes on the moved rows.
\set ON_ERROR_STOP 1
\if :{?finish}
\else
  \set finish rollback
\endif

begin;

select c.school_id, c.lesson_day, c.lesson_time from public.classes c where c.id = :'target_class'
\gset slot_

select coalesce((select id from public.classes
  where school_id = :'slot_school_id' and lesson_day = :'slot_lesson_day' and lesson_time = :'slot_lesson_time'
    and assigned_teacher_staff_id = :'move_teacher' limit 1), '00000000-0000-0000-0000-000000000000') as new_class_id
\gset

create temp table undo_before on commit drop as
select se.id, se.student_id, se.class_id, se.assigned_teacher_staff_id, se.assigned_teacher_profile_id,
  se.status, se.level, se.start_date, se.end_date
from public.student_enrollments se
where se.class_id in (:'target_class', :'new_class_id');

select
  coalesce((select assigned_teacher_staff_id = :'stay_teacher' from public.classes where id = :'target_class'), false)
    as target_labelled_stay,
  :'new_class_id' <> '00000000-0000-0000-0000-000000000000' as new_class_found,
  coalesce((select array_agg(id order by id) from public.student_enrollments where class_id = :'new_class_id')
    = (select array_agg(id order by id) from unnest(array[:move_enrollments]::uuid[]) id), false)
    as new_class_holds_only_audited
\gset pre_

\if :pre_target_labelled_stay
\else
  \echo ABORT: original class is not labelled with the staying teacher
  rollback;
  \quit
\endif
\if :pre_new_class_found
\else
  \echo ABORT: no class for the moving teacher at this slot
  rollback;
  \quit
\endif
\if :pre_new_class_holds_only_audited
\else
  \echo ABORT: the new class holds enrollments other than the audited ones
  select id, student_id, status from public.student_enrollments where class_id = :'new_class_id';
  rollback;
  \quit
\endif

-- The original class takes both teachers again, so it must be unlabelled first.
update public.classes set assigned_teacher_staff_id = null where id = :'target_class';
update public.student_enrollments set class_id = :'target_class'
where class_id = :'new_class_id' and id in (:move_enrollments);
delete from public.classes where id = :'new_class_id';

\echo == invariants (all must be t)
select
  (select count(*) from public.student_enrollments se join undo_before ub using (id)
     where (se.student_id, se.assigned_teacher_staff_id, se.assigned_teacher_profile_id, se.status, se.level, se.start_date, se.end_date)
       is distinct from (ub.student_id, ub.assigned_teacher_staff_id, ub.assigned_teacher_profile_id, ub.status, ub.level, ub.start_date, ub.end_date)) = 0
    as enrollment_fields_unchanged,
  (select count(*) from public.student_enrollments where class_id = :'target_class') = (select count(*) from undo_before)
    as all_back_in_original_class,
  not exists (select 1 from public.classes where id = :'new_class_id') as new_class_removed;

:finish;
\echo finished with :finish
