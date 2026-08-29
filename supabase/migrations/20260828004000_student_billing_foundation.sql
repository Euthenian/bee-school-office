create table if not exists public.student_charges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  school_id uuid not null,
  student_id uuid not null,
  billing_period_start date,
  billing_period_end date,
  charge_type text not null,
  description text not null,
  amount numeric(12, 2) not null,
  currency char(3) not null default 'JPY',
  due_date date,
  status text not null default 'open',
  source_type text,
  source_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id, school_id, student_id),
  constraint student_charges_student_fkey
    foreign key (student_id, organization_id, school_id)
    references public.students (id, organization_id, school_id)
    on delete restrict,
  constraint student_charges_type_check
    check (charge_type in ('tuition', 'entrance_fee', 'materials', 'trial_lesson', 'private_lesson', 'deposit', 'adjustment', 'other')),
  constraint student_charges_amount_check
    check (amount >= 0 or charge_type = 'adjustment'),
  constraint student_charges_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint student_charges_status_check
    check (status in ('draft', 'open', 'partially_paid', 'paid', 'void', 'cancelled')),
  constraint student_charges_billing_period_check
    check (billing_period_end is null or billing_period_start is null or billing_period_end >= billing_period_start)
);

create index if not exists student_charges_student_due_idx
on public.student_charges (student_id, due_date, status);

create index if not exists student_charges_school_status_due_idx
on public.student_charges (school_id, status, due_date);

create index if not exists student_charges_source_idx
on public.student_charges (source_type, source_id);

comment on table public.student_charges is
'Amounts owed by students. Actual payments are stored separately and connected through allocations.';

create table if not exists public.student_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  school_id uuid not null,
  student_id uuid not null,
  payment_date date not null,
  amount numeric(12, 2) not null,
  currency char(3) not null default 'JPY',
  payment_method text not null default 'bank_transfer',
  reference text,
  status text not null default 'received',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id, school_id, student_id),
  constraint student_payments_student_fkey
    foreign key (student_id, organization_id, school_id)
    references public.students (id, organization_id, school_id)
    on delete restrict,
  constraint student_payments_amount_check
    check (amount > 0),
  constraint student_payments_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint student_payments_method_check
    check (payment_method in ('bank_transfer', 'bank_debit', 'cash', 'card', 'other')),
  constraint student_payments_status_check
    check (status in ('received', 'partial', 'allocated', 'refunded', 'void'))
);

create index if not exists student_payments_student_date_idx
on public.student_payments (student_id, payment_date desc);

create index if not exists student_payments_school_status_date_idx
on public.student_payments (school_id, status, payment_date desc);

comment on table public.student_payments is
'Actual payments received from students or customers. Allocations determine which charges a payment covers.';

create table if not exists public.student_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  school_id uuid not null,
  student_id uuid not null,
  student_payment_id uuid not null,
  student_charge_id uuid not null,
  amount numeric(12, 2) not null,
  currency char(3) not null default 'JPY',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_allocations_payment_scope_fkey
    foreign key (student_payment_id, organization_id, school_id, student_id)
    references public.student_payments (id, organization_id, school_id, student_id)
    on delete restrict,
  constraint student_allocations_charge_scope_fkey
    foreign key (student_charge_id, organization_id, school_id, student_id)
    references public.student_charges (id, organization_id, school_id, student_id)
    on delete restrict,
  constraint student_payment_allocations_amount_check
    check (amount > 0),
  constraint student_payment_allocations_currency_check
    check (currency ~ '^[A-Z]{3}$')
);

create index if not exists student_payment_allocations_payment_idx
on public.student_payment_allocations (student_payment_id);

create index if not exists student_payment_allocations_charge_idx
on public.student_payment_allocations (student_charge_id);

comment on table public.student_payment_allocations is
'Auditable allocation rows connecting actual payments to one or more student charges. Partial and split payments are supported.';

