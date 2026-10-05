-- Read-only scheduling facts for the internal Coaching Pool calculator.
-- The static-export app has no server runtime. Keep privileged billing joins
-- inside this authenticated, school-scoped function and expose no student data.
create function public.get_internal_coaching_availability_facts(
  p_school_id uuid,
  p_program_id text,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_school public.schools%rowtype;
  v_result jsonb;
begin
  if p_school_id is null or p_program_id is null or p_start_date is null or p_end_date is null
    or p_end_date < p_start_date or p_end_date > p_start_date + 30 then
    raise exception 'Choose a school, program, and date range of at most 31 days.';
  end if;

  select * into v_school from public.schools where id = p_school_id and status = 'active';
  if not found then raise exception 'School is not active or does not exist.'; end if;
  if not (public.can_manage_staff_org(v_school.organization_id) and public.can_manage_school(p_school_id)) then
    raise exception 'Not authorized to inspect Coaching availability for this school.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.coaching_programs where id = p_program_id and active) then
    raise exception 'Coaching program is not active or does not exist.';
  end if;

  select jsonb_build_object(
    'schoolId', v_school.id,
    'timeZone', v_school.timezone,
    'programId', p_program_id,
    'startDate', p_start_date,
    'endDate', p_end_date,
    'coaches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', st.id, 'name', coalesce(nullif(st.display_name, ''), st.legal_name),
        'status', st.status, 'employmentStartDate', st.employment_start_date,
        'employmentEndDate', st.employment_end_date,
        'assignmentStatus', ssa.status, 'assignmentStartDate', ssa.start_date,
        'assignmentEndDate', ssa.end_date, 'enabled', coalesce(scs.enabled, false),
        'programIds', coalesce((select jsonb_agg(scp.program_id) from public.staff_coaching_programs scp
          where scp.staff_id = st.id), '[]'::jsonb)
      ) order by coalesce(st.display_name, st.legal_name), st.id)
      from public.staff_school_assignments ssa
      join public.staff st on st.id = ssa.staff_id and st.organization_id = v_school.organization_id
      left join public.staff_coaching_settings scs on scs.staff_id = st.id
        and scs.organization_id = st.organization_id
      where ssa.school_id = p_school_id and ssa.organization_id = v_school.organization_id
    ), '[]'::jsonb),
    'windows', coalesce((
      select jsonb_agg(jsonb_build_object('staffId', w.staff_id, 'weekday', w.weekday,
        'startTime', w.start_time, 'endTime', w.end_time))
      from public.staff_availability_windows w
      where w.school_id = p_school_id and w.organization_id = v_school.organization_id and w.active
    ), '[]'::jsonb),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object('staffId', b.staff_id, 'localDate', b.local_date,
        'startTime', b.start_time, 'endTime', b.end_time))
      from public.staff_availability_blocks b
      where b.school_id = p_school_id and b.organization_id = v_school.organization_id and b.active
        and b.local_date between p_start_date and p_end_date
    ), '[]'::jsonb),
    'regularLessons', coalesce((
      select jsonb_agg(jsonb_build_object('staffId', se.assigned_teacher_staff_id,
        'classId', c.id, 'weekday', case c.lesson_day::text
          when 'monday' then 0 when 'tuesday' then 1 when 'wednesday' then 2
          when 'thursday' then 3 when 'friday' then 4 when 'saturday' then 5 else 6 end,
        'startTime', c.lesson_time, 'durationMinutes', case
          when billing.profile_count = 1 and billing.duration_count = 1
            then billing.duration_minutes else null end,
        'startDate', se.start_date, 'endDate', se.end_date))
      from public.student_enrollments se
      join public.classes c on c.id = se.class_id and c.school_id = se.school_id
        and c.organization_id = se.organization_id and c.status = 'active'
      left join lateral (
        select count(*) as profile_count, count(bp.lesson_duration_minutes) as duration_count,
          max(bp.lesson_duration_minutes) as duration_minutes
        from public.student_billing_profiles sbp
        left join public.billing_plans bp on bp.id = sbp.billing_plan_id
          and bp.organization_id = sbp.organization_id
          and (bp.school_id is null or bp.school_id = sbp.school_id)
        where sbp.student_id = se.student_id and sbp.school_id = se.school_id
          and sbp.organization_id = se.organization_id
      ) billing on true
      where se.school_id = p_school_id and se.organization_id = v_school.organization_id
        and se.status in ('active', 'pending') and se.assigned_teacher_staff_id is not null
        and (se.start_date is null or se.start_date <= p_end_date)
        and (se.end_date is null or se.end_date >= p_start_date - 1)
    ), '[]'::jsonb),
    'trialLessons', coalesce((
      select jsonb_agg(jsonb_build_object('staffId', st.id, 'localDate', tl.trial_date))
      from public.trial_lessons tl
      join public.staff st on st.profile_id = tl.assigned_teacher_profile_id
        and st.organization_id = tl.organization_id
      where tl.school_id = p_school_id and tl.organization_id = v_school.organization_id
        and tl.trial_date between p_start_date and p_end_date and tl.status <> 'cancelled'
    ), '[]'::jsonb),
    'packageLessons', coalesce((
      select jsonb_agg(jsonb_build_object('staffId', tpl.assigned_teacher_staff_id,
        'localDate', tpl.lesson_date))
      from public.trial_package_lessons tpl
      join public.trial_packages tp on tp.id = tpl.trial_package_id
      where tpl.school_id = p_school_id and tpl.organization_id = v_school.organization_id
        and tpl.lesson_date between p_start_date and p_end_date
        and tpl.assigned_teacher_staff_id is not null and tpl.status = 'scheduled'
        and tp.status <> 'cancelled'
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.get_internal_coaching_availability_facts(uuid, text, date, date)
  from public, anon, authenticated;
grant execute on function public.get_internal_coaching_availability_facts(uuid, text, date, date)
  to authenticated;
