-- Apply after 20261013002000_student_departure_confirmation.sql.
-- Historical events have no recorded notice date; do not invent one.
alter table public.student_departure_confirmations
  add column notice_date date;

comment on column public.student_departure_confirmations.notice_date is
  'Actual date the student gave departure notice. NULL only for confirmations recorded before this field existed.';
comment on column public.student_departure_confirmations.final_lesson_date is
  'Final lesson date. Future departure email departure_month must use this date, independently of billing.';
comment on column public.student_departure_confirmations.final_billing_month is
  'First day of the final required tuition month. Future departure email last_billing_month must use this month.';

alter table public.student_departure_confirmations
  drop constraint departure_dates_agree;

alter table public.student_departure_confirmations
  add constraint departure_dates_agree check (
    date_trunc('month', billing_end_date)::date = final_billing_month
  );

alter table public.student_departure_confirmations
  add constraint departure_notice_cutoff check (
    notice_date is null or final_billing_month >= (
      date_trunc('month', notice_date)
      + case when extract(day from notice_date) > 15 then interval '1 month' else interval '0 months' end
    )::date
  );

-- A changed RETURNS TABLE definition requires replacing the function identity.
drop function public.get_student_departure_confirmation_state_mvp(uuid);

create function public.get_student_departure_confirmation_state_mvp(p_student_id uuid)
returns table (
  student_status public.student_status,
  last_lesson_date date,
  billing_profile_id uuid,
  billing_start_date date,
  billing_end_date date,
  rico_cancellation_verified_at timestamptz,
  active_confirmation_id uuid,
  confirmed_at timestamptz,
  confirmed_final_lesson_date date,
  confirmed_final_billing_month date,
  confirmed_notice_date date
) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_student public.students%rowtype;
begin
  select * into v_student from public.students where id = p_student_id;
  if not found or auth.uid() is null or not public.can_manage_student(p_student_id)
    or not public.can_manage_student_finance_org(v_student.organization_id, v_student.school_id) then
    raise exception 'Student departure details are not available.';
  end if;
  return query
  select v_student.status, v_student.last_lesson_date,
    bp.id, bp.billing_start_date, bp.billing_end_date, bp.rico_cancellation_verified_at,
    dc.id, dc.confirmed_at, dc.final_lesson_date, dc.final_billing_month, dc.notice_date
  from (select 1) anchor
  left join lateral (
    select sbp.* from public.student_billing_profiles sbp
    where sbp.student_id = p_student_id
      and sbp.organization_id = v_student.organization_id and sbp.school_id = v_student.school_id
    order by sbp.updated_at desc, sbp.created_at desc, sbp.id desc limit 1
  ) bp on true
  left join public.student_departure_confirmations dc
    on dc.student_id = p_student_id and dc.voided_at is null;
end;
$$;

revoke all on function public.get_student_departure_confirmation_state_mvp(uuid) from public, anon;
grant execute on function public.get_student_departure_confirmation_state_mvp(uuid) to authenticated;

-- Remove the four-argument RPC so old clients cannot bypass notice validation.
drop function public.confirm_student_departure_mvp(uuid, date, date, uuid);

