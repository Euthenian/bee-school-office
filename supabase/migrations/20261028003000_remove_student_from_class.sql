-- Removing a student from a class ends the enrollment instead of deleting it,
-- so attendance, billing and class history keep their enrollment row.
create function public.remove_student_from_class_mvp(p_class_id uuid, p_enrollment_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_enrollment public.student_enrollments%rowtype;
  v_school_timezone text;
  v_today date;
begin
  if auth.uid() is null or p_class_id is null or p_enrollment_id is null then
    raise exception 'A signed-in staff member, class, and enrollment are required.';
  end if;

  select * into v_enrollment from public.student_enrollments
  where id = p_enrollment_id and class_id = p_class_id
  for update;
  if not found
    or not public.can_manage_student(v_enrollment.student_id)
    or not public.can_manage_school(v_enrollment.school_id) then
    raise exception 'Class enrollment not found or permission denied.';
  end if;
  if v_enrollment.status not in ('active', 'pending', 'paused') then
    raise exception 'This student is no longer enrolled in the class.';
  end if;

  select timezone into v_school_timezone from public.schools where id = v_enrollment.school_id;
  v_today := (now() at time zone coalesce(v_school_timezone, 'Asia/Tokyo'))::date;

  -- 'withdrawn' is reserved for the student departure workflow.
  update public.student_enrollments
  set status = 'completed',
      end_date = greatest(v_today, coalesce(v_enrollment.start_date, v_today))
  where id = v_enrollment.id;
  return v_enrollment.id;
end;
$$;
revoke all on function public.remove_student_from_class_mvp(uuid, uuid) from public, anon;
grant execute on function public.remove_student_from_class_mvp(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
