-- Expose the student's RICO customer ID (students.legacy_customer_id) on the RICO cancellation list.
-- Read-only change: the return type gains one column, so the function is dropped and recreated with an identical body.
drop function if exists public.get_unverified_rico_cancellations_mvp(uuid, uuid, date);

create function public.get_unverified_rico_cancellations_mvp(
  p_organization_id uuid default null,
  p_school_id uuid default null,
  p_billing_month date default null
)
returns table (
  profile_id uuid,
  student_id uuid,
  organization_id uuid,
  school_id uuid,
  school_name text,
  student_first_name text,
  student_last_name text,
  student_preferred_name text,
  student_status public.student_status,
  billing_end_date date,
  monthly_fee_yen integer,
  legacy_customer_id text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_next_month_start date := (date_trunc('month', coalesce(p_billing_month, (now() at time zone 'Asia/Tokyo')::date)) + interval '1 month')::date;
begin
  if not public.is_super_admin() then
    raise exception 'You do not have permission to view RICO cancellations.';
  end if;

  return query
  with latest_profiles as (
    select distinct on (sbp.student_id) sbp.*
    from public.student_billing_profiles sbp
    order by sbp.student_id, sbp.updated_at desc, sbp.created_at desc, sbp.id desc
  )
  select lp.id, st.id, lp.organization_id, lp.school_id, s.name,
    st.first_name, st.last_name, st.preferred_name, st.status, lp.billing_end_date, lp.monthly_fee_yen,
    st.legacy_customer_id
  from latest_profiles lp
  join public.students st on st.id = lp.student_id
    and st.organization_id = lp.organization_id and st.school_id = lp.school_id
  join public.schools s on s.id = lp.school_id and s.organization_id = lp.organization_id
  where lp.billing_end_date < v_next_month_start
    and lp.rico_cancellation_verified_at is null
    and (p_organization_id is null or lp.organization_id = p_organization_id)
    and (p_school_id is null or lp.school_id = p_school_id)
  order by s.name, st.last_name, st.first_name;
end;
$$;

revoke all on function public.get_unverified_rico_cancellations_mvp(uuid, uuid, date) from public, anon;
grant execute on function public.get_unverified_rico_cancellations_mvp(uuid, uuid, date) to authenticated;

notify pgrst, 'reload schema';
