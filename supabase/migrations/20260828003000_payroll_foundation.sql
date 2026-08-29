create table if not exists public.staff_compensation_terms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  school_id uuid,
  staff_id uuid not null,
  compensation_type text not null,
  amount numeric(12, 2) not null default 0,
  unit text not null,
  currency char(3) not null default 'JPY',
  effective_from date not null,
  effective_to date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  constraint staff_compensation_terms_staff_id_organization_id_fkey
    foreign key (staff_id, organization_id)
    references public.staff (id, organization_id)
    on delete restrict,
  constraint staff_compensation_terms_school_id_organization_id_fkey
    foreign key (school_id, organization_id)
    references public.schools (id, organization_id)
    on delete restrict,
  constraint staff_compensation_terms_type_check
    check (compensation_type in ('monthly_salary', 'per_lesson', 'hourly', 'manual', 'custom')),
  constraint staff_compensation_terms_amount_check
    check (amount >= 0),
  constraint staff_compensation_terms_unit_check
    check (unit in ('month', 'lesson', 'hour', 'manual', 'custom')),
  constraint staff_compensation_terms_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint staff_compensation_terms_effective_dates_check
    check (effective_to is null or effective_to >= effective_from)
);

create index if not exists staff_compensation_terms_staff_effective_idx
on public.staff_compensation_terms (staff_id, effective_from desc);

create index if not exists staff_compensation_terms_organization_school_idx
on public.staff_compensation_terms (organization_id, school_id);

comment on table public.staff_compensation_terms is
'Versioned compensation terms linked to staff. Payroll entries store snapshots so term changes do not rewrite historical payroll.';

create table if not exists public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  school_id uuid,
  scope text not null default 'organization',
  period_start date not null,
  period_end date not null,
  status text not null default 'draft',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  constraint payroll_periods_organization_id_fkey
    foreign key (organization_id)
    references public.organizations (id)
    on delete restrict,
  constraint payroll_periods_school_id_organization_id_fkey
    foreign key (school_id, organization_id)
    references public.schools (id, organization_id)
    on delete restrict,
  constraint payroll_periods_scope_check
    check (
      (scope = 'organization' and school_id is null)
      or (scope = 'school' and school_id is not null)
    ),
  constraint payroll_periods_status_check
    check (status in ('draft', 'finalized', 'paid')),
  constraint payroll_periods_dates_check
    check (period_end >= period_start)
);

create unique index if not exists payroll_periods_scope_dates_uidx
on public.payroll_periods (
  organization_id,
  coalesce(school_id, '00000000-0000-0000-0000-000000000000'::uuid),
  period_start,
  period_end
);

create index if not exists payroll_periods_organization_status_idx
on public.payroll_periods (organization_id, status, period_start desc);

create table if not exists public.payroll_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  school_id uuid,
  payroll_period_id uuid not null,
  staff_id uuid not null,
  compensation_term_id uuid,
  compensation_type text not null,
  compensation_amount numeric(12, 2) not null default 0,
  compensation_unit text not null,
  currency char(3) not null default 'JPY',
  base_amount numeric(12, 2) not null default 0,
  adjustments_amount numeric(12, 2) not null default 0,
  gross_amount numeric(12, 2) not null default 0,
  deductions_amount numeric(12, 2) not null default 0,
  net_payable numeric(12, 2) not null default 0,
  status text not null default 'draft',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  constraint payroll_entries_payroll_period_id_organization_id_fkey
    foreign key (payroll_period_id, organization_id)
    references public.payroll_periods (id, organization_id)
    on delete restrict,
  constraint payroll_entries_staff_id_organization_id_fkey
    foreign key (staff_id, organization_id)
    references public.staff (id, organization_id)
    on delete restrict,
  constraint payroll_entries_compensation_term_id_organization_id_fkey
    foreign key (compensation_term_id, organization_id)
    references public.staff_compensation_terms (id, organization_id)
    on delete restrict,
  constraint payroll_entries_school_id_organization_id_fkey
    foreign key (school_id, organization_id)
    references public.schools (id, organization_id)
    on delete restrict,
  constraint payroll_entries_compensation_type_check
    check (compensation_type in ('monthly_salary', 'per_lesson', 'hourly', 'manual', 'custom')),
  constraint payroll_entries_compensation_unit_check
    check (compensation_unit in ('month', 'lesson', 'hour', 'manual', 'custom')),
  constraint payroll_entries_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint payroll_entries_amounts_check
    check (
      compensation_amount >= 0
      and base_amount >= 0
      and gross_amount >= 0
      and deductions_amount >= 0
      and net_payable >= 0
    ),
  constraint payroll_entries_status_check
    check (status in ('draft', 'finalized', 'paid', 'void'))
);

