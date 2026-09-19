create table if not exists public.billing_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  school_id uuid references public.schools (id) on delete restrict,
  name text not null,
  monthly_fee_yen integer not null,
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  constraint billing_plans_school_id_organization_id_fkey
    foreign key (school_id, organization_id)
    references public.schools (id, organization_id)
    on delete restrict,
  constraint billing_plans_name_check
    check (length(trim(name)) > 0),
  constraint billing_plans_monthly_fee_check
    check (monthly_fee_yen >= 0 and monthly_fee_yen <= 100000)
);

create index if not exists billing_plans_scope_active_sort_idx
on public.billing_plans (organization_id, school_id, active, sort_order, name);

create index if not exists billing_plans_org_active_sort_idx
on public.billing_plans (organization_id, active, sort_order, name);

comment on table public.billing_plans is
'Predefined student finance Billing Plans. Assigning a plan copies the current monthly fee onto student_billing_profiles; future plan edits do not rewrite student fees or historical monthly snapshots.';

drop trigger if exists billing_plans_set_updated_at on public.billing_plans;
create trigger billing_plans_set_updated_at
before update on public.billing_plans
for each row execute function public.set_updated_at();

alter table public.student_billing_profiles
  add column if not exists billing_plan_id uuid references public.billing_plans (id) on delete restrict;

create index if not exists student_billing_profiles_billing_plan_idx
on public.student_billing_profiles (billing_plan_id)
where billing_plan_id is not null;

comment on column public.student_billing_profiles.billing_plan_id is
'Optional reference to the Billing Plan selected when assigning the student fee. monthly_fee_yen remains the authoritative copied amount.';
create or replace function public.validate_student_billing_profile_billing_plan()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_plan public.billing_plans%rowtype;
begin
  if new.billing_plan_id is null then
    return new;
  end if;

  select * into v_plan
  from public.billing_plans bp
  where bp.id = new.billing_plan_id;

  if not found then
    raise exception 'Billing Plan % was not found.', new.billing_plan_id;
  end if;

  if v_plan.organization_id <> new.organization_id
    or (v_plan.school_id is not null and v_plan.school_id <> new.school_id)
  then
    raise exception 'Billing Plan is not available for this student billing profile.';
  end if;

  if (tg_op = 'INSERT' or old.billing_plan_id is distinct from new.billing_plan_id) and not v_plan.active then
    raise exception 'Inactive Billing Plans cannot be newly assigned.';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_student_billing_profile_billing_plan() from public, anon, authenticated;

drop trigger if exists student_billing_profiles_validate_billing_plan on public.student_billing_profiles;
create trigger student_billing_profiles_validate_billing_plan
before insert or update of billing_plan_id, organization_id, school_id on public.student_billing_profiles
for each row execute function public.validate_student_billing_profile_billing_plan();

alter table public.billing_plans enable row level security;

revoke all on public.billing_plans from anon, authenticated;
grant select, insert, update on public.billing_plans to authenticated;
grant all on public.billing_plans to service_role;

drop policy if exists "billing_plans_finance_access" on public.billing_plans;
create policy "billing_plans_finance_access"
on public.billing_plans
for all
to authenticated
using (
  public.can_manage_student_finance_org(organization_id, school_id)
  or (
    school_id is null
    and (
      public.is_super_admin()
      or public.has_org_role(organization_id, array['franchise_owner', 'office_staff']::public.membership_role[])
    )
  )
)
with check (
  public.can_manage_student_finance_org(organization_id, school_id)
  or (
    school_id is null
    and (
      public.is_super_admin()
      or public.has_org_role(organization_id, array['franchise_owner', 'office_staff']::public.membership_role[])
    )
  )
);

drop function if exists public.get_student_billing_plan_options_mvp(uuid);
create or replace function public.get_student_billing_plan_options_mvp(p_student_id uuid)
returns table (
  id uuid,
  organization_id uuid,
  school_id uuid,
  name text,
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
'Student Profile finance summary. Returns optional Billing Plan reference, copied monthly fee, billing dates, address, and only masked bank-number material; full account values require get_student_bank_details_mvp.';

revoke all on function public.get_student_finance_mvp(uuid) from public, anon;
grant execute on function public.get_student_finance_mvp(uuid) to authenticated;

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
  p_billing_end_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_billing_id uuid;
  v_current_billing_plan_id uuid;
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

  select sbp.id, sbp.billing_plan_id into v_billing_id, v_current_billing_plan_id
  from public.student_billing_profiles sbp
  where sbp.student_id = p_student_id
    and sbp.organization_id = v_student.organization_id
    and sbp.school_id = v_student.school_id
  order by sbp.updated_at desc, sbp.created_at desc
  limit 1;

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
  limit 1;

  if v_billing_id is not null then
    update public.student_billing_profiles
    set billing_plan_id = p_billing_plan_id
    where id = v_billing_id;
  end if;

  return p_student_id;
end;
$$;

comment on function public.update_student_finance_mvp(uuid, uuid, integer, text, boolean, text, text, text, text, text, text, text, text, date, date) is
'Atomic Student Profile finance update with optional Billing Plan reference. monthly_fee_yen remains the copied student-specific amount used by monthly billing snapshots.';

revoke all on function public.update_student_finance_mvp(uuid, uuid, integer, text, boolean, text, text, text, text, text, text, text, text, date, date) from public, anon;
grant execute on function public.update_student_finance_mvp(uuid, uuid, integer, text, boolean, text, text, text, text, text, text, text, text, date, date) to authenticated;

notify pgrst, 'reload schema';