create table if not exists public.student_refunds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  school_id uuid not null,
  student_id uuid not null,
  student_payment_id uuid,
  refund_date date not null,
  amount numeric(12, 2) not null,
  currency char(3) not null default 'JPY',
  refund_method text not null default 'bank_transfer',
  reference text,
  status text not null default 'recorded',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_refunds_student_fkey
    foreign key (student_id, organization_id, school_id)
    references public.students (id, organization_id, school_id)
    on delete restrict,
  constraint student_refunds_payment_scope_fkey
    foreign key (student_payment_id, organization_id, school_id, student_id)
    references public.student_payments (id, organization_id, school_id, student_id)
    on delete restrict,
  constraint student_refunds_amount_check
    check (amount > 0),
  constraint student_refunds_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint student_refunds_method_check
    check (refund_method in ('bank_transfer', 'cash', 'card', 'other')),
  constraint student_refunds_status_check
    check (status in ('recorded', 'void'))
);

create index if not exists student_refunds_student_date_idx
on public.student_refunds (student_id, refund_date desc);

create index if not exists student_refunds_payment_idx
on public.student_refunds (student_payment_id);

comment on table public.student_refunds is
'Auditable refund records. Historical charges and payments should be voided or corrected by adjustment/refund records instead of deleted.';

drop trigger if exists student_charges_set_updated_at on public.student_charges;
create trigger student_charges_set_updated_at
before update on public.student_charges
for each row execute function public.set_updated_at();

drop trigger if exists student_payments_set_updated_at on public.student_payments;
create trigger student_payments_set_updated_at
before update on public.student_payments
for each row execute function public.set_updated_at();

drop trigger if exists student_payment_allocations_set_updated_at on public.student_payment_allocations;
create trigger student_payment_allocations_set_updated_at
before update on public.student_payment_allocations
for each row execute function public.set_updated_at();

drop trigger if exists student_refunds_set_updated_at on public.student_refunds;
create trigger student_refunds_set_updated_at
before update on public.student_refunds
for each row execute function public.set_updated_at();

create or replace function public.can_manage_student_billing_org(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin();
$$;

revoke all on function public.can_manage_student_billing_org(uuid) from public, anon;
grant execute on function public.can_manage_student_billing_org(uuid) to authenticated;

create or replace function public.can_manage_student_billing_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.students st
    where st.id = p_student_id
      and public.can_manage_student_billing_org(st.organization_id)
  );
$$;

revoke all on function public.can_manage_student_billing_student(uuid) from public, anon;
grant execute on function public.can_manage_student_billing_student(uuid) to authenticated;

alter table public.student_charges enable row level security;
alter table public.student_payments enable row level security;
alter table public.student_payment_allocations enable row level security;
alter table public.student_refunds enable row level security;

revoke all on public.student_charges from anon, authenticated;
revoke all on public.student_payments from anon, authenticated;
revoke all on public.student_payment_allocations from anon, authenticated;
revoke all on public.student_refunds from anon, authenticated;

grant select, insert, update on public.student_charges to authenticated;
grant select, insert, update on public.student_payments to authenticated;
grant select, insert, update on public.student_payment_allocations to authenticated;
grant select, insert, update on public.student_refunds to authenticated;

grant all on public.student_charges to service_role;
grant all on public.student_payments to service_role;
grant all on public.student_payment_allocations to service_role;
grant all on public.student_refunds to service_role;

drop policy if exists "student_charges_billing_access" on public.student_charges;
create policy "student_charges_billing_access"
on public.student_charges
for all
to authenticated
using (public.can_manage_student_billing_org(organization_id))
with check (public.can_manage_student_billing_org(organization_id));

drop policy if exists "student_payments_billing_access" on public.student_payments;
create policy "student_payments_billing_access"
on public.student_payments
for all
to authenticated
using (public.can_manage_student_billing_org(organization_id))
with check (public.can_manage_student_billing_org(organization_id));

drop policy if exists "student_payment_allocations_billing_access" on public.student_payment_allocations;
create policy "student_payment_allocations_billing_access"
on public.student_payment_allocations
for all
to authenticated
using (public.can_manage_student_billing_org(organization_id))
with check (public.can_manage_student_billing_org(organization_id));

