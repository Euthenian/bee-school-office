alter table public.billing_plans
  add column if not exists lesson_type public.class_lesson_type,
  add column if not exists lesson_duration_minutes integer,
  add column if not exists lessons_per_month integer;

alter table public.billing_plans
  drop constraint if exists billing_plans_lesson_duration_minutes_check;

alter table public.billing_plans
  add constraint billing_plans_lesson_duration_minutes_check
  check (lesson_duration_minutes is null or lesson_duration_minutes > 0);

alter table public.billing_plans
  drop constraint if exists billing_plans_lessons_per_month_check;

alter table public.billing_plans
  add constraint billing_plans_lessons_per_month_check
  check (lessons_per_month is null or lessons_per_month > 0);

comment on table public.billing_plans is
'Predefined student finance Lesson Packages. Assigning a package copies the current monthly fee onto student_billing_profiles; future package edits do not rewrite student fees or historical monthly snapshots.';

comment on column public.billing_plans.lesson_type is
'Commercial lesson type for this Lesson Package. Uses the existing class_lesson_type enum and does not modify class or enrollment records.';

comment on column public.billing_plans.lesson_duration_minutes is
'Commercial lesson duration in minutes for this Lesson Package. This does not modify scheduling records.';

comment on column public.billing_plans.lessons_per_month is
'Commercial lesson frequency for this Lesson Package. This does not modify class, enrollment, or schedule records.';

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

notify pgrst, 'reload schema';
