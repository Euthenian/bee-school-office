alter table public.student_billing_profiles
  add column if not exists entrance_package_paid boolean not null default false,
  add column if not exists entrance_package_paid_at date;

alter table public.student_billing_profiles
  drop constraint if exists student_billing_profiles_entrance_package_paid_check;

alter table public.student_billing_profiles
  add constraint student_billing_profiles_entrance_package_paid_check
  check (entrance_package_paid or entrance_package_paid_at is null);

comment on column public.student_billing_profiles.entrance_package_paid is
'Whether the student entrance package has been paid.';

comment on column public.student_billing_profiles.entrance_package_paid_at is
'Payment date for the student entrance package. Must be null when entrance_package_paid is false.';

drop function if exists public.get_student_finance_mvp(uuid);
create or replace function public.get_student_finance_mvp(p_student_id uuid)
returns table (
  student_id uuid,
  organization_id uuid,
  school_id uuid,
  billing_plan_id uuid,
  monthly_fee_yen integer,
  billing_start_date date,
  billing_end_date date,
  entrance_package_paid boolean,
  entrance_package_paid_at date,
  currency char(3),
  postal_address text,
  bank_name text,
  branch_name text,
  account_type text,
  account_number_last4 text,
  has_bank_account boolean,
  can_view_full_bank_details boolean,
  can_edit_finance boolean,
  can_edit_bank_details boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_address public.student_addresses%rowtype;
  v_bank public.student_bank_accounts%rowtype;
  v_billing public.student_billing_profiles%rowtype;
  v_can_bank boolean;
  v_can_finance boolean;
  v_student public.students%rowtype;
begin
  select * into v_student
  from public.students st
  where st.id = p_student_id;

  if not found then
    raise exception 'Student finance details are not available.';
  end if;

  v_can_finance = public.can_manage_student_finance_org(v_student.organization_id, v_student.school_id);
  if not v_can_finance then
    raise exception 'You do not have permission to view student finance details.';
  end if;

  v_can_bank = public.can_manage_student_bank_accounts_org(v_student.organization_id, v_student.school_id);

  select * into v_billing
  from public.student_billing_profiles sbp
  where sbp.student_id = p_student_id
    and sbp.organization_id = v_student.organization_id
    and sbp.school_id = v_student.school_id
  order by sbp.updated_at desc, sbp.created_at desc
  limit 1;

  select * into v_address
  from public.student_addresses sa
  where sa.student_id = p_student_id
    and sa.organization_id = v_student.organization_id
    and sa.school_id = v_student.school_id
  order by sa.updated_at desc, sa.created_at desc
  limit 1;

  select * into v_bank
  from public.student_bank_accounts sba
  where sba.student_id = p_student_id
    and sba.organization_id = v_student.organization_id
    and sba.school_id = v_student.school_id
  order by sba.updated_at desc, sba.created_at desc
  limit 1;

  return query
  select
    v_student.id,
    v_student.organization_id,
    v_student.school_id,
    v_billing.billing_plan_id,
    v_billing.monthly_fee_yen,
    v_billing.billing_start_date,
    v_billing.billing_end_date,
    coalesce(v_billing.entrance_package_paid, false),
    v_billing.entrance_package_paid_at,
    coalesce(v_billing.currency, 'JPY'::char(3)),
    v_address.postal_address,
    v_bank.bank_name,
    v_bank.branch_name,
    v_bank.account_type,
    case
      when nullif(trim(coalesce(v_bank.account_number, '')), '') is null then null
      else right(v_bank.account_number, 4)
    end,
    v_bank.id is not null,
    v_can_bank,
    v_can_finance,
    v_can_bank;
end;
$$;

comment on function public.get_student_finance_mvp(uuid) is
'Student Profile finance summary. Returns optional Billing Plan reference, entrance package payment status, copied monthly fee, billing dates, address, and only masked bank-number material; full account values require get_student_bank_details_mvp.';

revoke all on function public.get_student_finance_mvp(uuid) from public, anon;
grant execute on function public.get_student_finance_mvp(uuid) to authenticated;

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
  p_entrance_package_paid_at date default null
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

comment on function public.update_student_finance_mvp(uuid, uuid, integer, text, boolean, text, text, text, text, text, text, text, text, date, date, boolean, date) is
'Atomic Student Profile finance update with optional Billing Plan reference and entrance package payment status. monthly_fee_yen remains the copied student-specific amount used by monthly billing snapshots.';

revoke all on function public.update_student_finance_mvp(uuid, uuid, integer, text, boolean, text, text, text, text, text, text, text, text, date, date, boolean, date) from public, anon;
grant execute on function public.update_student_finance_mvp(uuid, uuid, integer, text, boolean, text, text, text, text, text, text, text, text, date, date, boolean, date) to authenticated;

notify pgrst, 'reload schema';