drop policy if exists "student_refunds_billing_access" on public.student_refunds;
create policy "student_refunds_billing_access"
on public.student_refunds
for all
to authenticated
using (public.can_manage_student_billing_org(organization_id))
with check (public.can_manage_student_billing_org(organization_id));

create or replace function public.refresh_student_billing_statuses(p_student_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_student public.students%rowtype;
begin
  select * into v_student
  from public.students st
  where st.id = p_student_id;

  if not found then
    raise exception 'Student % was not found.', p_student_id;
  end if;

  if not public.can_manage_student_billing_org(v_student.organization_id) then
    raise exception 'You do not have permission to manage billing for this organization.';
  end if;

  with charge_totals as (
    select
      sc.id,
      coalesce(sum(spa.amount) filter (
        where sp.status <> 'void'
      ), 0) as allocated_amount
    from public.student_charges sc
    left join public.student_payment_allocations spa on spa.student_charge_id = sc.id
    left join public.student_payments sp on sp.id = spa.student_payment_id
    where sc.student_id = p_student_id
    group by sc.id
  )
  update public.student_charges sc
  set status = case
    when sc.amount > 0 and ct.allocated_amount >= sc.amount then 'paid'
    when sc.amount > 0 and ct.allocated_amount > 0 then 'partially_paid'
    else 'open'
  end
  from charge_totals ct
  where sc.id = ct.id
    and sc.status not in ('draft', 'void', 'cancelled')
    and sc.amount > 0;

  with payment_allocation_totals as (
    select
      spa.student_payment_id,
      coalesce(sum(spa.amount), 0) as allocated_amount
    from public.student_payment_allocations spa
    group by spa.student_payment_id
  ),
  payment_refund_totals as (
    select
      sr.student_payment_id,
      coalesce(sum(sr.amount), 0) as refunded_amount
    from public.student_refunds sr
    where sr.status <> 'void'
      and sr.student_payment_id is not null
    group by sr.student_payment_id
  )
  update public.student_payments sp
  set status = case
    when coalesce(prt.refunded_amount, 0) >= sp.amount then 'refunded'
    when coalesce(pat.allocated_amount, 0) + coalesce(prt.refunded_amount, 0) >= sp.amount then 'allocated'
    when coalesce(pat.allocated_amount, 0) + coalesce(prt.refunded_amount, 0) > 0 then 'partial'
    else 'received'
  end
  from payment_allocation_totals pat
  full join payment_refund_totals prt on prt.student_payment_id = pat.student_payment_id
  where sp.id = coalesce(pat.student_payment_id, prt.student_payment_id)
    and sp.status <> 'void';
end;
$$;

revoke all on function public.refresh_student_billing_statuses(uuid) from public, anon;
grant execute on function public.refresh_student_billing_statuses(uuid) to authenticated;

create or replace function public.validate_student_payment_allocation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_charge public.student_charges%rowtype;
  v_charge_allocated numeric(12, 2);
  v_charge_available numeric(12, 2);
  v_payment public.student_payments%rowtype;
  v_payment_allocated numeric(12, 2);
  v_payment_refunded numeric(12, 2);
  v_payment_available numeric(12, 2);
begin
  select * into v_payment
  from public.student_payments sp
  where sp.id = new.student_payment_id
  for update;

  if not found then
    raise exception 'Payment % was not found.', new.student_payment_id;
  end if;

  select * into v_charge
  from public.student_charges sc
  where sc.id = new.student_charge_id
  for update;

  if not found then
    raise exception 'Charge % was not found.', new.student_charge_id;
  end if;

  if not public.can_manage_student_billing_org(v_payment.organization_id) then
    raise exception 'You do not have permission to manage billing for this organization.';
  end if;

  if v_payment.organization_id <> v_charge.organization_id
    or v_payment.school_id <> v_charge.school_id
    or v_payment.student_id <> v_charge.student_id
  then
    raise exception 'Payment and charge must belong to the same student tenant scope.';
  end if;

  if v_payment.status in ('void', 'refunded') then
    raise exception 'Void or fully refunded payments cannot be allocated.';
  end if;

  if v_charge.status in ('draft', 'void', 'cancelled') then
    raise exception 'Draft, void, or cancelled charges cannot receive allocations.';
  end if;

  if v_charge.amount <= 0 then
    raise exception 'Only positive charges can receive payment allocations.';
  end if;

  if v_payment.currency <> v_charge.currency then
    raise exception 'Payment and charge currencies must match.';
  end if;

  new.organization_id = v_payment.organization_id;
  new.school_id = v_payment.school_id;
  new.student_id = v_payment.student_id;
  new.currency = v_payment.currency;

  select coalesce(sum(spa.amount), 0) into v_payment_allocated
  from public.student_payment_allocations spa
  where spa.student_payment_id = new.student_payment_id
    and spa.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

  select coalesce(sum(sr.amount), 0) into v_payment_refunded
  from public.student_refunds sr
  where sr.student_payment_id = new.student_payment_id
    and sr.status <> 'void';

  select coalesce(sum(spa.amount), 0) into v_charge_allocated
  from public.student_payment_allocations spa
  where spa.student_charge_id = new.student_charge_id
    and spa.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

  v_payment_available = v_payment.amount - v_payment_allocated - v_payment_refunded;
  v_charge_available = v_charge.amount - v_charge_allocated;

  if new.amount > v_payment_available then
    raise exception 'Allocation exceeds available payment balance.';
  end if;

  if new.amount > v_charge_available then
    raise exception 'Allocation exceeds remaining charge balance.';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_student_payment_allocation() from public, anon, authenticated;

drop trigger if exists student_payment_allocations_validate on public.student_payment_allocations;
create trigger student_payment_allocations_validate
before insert or update on public.student_payment_allocations
for each row execute function public.validate_student_payment_allocation();

create or replace function public.validate_student_refund()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_allocated numeric(12, 2);
  v_existing_refunded numeric(12, 2);
  v_payment public.student_payments%rowtype;
  v_student public.students%rowtype;
begin
  select * into v_student
  from public.students st
  where st.id = new.student_id;

  if not found then
    raise exception 'Student % was not found.', new.student_id;
  end if;

  if not public.can_manage_student_billing_org(v_student.organization_id) then
    raise exception 'You do not have permission to manage billing for this organization.';
  end if;

  if new.student_payment_id is null then
    new.organization_id = v_student.organization_id;
    new.school_id = v_student.school_id;
    return new;
  end if;

  select * into v_payment
  from public.student_payments sp
  where sp.id = new.student_payment_id
  for update;

  if not found then
    raise exception 'Payment % was not found.', new.student_payment_id;
  end if;

  if v_payment.organization_id <> v_student.organization_id
    or v_payment.school_id <> v_student.school_id
    or v_payment.student_id <> v_student.id
  then
    raise exception 'Refund payment must belong to the same student tenant scope.';
  end if;

  if v_payment.status = 'void' then
    raise exception 'Void payments cannot be refunded.';
  end if;

  if new.currency <> v_payment.currency then
    raise exception 'Refund currency must match the payment currency.';
  end if;

  select coalesce(sum(spa.amount), 0) into v_allocated
  from public.student_payment_allocations spa
  where spa.student_payment_id = new.student_payment_id;

  select coalesce(sum(sr.amount), 0) into v_existing_refunded
  from public.student_refunds sr
  where sr.student_payment_id = new.student_payment_id
    and sr.status <> 'void'
    and sr.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if new.amount + v_existing_refunded > v_payment.amount - v_allocated then
    raise exception 'Refund exceeds unallocated payment balance.';
  end if;

  new.organization_id = v_payment.organization_id;
  new.school_id = v_payment.school_id;
  new.student_id = v_payment.student_id;
  new.currency = v_payment.currency;

  return new;
end;
$$;

revoke all on function public.validate_student_refund() from public, anon, authenticated;

drop trigger if exists student_refunds_validate on public.student_refunds;
create trigger student_refunds_validate
before insert or update on public.student_refunds
for each row execute function public.validate_student_refund();

create or replace function public.create_student_charge_mvp(
  p_student_id uuid,
  p_billing_period_start date default null,
  p_billing_period_end date default null,
  p_charge_type text default 'other',
  p_description text default null,
  p_amount numeric default 0,
  p_currency text default 'JPY',
  p_due_date date default null,
  p_status text default 'open',
  p_source_type text default null,
  p_source_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_amount numeric(12, 2);
  v_charge_id uuid;
  v_charge_type text;
  v_currency char(3);
  v_status text;
  v_student public.students%rowtype;
begin
  select * into v_student
  from public.students st
  where st.id = p_student_id;

  if not found then
    raise exception 'Student % was not found.', p_student_id;
  end if;

  if not public.can_manage_student_billing_org(v_student.organization_id) then
    raise exception 'You do not have permission to manage billing for this organization.';
  end if;

  if nullif(trim(coalesce(p_description, '')), '') is null then
    raise exception 'Charge description is required.';
  end if;

  v_charge_type = coalesce(nullif(trim(coalesce(p_charge_type, '')), ''), 'other');
  if v_charge_type not in ('tuition', 'entrance_fee', 'materials', 'trial_lesson', 'private_lesson', 'deposit', 'adjustment', 'other') then
    raise exception 'Unsupported charge type %. Use tuition, entrance_fee, materials, trial_lesson, private_lesson, deposit, adjustment, or other.', v_charge_type;
  end if;

  v_amount = coalesce(p_amount, 0);
  if v_amount < 0 and v_charge_type <> 'adjustment' then
    raise exception 'Only adjustment charges may use negative amounts.';
  end if;

  v_currency = upper(coalesce(nullif(trim(coalesce(p_currency, '')), ''), 'JPY'))::char(3);
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be a three-letter code.';
  end if;

  v_status = coalesce(nullif(trim(coalesce(p_status, '')), ''), 'open');
  if v_status not in ('draft', 'open', 'partially_paid', 'paid', 'void', 'cancelled') then
    raise exception 'Unsupported charge status %.', v_status;
  end if;

  if p_billing_period_end is not null and p_billing_period_start is not null and p_billing_period_end < p_billing_period_start then
    raise exception 'Billing period end cannot be before billing period start.';
  end if;

  insert into public.student_charges (
    organization_id,
    school_id,
    student_id,
    billing_period_start,
    billing_period_end,
    charge_type,
    description,
    amount,
    currency,
    due_date,
    status,
    source_type,
    source_id,
    notes
  )
  values (
    v_student.organization_id,
    v_student.school_id,
    p_student_id,
    p_billing_period_start,
    p_billing_period_end,
    v_charge_type,
    trim(p_description),
    v_amount,
    v_currency,
    p_due_date,
    v_status,
    nullif(trim(coalesce(p_source_type, '')), ''),
    p_source_id,
    nullif(trim(coalesce(p_notes, '')), '')
  )
  returning id into v_charge_id;

  return v_charge_id;
end;
$$;

revoke all on function public.create_student_charge_mvp(uuid, date, date, text, text, numeric, text, date, text, text, uuid, text) from public, anon;
grant execute on function public.create_student_charge_mvp(uuid, date, date, text, text, numeric, text, date, text, text, uuid, text) to authenticated;

create or replace function public.record_student_payment_mvp(
  p_student_id uuid,
  p_payment_date date default null,
  p_amount numeric default null,
  p_currency text default 'JPY',
  p_payment_method text default 'bank_transfer',
  p_reference text default null,
  p_status text default 'received',
  p_notes text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_currency char(3);
  v_method text;
  v_payment_id uuid;
  v_status text;
  v_student public.students%rowtype;
begin
  select * into v_student
  from public.students st
  where st.id = p_student_id;

  if not found then
    raise exception 'Student % was not found.', p_student_id;
  end if;

  if not public.can_manage_student_billing_org(v_student.organization_id) then
    raise exception 'You do not have permission to manage billing for this organization.';
  end if;

  if p_payment_date is null then
    raise exception 'Payment date is required.';
  end if;

  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;

  v_currency = upper(coalesce(nullif(trim(coalesce(p_currency, '')), ''), 'JPY'))::char(3);
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be a three-letter code.';
  end if;

  v_method = coalesce(nullif(trim(coalesce(p_payment_method, '')), ''), 'bank_transfer');
  if v_method not in ('bank_transfer', 'bank_debit', 'cash', 'card', 'other') then
    raise exception 'Unsupported payment method %.', v_method;
  end if;

  v_status = coalesce(nullif(trim(coalesce(p_status, '')), ''), 'received');
  if v_status not in ('received', 'partial', 'allocated', 'refunded', 'void') then
    raise exception 'Unsupported payment status %.', v_status;
  end if;

  insert into public.student_payments (
    organization_id,
    school_id,
    student_id,
    payment_date,
    amount,
    currency,
    payment_method,
    reference,
    status,
    notes
  )
  values (
    v_student.organization_id,
    v_student.school_id,
    p_student_id,
    p_payment_date,
    p_amount,
    v_currency,
    v_method,
    nullif(trim(coalesce(p_reference, '')), ''),
    v_status,
    nullif(trim(coalesce(p_notes, '')), '')
  )
  returning id into v_payment_id;

  return v_payment_id;
end;
$$;

revoke all on function public.record_student_payment_mvp(uuid, date, numeric, text, text, text, text, text) from public, anon;
grant execute on function public.record_student_payment_mvp(uuid, date, numeric, text, text, text, text, text) to authenticated;

create or replace function public.allocate_student_payment_mvp(
  p_student_payment_id uuid,
  p_student_charge_id uuid,
  p_amount numeric default null,
  p_notes text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_allocation_id uuid;
  v_payment public.student_payments%rowtype;
begin
  select * into v_payment
  from public.student_payments sp
  where sp.id = p_student_payment_id;

  if not found then
    raise exception 'Payment % was not found.', p_student_payment_id;
  end if;

  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Allocation amount must be greater than zero.';
  end if;

  insert into public.student_payment_allocations (
    organization_id,
    school_id,
    student_id,
    student_payment_id,
    student_charge_id,
    amount,
    currency,
    notes
  )
  values (
    v_payment.organization_id,
    v_payment.school_id,
    v_payment.student_id,
    p_student_payment_id,
    p_student_charge_id,
    p_amount,
    v_payment.currency,
    nullif(trim(coalesce(p_notes, '')), '')
  )
  returning id into v_allocation_id;

  perform public.refresh_student_billing_statuses(v_payment.student_id);

  return v_allocation_id;
end;
$$;

revoke all on function public.allocate_student_payment_mvp(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.allocate_student_payment_mvp(uuid, uuid, numeric, text) to authenticated;

create or replace function public.record_student_refund_mvp(
  p_student_id uuid,
  p_student_payment_id uuid default null,
  p_refund_date date default null,
  p_amount numeric default null,
  p_currency text default 'JPY',
  p_refund_method text default 'bank_transfer',
  p_reference text default null,
  p_status text default 'recorded',
  p_notes text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_currency char(3);
  v_method text;
  v_refund_id uuid;
  v_status text;
  v_student public.students%rowtype;
begin
  select * into v_student
  from public.students st
  where st.id = p_student_id;

  if not found then
    raise exception 'Student % was not found.', p_student_id;
  end if;

  if not public.can_manage_student_billing_org(v_student.organization_id) then
    raise exception 'You do not have permission to manage billing for this organization.';
  end if;

  if p_refund_date is null then
    raise exception 'Refund date is required.';
  end if;

  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Refund amount must be greater than zero.';
  end if;

  v_currency = upper(coalesce(nullif(trim(coalesce(p_currency, '')), ''), 'JPY'))::char(3);
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be a three-letter code.';
  end if;

  v_method = coalesce(nullif(trim(coalesce(p_refund_method, '')), ''), 'bank_transfer');
  if v_method not in ('bank_transfer', 'cash', 'card', 'other') then
    raise exception 'Unsupported refund method %.', v_method;
  end if;

  v_status = coalesce(nullif(trim(coalesce(p_status, '')), ''), 'recorded');
  if v_status not in ('recorded', 'void') then
    raise exception 'Unsupported refund status %.', v_status;
  end if;

  insert into public.student_refunds (
    organization_id,
    school_id,
    student_id,
    student_payment_id,
    refund_date,
    amount,
    currency,
    refund_method,
    reference,
    status,
    notes
  )
  values (
    v_student.organization_id,
    v_student.school_id,
    p_student_id,
    p_student_payment_id,
    p_refund_date,
    p_amount,
    v_currency,
    v_method,
    nullif(trim(coalesce(p_reference, '')), ''),
    v_status,
    nullif(trim(coalesce(p_notes, '')), '')
  )
  returning id into v_refund_id;

  perform public.refresh_student_billing_statuses(p_student_id);

  return v_refund_id;
end;
$$;

revoke all on function public.record_student_refund_mvp(uuid, uuid, date, numeric, text, text, text, text, text) from public, anon;
grant execute on function public.record_student_refund_mvp(uuid, uuid, date, numeric, text, text, text, text, text) to authenticated;

create or replace function public.void_student_charge_mvp(
  p_student_charge_id uuid,
  p_notes text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_allocated numeric(12, 2);
  v_charge public.student_charges%rowtype;
begin
  select * into v_charge
  from public.student_charges sc
  where sc.id = p_student_charge_id
  for update;

  if not found then
    raise exception 'Charge % was not found.', p_student_charge_id;
  end if;

  if not public.can_manage_student_billing_org(v_charge.organization_id) then
    raise exception 'You do not have permission to manage billing for this organization.';
  end if;

  select coalesce(sum(spa.amount), 0) into v_allocated
  from public.student_payment_allocations spa
  where spa.student_charge_id = p_student_charge_id;

  if v_allocated > 0 then
    raise exception 'Allocated charges cannot be voided; use an adjustment or refund record.';
  end if;

  update public.student_charges
  set status = 'void',
      notes = nullif(trim(coalesce(p_notes, notes, '')), '')
  where id = p_student_charge_id;

  return p_student_charge_id;
end;
$$;

revoke all on function public.void_student_charge_mvp(uuid, text) from public, anon;
grant execute on function public.void_student_charge_mvp(uuid, text) to authenticated;

create or replace function public.void_student_payment_mvp(
  p_student_payment_id uuid,
  p_notes text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_allocated numeric(12, 2);
  v_payment public.student_payments%rowtype;
  v_refunded numeric(12, 2);
begin
  select * into v_payment
  from public.student_payments sp
  where sp.id = p_student_payment_id
  for update;

  if not found then
    raise exception 'Payment % was not found.', p_student_payment_id;
  end if;

  if not public.can_manage_student_billing_org(v_payment.organization_id) then
    raise exception 'You do not have permission to manage billing for this organization.';
  end if;

  select coalesce(sum(spa.amount), 0) into v_allocated
  from public.student_payment_allocations spa
  where spa.student_payment_id = p_student_payment_id;

  select coalesce(sum(sr.amount), 0) into v_refunded
  from public.student_refunds sr
  where sr.student_payment_id = p_student_payment_id
    and sr.status <> 'void';

  if v_allocated > 0 or v_refunded > 0 then
    raise exception 'Allocated or refunded payments cannot be voided.';
  end if;

  update public.student_payments
  set status = 'void',
      notes = nullif(trim(coalesce(p_notes, notes, '')), '')
  where id = p_student_payment_id;

  return p_student_payment_id;
end;
$$;

revoke all on function public.void_student_payment_mvp(uuid, text) from public, anon;
grant execute on function public.void_student_payment_mvp(uuid, text) to authenticated;

create or replace function public.get_student_billing_summary_mvp(
  p_student_id uuid,
  p_as_of_date date default current_date
)
returns table (
  organization_id uuid,
  school_id uuid,
  student_id uuid,
  currency char(3),
  total_charges numeric,
  total_payments_allocated numeric,
  outstanding_balance numeric,
  overdue_balance numeric,
  unallocated_payments numeric,
  refunds_total numeric
)
language plpgsql
stable
set search_path = public
as $$
declare
  v_student public.students%rowtype;
begin
  select * into v_student
  from public.students st
  where st.id = p_student_id;

  if not found then
    raise exception 'Student % was not found.', p_student_id;
  end if;

  if not public.can_manage_student_billing_org(v_student.organization_id) then
    raise exception 'You do not have permission to manage billing for this organization.';
  end if;

  return query
  with charge_rows as (
    select
      sc.id,
      sc.currency,
      sc.amount,
      sc.due_date,
      coalesce(sum(spa.amount) filter (
        where sp.status <> 'void'
      ), 0) as allocated_amount
    from public.student_charges sc
    left join public.student_payment_allocations spa on spa.student_charge_id = sc.id
    left join public.student_payments sp on sp.id = spa.student_payment_id
    where sc.student_id = p_student_id
      and sc.status not in ('void', 'cancelled')
    group by sc.id
  ),
  payment_allocation_totals as (
    select
      spa.student_payment_id,
      coalesce(sum(spa.amount), 0) as allocated_amount
    from public.student_payment_allocations spa
    group by spa.student_payment_id
  ),
  payment_refund_totals as (
    select
      sr.student_payment_id,
      coalesce(sum(sr.amount), 0) as refunded_amount
    from public.student_refunds sr
    where sr.status <> 'void'
      and sr.student_payment_id is not null
    group by sr.student_payment_id
  ),
  payment_rows as (
    select
      sp.id,
      sp.currency,
      sp.amount,
      coalesce(pat.allocated_amount, 0) as allocated_amount,
      coalesce(prt.refunded_amount, 0) as refunded_amount
    from public.student_payments sp
    left join payment_allocation_totals pat on pat.student_payment_id = sp.id
    left join payment_refund_totals prt on prt.student_payment_id = sp.id
    where sp.student_id = p_student_id
      and sp.status <> 'void'
  ),
  refund_rows as (
    select sr.currency, sr.amount
    from public.student_refunds sr
    where sr.student_id = p_student_id
      and sr.status <> 'void'
  ),
  currencies as (
    select cr.currency from charge_rows cr
    union
    select pr.currency from payment_rows pr
    union
    select rr.currency from refund_rows rr
    union
    select 'JPY'::char(3)
    where not exists (select 1 from charge_rows)
      and not exists (select 1 from payment_rows)
      and not exists (select 1 from refund_rows)
  )
  select
    v_student.organization_id,
    v_student.school_id,
    v_student.id,
    currencies.currency,
    coalesce((select sum(cr.amount) from charge_rows cr where cr.currency = currencies.currency), 0),
    coalesce((select sum(cr.allocated_amount) from charge_rows cr where cr.currency = currencies.currency), 0),
    coalesce((select sum(cr.amount - cr.allocated_amount) from charge_rows cr where cr.currency = currencies.currency), 0),
    coalesce((
      select sum(greatest(cr.amount - cr.allocated_amount, 0))
      from charge_rows cr
      where cr.currency = currencies.currency
        and cr.amount > 0
        and cr.due_date is not null
        and cr.due_date < p_as_of_date
    ), 0),
    coalesce((select sum(pr.amount - pr.allocated_amount - pr.refunded_amount) from payment_rows pr where pr.currency = currencies.currency), 0),
    coalesce((select sum(rr.amount) from refund_rows rr where rr.currency = currencies.currency), 0)
  from currencies;
end;
$$;

revoke all on function public.get_student_billing_summary_mvp(uuid, date) from public, anon;
grant execute on function public.get_student_billing_summary_mvp(uuid, date) to authenticated;

notify pgrst, 'reload schema';