create unique index if not exists payroll_entries_period_staff_uidx
on public.payroll_entries (payroll_period_id, staff_id);

create index if not exists payroll_entries_staff_idx
on public.payroll_entries (staff_id, created_at desc);

create index if not exists payroll_entries_period_status_idx
on public.payroll_entries (payroll_period_id, status);

comment on table public.payroll_entries is
'Historical payroll calculation snapshots. Amounts are stored on the entry and are not recalculated when compensation terms change.';

create table if not exists public.payroll_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  payroll_entry_id uuid not null,
  payment_date date not null,
  amount numeric(12, 2) not null,
  currency char(3) not null default 'JPY',
  payment_method text not null default 'bank_transfer',
  reference text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_payments_payroll_entry_id_organization_id_fkey
    foreign key (payroll_entry_id, organization_id)
    references public.payroll_entries (id, organization_id)
    on delete restrict,
  constraint payroll_payments_amount_check
    check (amount > 0),
  constraint payroll_payments_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint payroll_payments_method_check
    check (payment_method in ('bank_transfer', 'cash', 'manual', 'other'))
);

create index if not exists payroll_payments_entry_idx
on public.payroll_payments (payroll_entry_id, payment_date desc);

drop trigger if exists staff_compensation_terms_set_updated_at on public.staff_compensation_terms;
create trigger staff_compensation_terms_set_updated_at
before update on public.staff_compensation_terms
for each row execute function public.set_updated_at();

drop trigger if exists payroll_periods_set_updated_at on public.payroll_periods;
create trigger payroll_periods_set_updated_at
before update on public.payroll_periods
for each row execute function public.set_updated_at();

drop trigger if exists payroll_entries_set_updated_at on public.payroll_entries;
create trigger payroll_entries_set_updated_at
before update on public.payroll_entries
for each row execute function public.set_updated_at();

drop trigger if exists payroll_payments_set_updated_at on public.payroll_payments;
create trigger payroll_payments_set_updated_at
before update on public.payroll_payments
for each row execute function public.set_updated_at();

