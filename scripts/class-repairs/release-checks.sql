-- Read-only release checks for 20261028001000_teacher_specific_classes.sql.
-- Run before the migration, after it, after the front-end upload, and after the
-- class repairs. Never writes.
\set ON_ERROR_STOP 1

begin read only;

select exists (select 1 from information_schema.columns where table_schema = 'public'
  and table_name = 'classes' and column_name = 'assigned_teacher_staff_id') as migrated
\gset

\echo == migration state
select :'migrated'::boolean as class_teacher_column,
  exists (select 1 from pg_indexes where indexname = 'classes_school_day_time_uidx') as old_slot_index,
  exists (select 1 from pg_indexes where indexname = 'classes_school_day_time_teacher_uidx') as teacher_slot_index,
  exists (select 1 from pg_trigger where tgname = 'student_enrollments_class_teacher_check') as class_teacher_trigger,
  (select string_agg(pronargs::text, ',' order by pronargs) from pg_proc where proname = 'create_class_mvp') as create_class_args,
  (select string_agg(pronargs::text, ',' order by pronargs) from pg_proc where proname = 'update_class_mvp') as update_class_args,
  coalesce((select pg_get_function_result(oid) ~ 'legacy_customer_id' from pg_proc
    where proname = 'get_unverified_rico_cancellations_mvp' limit 1), false) as rico_customer_id_migration,
  exists (select 1 from pg_proc where proname = 'remove_student_from_class_mvp') as remove_from_class_migration;

\echo == class schema fingerprint (pre-migration expected value is recorded in the release procedure)
select md5(string_agg(item, E'\n' order by item)) as class_surface_fingerprint, count(*) as objects
from (
  select 'fn ' || p.oid::regprocedure || '|' || md5(replace(pg_get_functiondef(p.oid), chr(13), '')) || '|' || coalesce(p.proacl::text, '') item
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('create_class_mvp', 'update_class_mvp', 'delete_class_mvp',
    'assign_student_to_class_mvp', 'add_existing_student_to_class_mvp', 'create_student_with_class_assignment_mvp',
    'update_student_with_class_assignment_mvp', 'ensure_student_enrollment_teacher_staff_assignment',
    'ensure_student_enrollment_teacher_assignment', 'ensure_class_teacher_membership',
    'has_active_staff_teacher_staff_assignment', 'guard_bee_schedule_against_coaching',
    'get_internal_coaching_availability_facts', 'prepare_class_template_email_mvp', 'school_teacher_options',
    'can_manage_school', 'ensure_student_enrollment_matches_class_teacher', 'remove_student_from_class_mvp')
  union all select 'trigger ' || tgrelid::regclass || '.' || tgname || '|' || md5(pg_get_triggerdef(oid)) from pg_trigger
    where not tgisinternal and tgrelid in ('public.classes'::regclass, 'public.student_enrollments'::regclass)
  union all select 'index ' || indexname || '|' || md5(indexdef) from pg_indexes where schemaname = 'public' and tablename = 'classes'
  union all select 'columns|' || md5(string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by ordinal_position))
    from information_schema.columns where table_schema = 'public' and table_name = 'classes'
  union all select 'constraint ' || conname || '|' || md5(pg_get_constraintdef(oid)) from pg_constraint where conrelid = 'public.classes'::regclass
  union all select 'policy ' || tablename || '.' || policyname || '|' || md5(coalesce(qual, '') || coalesce(with_check, ''))
    from pg_policies where tablename in ('classes', 'student_enrollments')
) surface;

\echo == enrollment and billing fingerprint (class_id excluded; must not change during the release)
select md5(string_agg(row_text, E'\n' order by row_text)) as enrollment_billing_fingerprint, count(*) as rows_hashed
from (
  select format('e:%s:%s:%s:%s:%s:%s:%s:%s', id, student_id, assigned_teacher_staff_id, assigned_teacher_profile_id,
    status, level, start_date, end_date) row_text from public.student_enrollments
  union all
  select format('b:%s:%s:%s:%s:%s:%s', id, student_id, billing_plan_id, monthly_fee_yen, billing_start_date, billing_end_date)
  from public.student_billing_profiles
) rows;

\echo == slots whose current students have more than one teacher
select s.name school, c.lesson_day, c.lesson_time, count(distinct c.id) classes,
  string_agg(distinct coalesce(st.display_name, st.legal_name, '(none)'), ', ') enrollment_teachers
from public.classes c
join public.schools s on s.id = c.school_id
join public.student_enrollments se on se.class_id = c.id and se.status in ('active', 'pending', 'paused')
left join public.staff st on st.id = se.assigned_teacher_staff_id
group by s.name, c.lesson_day, c.lesson_time, c.id
having count(distinct se.assigned_teacher_staff_id) > 1
order by 1, 2, 3;

\if :migrated
\echo == class labels (post-migration)
select count(*) filter (where assigned_teacher_staff_id is not null) as labelled_classes,
  (select count(*) from (
     select se.class_id from public.student_enrollments se join public.classes c on c.id = se.class_id
     where se.status in ('active', 'pending', 'paused') and c.assigned_teacher_staff_id is null
     group by se.class_id
     having count(*) = count(se.assigned_teacher_staff_id) and count(distinct se.assigned_teacher_staff_id) = 1) d)
    as unlabelled_single_teacher_classes,
  (select count(*) from public.classes c join public.student_enrollments se on se.class_id = c.id
     where c.assigned_teacher_staff_id is not null and se.status in ('active', 'pending', 'paused')
       and se.assigned_teacher_staff_id is distinct from c.assigned_teacher_staff_id) as label_mismatches,
  (select count(*) from (select 1 from public.classes group by school_id, lesson_day, lesson_time having count(*) > 1) m)
    as slots_with_several_classes
from public.classes;
\endif

rollback;
