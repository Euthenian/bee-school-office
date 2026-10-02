alter table public.student_billing_profiles
  add column if not exists rico_cancellation_verified_at timestamptz,
  add column if not exists rico_cancellation_verified_by uuid references public.profiles (id) on delete set null;

create or replace function public.reset_rico_cancellation_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if (new.rico_cancellation_verified_at is not null or new.rico_cancellation_verified_by is not null)
      and not public.is_super_admin()
    then
      raise exception 'You do not have permission to verify RICO cancellation.';
    end if;
    return new;
  end if;

  if new.billing_end_date is distinct from old.billing_end_date then
    new.rico_cancellation_verified_at = null;
    new.rico_cancellation_verified_by = null;
  elsif new.rico_cancellation_verified_at is distinct from old.rico_cancellation_verified_at
    or new.rico_cancellation_verified_by is distinct from old.rico_cancellation_verified_by
  then
    if not public.is_super_admin() then
      raise exception 'You do not have permission to verify RICO cancellation.';
    end if;
  end if;
  return new;
end;
$$;

create trigger student_billing_profiles_rico_verification
before insert or update on public.student_billing_profiles
for each row execute function public.reset_rico_cancellation_verification();

create or replace function public.get_unverified_rico_cancellations_mvp(
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
  monthly_fee_yen integer
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
    st.first_name, st.last_name, st.preferred_name, st.status, lp.billing_end_date, lp.monthly_fee_yen
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

create or replace function public.verify_rico_cancellation_mvp(
  p_profile_id uuid,
  p_billing_month date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.student_billing_profiles%rowtype;
begin
  if not public.is_super_admin() or auth.uid() is null then
    raise exception 'You do not have permission to verify RICO cancellation.';
  end if;

  select * into v_profile
  from public.student_billing_profiles sbp
  where sbp.id = p_profile_id
  for update;

  if not found or p_billing_month is null
    or v_profile.billing_end_date is null
    or v_profile.billing_end_date >= (date_trunc('month', p_billing_month) + interval '1 month')::date
    or v_profile.rico_cancellation_verified_at is not null
    or v_profile.id is distinct from (
      select sbp.id from public.student_billing_profiles sbp
      where sbp.student_id = v_profile.student_id
      order by sbp.updated_at desc, sbp.created_at desc, sbp.id desc limit 1
    )
  then
    raise exception 'This RICO cancellation is no longer awaiting verification.';
  end if;

  update public.student_billing_profiles sbp
  set rico_cancellation_verified_at = now(),
      rico_cancellation_verified_by = auth.uid()
  where sbp.id = p_profile_id;

  return p_profile_id;
end;
$$;

revoke all on function public.verify_rico_cancellation_mvp(uuid, date) from public, anon;
grant execute on function public.verify_rico_cancellation_mvp(uuid, date) to authenticated;

notify pgrst, 'reload schema';