create function public.confirm_student_departure_mvp(
  p_student_id uuid,
  p_notice_date date,
  p_final_lesson_date date,
  p_final_billing_month date,
  p_billing_profile_id uuid
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_student public.students%rowtype;
  v_billing public.student_billing_profiles%rowtype;
  v_event public.student_departure_confirmations%rowtype;
  v_event_id uuid;
  v_minimum_billing_month date;
  v_billing_end_date date;
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  select * into v_student from public.students where id = p_student_id for update;
  if not found or not public.can_manage_student(p_student_id)
    or not public.can_manage_student_finance_org(v_student.organization_id, v_student.school_id) then
    raise exception 'You cannot confirm this student departure.';
  end if;

  if p_notice_date is null then raise exception 'Departure notice date is required.'; end if;
  if p_final_lesson_date is null then raise exception 'Final lesson date is required.'; end if;
  if p_final_billing_month is null then raise exception 'Final billing month is required.'; end if;
  if p_final_billing_month <> date_trunc('month', p_final_billing_month)::date then
    raise exception 'Final billing month must be the first day of its month.';
  end if;
  v_minimum_billing_month := (
    date_trunc('month', p_notice_date)
    + case when extract(day from p_notice_date) > 15 then interval '1 month' else interval '0 months' end
  )::date;
  if p_final_billing_month < v_minimum_billing_month then
    raise exception 'Final billing month must be % or later under the 15th-day notice rule.', v_minimum_billing_month;
  end if;
  if v_student.start_date is not null and p_final_lesson_date < v_student.start_date then
    raise exception 'Final lesson date cannot precede student start date.';
  end if;

  v_billing_end_date := (p_final_billing_month + interval '1 month')::date - 1;
  select * into v_billing from public.student_billing_profiles sbp
  where sbp.student_id = p_student_id
    and sbp.organization_id = v_student.organization_id and sbp.school_id = v_student.school_id
  order by sbp.updated_at desc, sbp.created_at desc, sbp.id desc limit 1 for update;
  if not found or p_billing_profile_id is null or v_billing.id <> p_billing_profile_id then
    raise exception 'A valid current billing profile is required. Reload the student and try again.';
  end if;
  if v_billing.billing_start_date is not null and p_final_lesson_date < v_billing.billing_start_date then
    raise exception 'Final lesson date conflicts with billing start date.';
  end if;
  if v_billing.billing_start_date is not null and v_billing_end_date < v_billing.billing_start_date then
    raise exception 'Final billing month conflicts with billing start date.';
  end if;

  select * into v_event from public.student_departure_confirmations
    where student_id = p_student_id and voided_at is null for update;
  if found then
    if v_event.notice_date = p_notice_date
      and v_event.billing_profile_id = v_billing.id
      and v_event.final_lesson_date = p_final_lesson_date
      and v_event.final_billing_month = p_final_billing_month
      and v_event.billing_end_date = v_billing_end_date
      and v_student.status = 'withdrawn'
      and v_student.last_lesson_date = v_event.final_lesson_date
      and v_billing.billing_end_date = v_event.billing_end_date then
      return v_event.id;
    end if;
    raise exception 'This departure was already confirmed. Void it before recording a correction.';
  end if;
  if v_student.status = 'withdrawn' then
    raise exception 'This student is already withdrawn without a confirmation. Review the record before confirming.';
  end if;

  -- The existing RICO trigger clears verification only if the billing end date changes.
  update public.students set last_lesson_date = p_final_lesson_date where id = p_student_id;
  update public.student_billing_profiles set billing_end_date = v_billing_end_date where id = v_billing.id;
  insert into public.student_departure_confirmations (
    student_id, organization_id, school_id, billing_profile_id, previous_status,
    notice_date, final_lesson_date, final_billing_month, billing_end_date, confirmed_by
  ) values (
    p_student_id, v_student.organization_id, v_student.school_id, v_billing.id, v_student.status,
    p_notice_date, p_final_lesson_date, p_final_billing_month, v_billing_end_date, auth.uid()
  ) returning id into v_event_id;
  update public.students set status = 'withdrawn' where id = p_student_id;
  return v_event_id;
end;
$$;

revoke all on function public.confirm_student_departure_mvp(uuid, date, date, date, uuid) from public, anon;
grant execute on function public.confirm_student_departure_mvp(uuid, date, date, date, uuid) to authenticated;

-- Student Edit's general save may update other fields after confirmation. Keep
-- its established sync for unconfirmed students without overwriting the
-- separately confirmed billing month.
create or replace function public.update_student_with_class_assignment_mvp(
  p_student_id uuid,
  p_school_id uuid,
  p_first_name text,
  p_last_name text,
  p_preferred_name text default null,
  p_status public.student_status default 'active',
  p_start_date date default null,
  p_last_lesson_date date default null,
  p_legacy_customer_id text default null,
  p_date_of_birth date default null,
  p_age_override smallint default null,
  p_contacts jsonb default '[]'::jsonb,
  p_billing_plan_id uuid default null,
  p_monthly_fee_yen integer default null,
  p_assigned_teacher_profile_id uuid default null,
  p_lesson_type public.class_lesson_type default null,
  p_class_level_id text default null,
  p_create_new_class boolean default false,
  p_existing_class_id uuid default null,
  p_lesson_day public.class_lesson_day default null,
  p_lesson_time time default null,
  p_guardians jsonb default '[]'::jsonb,
  p_notes jsonb default '[]'::jsonb,
  p_assigned_teacher_staff_id uuid default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_organization_id uuid;
  v_student_id uuid;
  v_student_school_id uuid;
begin
  v_student_id = public.update_student_mvp(
    p_student_id, p_school_id, p_first_name, p_last_name, p_preferred_name,
    p_status, p_start_date, p_date_of_birth, p_age_override, p_contacts,
    null, null, null, null, null, p_guardians, p_notes
  );

  update public.students st
  set last_lesson_date = p_last_lesson_date,
      legacy_customer_id = nullif(trim(coalesce(p_legacy_customer_id, '')), '')
  where st.id = p_student_id
  returning st.organization_id, st.school_id into v_organization_id, v_student_school_id;

  perform public.assign_student_to_class_mvp(
    p_student_id, p_school_id, p_status, p_start_date, p_existing_class_id,
    p_create_new_class, p_assigned_teacher_profile_id, p_lesson_type,
    p_class_level_id, p_lesson_day, p_lesson_time, p_billing_plan_id,
    p_assigned_teacher_staff_id
  );

  perform public.update_student_class_assignment_billing_mvp(
    p_student_id, p_billing_plan_id, p_monthly_fee_yen
  );

  if not exists (
    select 1 from public.student_departure_confirmations dc
    where dc.student_id = p_student_id and dc.voided_at is null
  ) then
    update public.student_billing_profiles sbp
    set billing_end_date = p_last_lesson_date
    where sbp.student_id = p_student_id
      and sbp.organization_id = v_organization_id
      and sbp.school_id = v_student_school_id;
  end if;

  return v_student_id;
end;
$$;

notify pgrst, 'reload schema';
