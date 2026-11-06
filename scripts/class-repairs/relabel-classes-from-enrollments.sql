-- Re-apply the migration's class-teacher backfill. Idempotent and safe to repeat:
-- it only labels unlabelled classes whose current students all share one
-- teacher, and never edits enrollments. Needed if a pre-release front-end (an old
-- browser tab) saved a class during the cutover, which clears its label.
-- Defaults to rollback; pass -v finish=commit to apply.
\set ON_ERROR_STOP 1
\if :{?finish}
\else
  \set finish rollback
\endif

begin;

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
  and c.assigned_teacher_staff_id is null
returning c.id, c.lesson_day, c.lesson_time;

:finish;
\echo finished with :finish