create or replace function public.can_manage_payroll_org(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin();
$$;

revoke all on function public.can_manage_payroll_org(uuid) from public, anon;
grant execute on function public.can_manage_payroll_org(uuid) to authenticated;

create or replace function public.can_manage_payroll_period(p_payroll_period_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.payroll_periods pp
    where pp.id = p_payroll_period_id
      and public.can_manage_payroll_org(pp.organization_id)
  );
$$;

revoke all on function public.can_manage_payroll_period(uuid) from public, anon;
grant execute on function public.can_manage_payroll_period(uuid) to authenticated;

create or replace function public.can_manage_payroll_entry(p_payroll_entry_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.payroll_entries pe
    where pe.id = p_payroll_entry_id
      and public.can_manage_payroll_org(pe.organization_id)
  );
$$;

revoke all on function public.can_manage_payroll_entry(uuid) from public, anon;
grant execute on function public.can_manage_payroll_entry(uuid) to authenticated;

alter table public.staff_compensation_terms enable row level security;
alter table public.payroll_periods enable row level security;
alter table public.payroll_entries enable row level security;
alter table public.payroll_payments enable row level security;

revoke all on public.staff_compensation_terms from anon, authenticated;
revoke all on public.payroll_periods from anon, authenticated;
revoke all on public.payroll_entries from anon, authenticated;
revoke all on public.payroll_payments from anon, authenticated;

grant select, insert, update, delete on public.staff_compensation_terms to authenticated;
grant select, insert, update, delete on public.payroll_periods to authenticated;
grant select, insert, update, delete on public.payroll_entries to authenticated;
grant select, insert, update, delete on public.payroll_payments to authenticated;

grant all on public.staff_compensation_terms to service_role;
grant all on public.payroll_periods to service_role;
grant all on public.payroll_entries to service_role;
grant all on public.payroll_payments to service_role;

drop policy if exists "staff_compensation_terms_payroll_access" on public.staff_compensation_terms;
create policy "staff_compensation_terms_payroll_access"
on public.staff_compensation_terms
for all
to authenticated
using (public.can_manage_payroll_org(organization_id))
with check (public.can_manage_payroll_org(organization_id));

drop policy if exists "payroll_periods_payroll_access" on public.payroll_periods;
create policy "payroll_periods_payroll_access"
on public.payroll_periods
for all
to authenticated
using (public.can_manage_payroll_org(organization_id))
with check (public.can_manage_payroll_org(organization_id));

drop policy if exists "payroll_entries_payroll_access" on public.payroll_entries;
create policy "payroll_entries_payroll_access"
on public.payroll_entries
for all
to authenticated
using (public.can_manage_payroll_org(organization_id))
with check (public.can_manage_payroll_org(organization_id));

drop policy if exists "payroll_payments_payroll_access" on public.payroll_payments;
create policy "payroll_payments_payroll_access"
on public.payroll_payments
for all
to authenticated
using (public.can_manage_payroll_org(organization_id))
with check (public.can_manage_payroll_org(organization_id));

create or replace function public.default_compensation_unit(p_compensation_type text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_compensation_type
    when 'monthly_salary' then 'month'
    when 'per_lesson' then 'lesson'
    when 'hourly' then 'hour'
    when 'custom' then 'custom'
    else 'manual'
  end;
$$;

revoke all on function public.default_compensation_unit(text) from public, anon;
grant execute on function public.default_compensation_unit(text) to authenticated;

create or replace function public.create_staff_compensation_term_mvp(
  p_staff_id uuid,
  p_school_id uuid default null,
  p_compensation_type text default 'manual',
  p_amount numeric default 0,
  p_unit text default null,
  p_currency text default 'JPY',
  p_effective_from date default null,
  p_effective_to date default null,
  p_notes text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_compensation_type text;
  v_currency char(3);
  v_staff public.staff%rowtype;
  v_term_id uuid;
  v_unit text;
begin
  select * into v_staff
  from public.staff st
  where st.id = p_staff_id;

  if not found then
    raise exception 'Staff member % was not found.', p_staff_id;
  end if;

  if not public.can_manage_payroll_org(v_staff.organization_id) then
    raise exception 'You do not have permission to manage payroll for this organization.';
  end if;

  if p_school_id is not null and not exists (
    select 1
    from public.schools s
    where s.id = p_school_id
      and s.organization_id = v_staff.organization_id
  ) then
    raise exception 'School % does not belong to this staff organization.', p_school_id;
  end if;

  v_compensation_type = coalesce(nullif(trim(coalesce(p_compensation_type, '')), ''), 'manual');
  if v_compensation_type not in ('monthly_salary', 'per_lesson', 'hourly', 'manual', 'custom') then
    raise exception 'Unsupported compensation type %. Use monthly_salary, per_lesson, hourly, manual, or custom.', v_compensation_type;
  end if;

  v_unit = coalesce(nullif(trim(coalesce(p_unit, '')), ''), public.default_compensation_unit(v_compensation_type));
  if v_unit not in ('month', 'lesson', 'hour', 'manual', 'custom') then
    raise exception 'Unsupported compensation unit %. Use month, lesson, hour, manual, or custom.', v_unit;
  end if;

  v_currency = upper(coalesce(nullif(trim(coalesce(p_currency, '')), ''), 'JPY'))::char(3);
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be a three-letter code.';
  end if;

  if p_effective_from is null then
    raise exception 'Effective from date is required.';
  end if;

  if p_effective_to is not null and p_effective_to < p_effective_from then
    raise exception 'Effective to date cannot be before effective from date.';
  end if;

  if coalesce(p_amount, 0) < 0 then
    raise exception 'Compensation amount cannot be negative.';
  end if;

  insert into public.staff_compensation_terms (
    organization_id,
    school_id,
    staff_id,
    compensation_type,
    amount,
    unit,
    currency,
    effective_from,
    effective_to,
    notes
  )
  values (
    v_staff.organization_id,
    p_school_id,
    p_staff_id,
    v_compensation_type,
    coalesce(p_amount, 0),
    v_unit,
    v_currency,
    p_effective_from,
    p_effective_to,
    nullif(trim(coalesce(p_notes, '')), '')
  )
  returning id into v_term_id;

  return v_term_id;
end;
$$;

revoke all on function public.create_staff_compensation_term_mvp(
  uuid,
  uuid,
  text,
  numeric,
  text,
  text,
  date,
  date,
  text
) from public, anon;

grant execute on function public.create_staff_compensation_term_mvp(
  uuid,
  uuid,
  text,
  numeric,
  text,
  text,
  date,
  date,
  text
) to authenticated;

create or replace function public.create_payroll_period_mvp(
  p_organization_id uuid,
  p_scope text default 'organization',
  p_school_id uuid default null,
  p_period_start date default null,
  p_period_end date default null,
  p_status text default 'draft',
  p_notes text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_period_id uuid;
  v_scope text;
  v_status text;
begin
  if not exists (select 1 from public.organizations o where o.id = p_organization_id) then
    raise exception 'Organization % was not found.', p_organization_id;
  end if;

  if not public.can_manage_payroll_org(p_organization_id) then
    raise exception 'You do not have permission to manage payroll for this organization.';
  end if;

  v_scope = coalesce(nullif(trim(coalesce(p_scope, '')), ''), case when p_school_id is null then 'organization' else 'school' end);
  if v_scope not in ('organization', 'school') then
    raise exception 'Unsupported payroll period scope %. Use organization or school.', v_scope;
  end if;

  if v_scope = 'organization' and p_school_id is not null then
    raise exception 'Organization-wide payroll periods cannot include a school_id.';
  end if;

  if v_scope = 'school' and p_school_id is null then
    raise exception 'School payroll periods require a school.';
  end if;

  if p_school_id is not null and not exists (
    select 1
    from public.schools s
    where s.id = p_school_id
      and s.organization_id = p_organization_id
  ) then
    raise exception 'School % does not belong to this payroll organization.', p_school_id;
  end if;

  if p_period_start is null or p_period_end is null then
    raise exception 'Payroll period start and end dates are required.';
  end if;

  if p_period_end < p_period_start then
    raise exception 'Payroll period end date cannot be before the start date.';
  end if;

  v_status = coalesce(nullif(trim(coalesce(p_status, '')), ''), 'draft');
  if v_status not in ('draft', 'finalized', 'paid') then
    raise exception 'Unsupported payroll period status %. Use draft, finalized, or paid.', v_status;
  end if;

  insert into public.payroll_periods (
    organization_id,
    school_id,
    scope,
    period_start,
    period_end,
    status,
    notes
  )
  values (
    p_organization_id,
    p_school_id,
    v_scope,
    p_period_start,
    p_period_end,
    v_status,
    nullif(trim(coalesce(p_notes, '')), '')
  )
  returning id into v_period_id;

  return v_period_id;
end;
$$;

revoke all on function public.create_payroll_period_mvp(uuid, text, uuid, date, date, text, text) from public, anon;
grant execute on function public.create_payroll_period_mvp(uuid, text, uuid, date, date, text, text) to authenticated;

create or replace function public.update_payroll_period_mvp(
  p_payroll_period_id uuid,
  p_status text default 'draft',
  p_notes text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_period public.payroll_periods%rowtype;
  v_status text;
begin
  select * into v_period
  from public.payroll_periods pp
  where pp.id = p_payroll_period_id
  for update;

  if not found then
    raise exception 'Payroll period % was not found.', p_payroll_period_id;
  end if;

  if not public.can_manage_payroll_org(v_period.organization_id) then
    raise exception 'You do not have permission to manage payroll for this organization.';
  end if;

  v_status = coalesce(nullif(trim(coalesce(p_status, '')), ''), 'draft');
  if v_status not in ('draft', 'finalized', 'paid') then
    raise exception 'Unsupported payroll period status %. Use draft, finalized, or paid.', v_status;
  end if;

  update public.payroll_periods
  set status = v_status,
      notes = nullif(trim(coalesce(p_notes, '')), '')
  where id = p_payroll_period_id;

  return p_payroll_period_id;
end;
$$;

revoke all on function public.update_payroll_period_mvp(uuid, text, text) from public, anon;
grant execute on function public.update_payroll_period_mvp(uuid, text, text) to authenticated;

create or replace function public.validate_payroll_entry_scope(
  p_period public.payroll_periods,
  p_staff public.staff
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_period.organization_id <> p_staff.organization_id then
    raise exception 'Staff member does not belong to this payroll period organization.';
  end if;

  if p_period.school_id is not null and not exists (
    select 1
    from public.staff_school_assignments ssa
    where ssa.staff_id = p_staff.id
      and ssa.school_id = p_period.school_id
  ) then
    raise exception 'Staff member is not assigned to this payroll period school.';
  end if;
end;
$$;

revoke all on function public.validate_payroll_entry_scope(public.payroll_periods, public.staff) from public, anon, authenticated;

create or replace function public.create_payroll_entry_mvp(
  p_payroll_period_id uuid,
  p_staff_id uuid,
  p_compensation_term_id uuid default null,
  p_currency text default 'JPY',
  p_base_amount numeric default 0,
  p_adjustments_amount numeric default 0,
  p_gross_amount numeric default 0,
  p_deductions_amount numeric default 0,
  p_net_payable numeric default 0,
  p_status text default 'draft',
  p_notes text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_compensation_amount numeric(12, 2) := 0;
  v_compensation_type text := 'manual';
  v_compensation_unit text := 'manual';
  v_currency char(3);
  v_entry_id uuid;
  v_period public.payroll_periods%rowtype;
  v_staff public.staff%rowtype;
  v_status text;
  v_term public.staff_compensation_terms%rowtype;
begin
  select * into v_period
  from public.payroll_periods pp
  where pp.id = p_payroll_period_id;

  if not found then
    raise exception 'Payroll period % was not found.', p_payroll_period_id;
  end if;

  if not public.can_manage_payroll_org(v_period.organization_id) then
    raise exception 'You do not have permission to manage payroll for this organization.';
  end if;

  select * into v_staff
  from public.staff st
  where st.id = p_staff_id;

  if not found then
    raise exception 'Staff member % was not found.', p_staff_id;
  end if;

  perform public.validate_payroll_entry_scope(v_period, v_staff);

  v_currency = upper(coalesce(nullif(trim(coalesce(p_currency, '')), ''), 'JPY'))::char(3);
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be a three-letter code.';
  end if;

  if p_compensation_term_id is not null then
    select * into v_term
    from public.staff_compensation_terms sct
    where sct.id = p_compensation_term_id
      and sct.staff_id = p_staff_id
      and sct.organization_id = v_period.organization_id;

    if not found then
      raise exception 'Compensation term % was not found for this staff member.', p_compensation_term_id;
    end if;

    if v_period.school_id is not null and v_term.school_id is not null and v_term.school_id <> v_period.school_id then
      raise exception 'Compensation term school does not match this payroll period school.';
    end if;

    v_compensation_type = v_term.compensation_type;
    v_compensation_amount = v_term.amount;
    v_compensation_unit = v_term.unit;
    v_currency = v_term.currency;
  end if;

  if coalesce(p_base_amount, 0) < 0
    or coalesce(p_gross_amount, 0) < 0
    or coalesce(p_deductions_amount, 0) < 0
    or coalesce(p_net_payable, 0) < 0
  then
    raise exception 'Payroll amounts cannot be negative except adjustments.';
  end if;

  v_status = coalesce(nullif(trim(coalesce(p_status, '')), ''), 'draft');
  if v_status not in ('draft', 'finalized', 'paid', 'void') then
    raise exception 'Unsupported payroll entry status %. Use draft, finalized, paid, or void.', v_status;
  end if;

  insert into public.payroll_entries (
    organization_id,
    school_id,
    payroll_period_id,
    staff_id,
    compensation_term_id,
    compensation_type,
    compensation_amount,
    compensation_unit,
    currency,
    base_amount,
    adjustments_amount,
    gross_amount,
    deductions_amount,
    net_payable,
    status,
    notes
  )
  values (
    v_period.organization_id,
    v_period.school_id,
    p_payroll_period_id,
    p_staff_id,
    p_compensation_term_id,
    v_compensation_type,
    v_compensation_amount,
    v_compensation_unit,
    v_currency,
    coalesce(p_base_amount, 0),
    coalesce(p_adjustments_amount, 0),
    coalesce(p_gross_amount, 0),
    coalesce(p_deductions_amount, 0),
    coalesce(p_net_payable, 0),
    v_status,
    nullif(trim(coalesce(p_notes, '')), '')
  )
  returning id into v_entry_id;

  return v_entry_id;
end;
$$;

revoke all on function public.create_payroll_entry_mvp(
  uuid,
  uuid,
  uuid,
  text,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  text,
  text
) from public, anon;

grant execute on function public.create_payroll_entry_mvp(
  uuid,
  uuid,
  uuid,
  text,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  text,
  text
) to authenticated;

create or replace function public.update_payroll_entry_mvp(
  p_payroll_entry_id uuid,
  p_compensation_term_id uuid default null,
  p_currency text default 'JPY',
  p_base_amount numeric default 0,
  p_adjustments_amount numeric default 0,
  p_gross_amount numeric default 0,
  p_deductions_amount numeric default 0,
  p_net_payable numeric default 0,
  p_status text default 'draft',
  p_notes text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_compensation_amount numeric(12, 2) := 0;
  v_compensation_type text := 'manual';
  v_compensation_unit text := 'manual';
  v_currency char(3);
  v_entry public.payroll_entries%rowtype;
  v_period public.payroll_periods%rowtype;
  v_status text;
  v_term public.staff_compensation_terms%rowtype;
begin
  select * into v_entry
  from public.payroll_entries pe
  where pe.id = p_payroll_entry_id
  for update;

  if not found then
    raise exception 'Payroll entry % was not found.', p_payroll_entry_id;
  end if;

  if not public.can_manage_payroll_org(v_entry.organization_id) then
    raise exception 'You do not have permission to manage payroll for this organization.';
  end if;

  select * into v_period
  from public.payroll_periods pp
  where pp.id = v_entry.payroll_period_id;

  v_currency = upper(coalesce(nullif(trim(coalesce(p_currency, '')), ''), v_entry.currency::text, 'JPY'))::char(3);
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be a three-letter code.';
  end if;

  if p_compensation_term_id is not null then
    select * into v_term
    from public.staff_compensation_terms sct
    where sct.id = p_compensation_term_id
      and sct.staff_id = v_entry.staff_id
      and sct.organization_id = v_entry.organization_id;

    if not found then
      raise exception 'Compensation term % was not found for this staff member.', p_compensation_term_id;
    end if;

    if v_period.school_id is not null and v_term.school_id is not null and v_term.school_id <> v_period.school_id then
      raise exception 'Compensation term school does not match this payroll period school.';
    end if;

    v_compensation_type = v_term.compensation_type;
    v_compensation_amount = v_term.amount;
    v_compensation_unit = v_term.unit;
    v_currency = v_term.currency;
  end if;

  if coalesce(p_base_amount, 0) < 0
    or coalesce(p_gross_amount, 0) < 0
    or coalesce(p_deductions_amount, 0) < 0
    or coalesce(p_net_payable, 0) < 0
  then
    raise exception 'Payroll amounts cannot be negative except adjustments.';
  end if;

  v_status = coalesce(nullif(trim(coalesce(p_status, '')), ''), 'draft');
  if v_status not in ('draft', 'finalized', 'paid', 'void') then
    raise exception 'Unsupported payroll entry status %. Use draft, finalized, paid, or void.', v_status;
  end if;

  update public.payroll_entries
  set compensation_term_id = p_compensation_term_id,
      compensation_type = v_compensation_type,
      compensation_amount = v_compensation_amount,
      compensation_unit = v_compensation_unit,
      currency = v_currency,
      base_amount = coalesce(p_base_amount, 0),
      adjustments_amount = coalesce(p_adjustments_amount, 0),
      gross_amount = coalesce(p_gross_amount, 0),
      deductions_amount = coalesce(p_deductions_amount, 0),
      net_payable = coalesce(p_net_payable, 0),
      status = v_status,
      notes = nullif(trim(coalesce(p_notes, '')), '')
  where id = p_payroll_entry_id;

  return p_payroll_entry_id;
end;
$$;

revoke all on function public.update_payroll_entry_mvp(
  uuid,
  uuid,
  text,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  text,
  text
) from public, anon;

grant execute on function public.update_payroll_entry_mvp(
  uuid,
  uuid,
  text,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  text,
  text
) to authenticated;

create or replace function public.record_payroll_payment_mvp(
  p_payroll_entry_id uuid,
  p_payment_date date default null,
  p_amount numeric default null,
  p_payment_method text default 'bank_transfer',
  p_reference text default null,
  p_notes text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_entry public.payroll_entries%rowtype;
  v_method text;
  v_paid_total numeric(12, 2);
  v_payment_id uuid;
begin
  select * into v_entry
  from public.payroll_entries pe
  where pe.id = p_payroll_entry_id
  for update;

  if not found then
    raise exception 'Payroll entry % was not found.', p_payroll_entry_id;
  end if;

  if not public.can_manage_payroll_org(v_entry.organization_id) then
    raise exception 'You do not have permission to manage payroll for this organization.';
  end if;

  if p_payment_date is null then
    raise exception 'Payment date is required.';
  end if;

  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;

  v_method = coalesce(nullif(trim(coalesce(p_payment_method, '')), ''), 'bank_transfer');
  if v_method not in ('bank_transfer', 'cash', 'manual', 'other') then
    raise exception 'Unsupported payment method %. Use bank_transfer, cash, manual, or other.', v_method;
  end if;

  insert into public.payroll_payments (
    organization_id,
    payroll_entry_id,
    payment_date,
    amount,
    currency,
    payment_method,
    reference,
    notes
  )
  values (
    v_entry.organization_id,
    p_payroll_entry_id,
    p_payment_date,
    p_amount,
    v_entry.currency,
    v_method,
    nullif(trim(coalesce(p_reference, '')), ''),
    nullif(trim(coalesce(p_notes, '')), '')
  )
  returning id into v_payment_id;

  select coalesce(sum(pp.amount), 0) into v_paid_total
  from public.payroll_payments pp
  where pp.payroll_entry_id = p_payroll_entry_id;

  if v_entry.net_payable > 0 and v_paid_total >= v_entry.net_payable then
    update public.payroll_entries
    set status = 'paid'
    where id = p_payroll_entry_id
      and status <> 'void';
  end if;

  return v_payment_id;
end;
$$;

revoke all on function public.record_payroll_payment_mvp(uuid, date, numeric, text, text, text) from public, anon;
grant execute on function public.record_payroll_payment_mvp(uuid, date, numeric, text, text, text) to authenticated;

notify pgrst, 'reload schema';
