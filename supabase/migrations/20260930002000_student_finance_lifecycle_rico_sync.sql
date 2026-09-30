alter table public.students
  add column if not exists last_lesson_date date;

drop function if exists public.update_student_finance_mvp(uuid, uuid, integer, text, boolean, text, text, text, text, text, text, text, text, date, date, boolean, date, text);
drop function if exists public.update_student_finance_mvp(uuid, uuid, integer, text, boolean, text, text, text, text, text, text, text, text, date, date, boolean, date);

create or replace function public.update_student_finance_mvp(
  p_student_id uuid,
  p_billing_plan_id uuid default null,
  p_monthly_fee_yen integer default null,
  p_postal_address text default null,
  p_replace_bank boolean default false,
  p_bank_name text default null,
  p_bank_code text default null,
  p_branch_name text default null,
  p_branch_name_yomigana text default null,
  p_branch_code text default null,
  p_account_type text default null,
  p_account_number text default null,
  p_account_holder_katakana text default null,
  p_billing_start_date date default null,
  p_billing_end_date date default null,
  p_entrance_package_paid boolean default false,
  p_entrance_package_paid_at date default null,
  p_legacy_customer_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_billing_id uuid;
  v_current_billing_plan_id uuid;
  v_entrance_package_paid boolean;
  v_entrance_package_paid_at date;
  v_monthly_fee_yen integer;
  v_plan public.billing_plans%rowtype;
  v_student public.students%rowtype;
begin
  select * into v_student
  from public.students st
  where st.id = p_student_id
  for update;

  if not found then
    raise exception 'Student finance details are not available.';
  end if;

  if not public.can_manage_student_finance_org(v_student.organization_id, v_student.school_id) then
    raise exception 'You do not have permission to update student finance details.';
  end if;

  if p_billing_end_date is not null and p_billing_start_date is not null and p_billing_end_date < p_billing_start_date then
    raise exception 'Billing end date cannot be before billing start date.';
  end if;

  v_entrance_package_paid = coalesce(p_entrance_package_paid, false);
  v_entrance_package_paid_at = case when v_entrance_package_paid then p_entrance_package_paid_at else null end;

  select sbp.id, sbp.billing_plan_id into v_billing_id, v_current_billing_plan_id
  from public.student_billing_profiles sbp
  where sbp.student_id = p_student_id
    and sbp.organization_id = v_student.organization_id
    and sbp.school_id = v_student.school_id
  order by sbp.updated_at desc, sbp.created_at desc
  limit 1
  for update;

  if p_billing_plan_id is not null then
    select * into v_plan
    from public.billing_plans bp
    where bp.id = p_billing_plan_id;

    if not found then
      raise exception 'Billing Plan is not available for this student.';
    end if;

    if v_plan.organization_id <> v_student.organization_id
      or (v_plan.school_id is not null and v_plan.school_id <> v_student.school_id)
    then
      raise exception 'Billing Plan is not available for this student.';
    end if;

    if v_current_billing_plan_id is distinct from p_billing_plan_id and not v_plan.active then
      raise exception 'Inactive Billing Plans cannot be newly assigned.';
    end if;
  end if;

  v_monthly_fee_yen = coalesce(p_monthly_fee_yen, case when p_billing_plan_id is not null then v_plan.monthly_fee_yen else null end);

  update public.students st
  set last_lesson_date = p_billing_end_date,
      legacy_customer_id = case
        when p_legacy_customer_id is null then st.legacy_customer_id
        else nullif(trim(p_legacy_customer_id), '')
      end
  where st.id = p_student_id;

  perform public.update_student_finance_mvp(
    p_student_id,
    v_monthly_fee_yen,
    p_postal_address,
    p_replace_bank,
    p_bank_name,
    p_bank_code,
    p_branch_name,
    p_branch_name_yomigana,
    p_branch_code,
    p_account_type,
    p_account_number,
    p_account_holder_katakana,
    p_billing_start_date,
    p_billing_end_date
  );

  select sbp.id into v_billing_id
  from public.student_billing_profiles sbp
  where sbp.student_id = p_student_id
    and sbp.organization_id = v_student.organization_id
    and sbp.school_id = v_student.school_id
  order by sbp.updated_at desc, sbp.created_at desc
  limit 1
  for update;

  if v_billing_id is not null then
    update public.student_billing_profiles
    set billing_plan_id = p_billing_plan_id,
        entrance_package_paid = v_entrance_package_paid,
        entrance_package_paid_at = v_entrance_package_paid_at
    where id = v_billing_id;
  elsif p_billing_plan_id is not null
    or v_monthly_fee_yen is not null
    or p_billing_start_date is not null
    or p_billing_end_date is not null
    or v_entrance_package_paid
    or v_entrance_package_paid_at is not null
  then
    insert into public.student_billing_profiles (
      organization_id,
      school_id,
      student_id,
      billing_plan_id,
      monthly_fee_yen,
      billing_start_date,
      billing_end_date,
      entrance_package_paid,
      entrance_package_paid_at,
      currency,
      source_type
    )
    values (
      v_student.organization_id,
      v_student.school_id,
      p_student_id,
      p_billing_plan_id,
      v_monthly_fee_yen,
      p_billing_start_date,
      p_billing_end_date,
      v_entrance_package_paid,
      v_entrance_package_paid_at,
      'JPY',
      'manual'
    );
  end if;

  return p_student_id;
end;
$$;

comment on function public.update_student_finance_mvp(uuid, uuid, integer, text, boolean, text, text, text, text, text, text, text, text, date, date, boolean, date, text) is
'Atomic Student Profile finance update. Billing end date is synchronized to students.last_lesson_date, and Rico ID is stored in students.legacy_customer_id.';

revoke all on function public.update_student_finance_mvp(uuid, uuid, integer, text, boolean, text, text, text, text, text, text, text, text, date, date, boolean, date, text) from public, anon;
grant execute on function public.update_student_finance_mvp(uuid, uuid, integer, text, boolean, text, text, text, text, text, text, text, text, date, date, boolean, date, text) to authenticated;

notify pgrst, 'reload schema';
