create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  school_id uuid,
  name text not null,
  code text not null,
  status text not null default 'active',
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  constraint expense_categories_organization_id_fkey
    foreign key (organization_id)
    references public.organizations (id)
    on delete cascade,
  constraint expense_categories_school_id_organization_id_fkey
    foreign key (school_id, organization_id)
    references public.schools (id, organization_id)
    on delete cascade,
  constraint expense_categories_code_check
    check (code ~ '^[a-z0-9_]+$'),
  constraint expense_categories_status_check
    check (status in ('active', 'inactive'))
);

create unique index if not exists expense_categories_scope_code_uidx
on public.expense_categories (
  organization_id,
  coalesce(school_id, '00000000-0000-0000-0000-000000000000'::uuid),
  code
);

create index if not exists expense_categories_organization_sort_idx
on public.expense_categories (organization_id, status, sort_order, name);

comment on table public.expense_categories is
'Normalized, extensible operating expense categories for Bee School Office.';

with expense_category_seed (code, name, sort_order) as (
  values
    ('rent', 'Rent', 10),
    ('utilities', 'Utilities', 20),
    ('internet_communications', 'Internet / Communications', 30),
    ('teaching_materials', 'Teaching Materials', 40),
    ('office_supplies', 'Office Supplies', 50),
    ('furniture_equipment', 'Furniture / Equipment', 60),
    ('cleaning', 'Cleaning', 70),
    ('repairs_maintenance', 'Repairs / Maintenance', 80),
    ('advertising_marketing', 'Advertising / Marketing', 90),
    ('software_subscriptions', 'Software / Subscriptions', 100),
    ('professional_fees', 'Professional Fees', 110),
    ('bank_payment_fees', 'Bank / Payment Fees', 120),
    ('transportation', 'Transportation', 130),
    ('taxes_fees', 'Taxes / Fees', 140),
    ('other', 'Other', 999)
)
insert into public.expense_categories (
  organization_id,
  school_id,
  code,
  name,
  sort_order
)
select
  org.id,
  null,
  seed.code,
  seed.name,
  seed.sort_order
from public.organizations org
cross join expense_category_seed seed
on conflict do nothing;

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  school_id uuid not null,
  expense_date date not null,
  category_id uuid not null,
  vendor text,
  description text not null,
  amount numeric(12, 2) not null,
  currency char(3) not null default 'JPY',
  tax_amount numeric(12, 2),
  payment_method text not null default 'cash',
  reference text,
  receipt_reference text,
  receipt_file_path text,
  receipt_original_name text,
  notes text,
  status text not null default 'active',
  created_by uuid,
  voided_by uuid,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  constraint expenses_organization_id_fkey
    foreign key (organization_id)
    references public.organizations (id)
    on delete restrict,
  constraint expenses_school_id_organization_id_fkey
    foreign key (school_id, organization_id)
    references public.schools (id, organization_id)
    on delete restrict,
  constraint expenses_category_id_organization_id_fkey
    foreign key (category_id, organization_id)
    references public.expense_categories (id, organization_id)
    on delete restrict,
  constraint expenses_created_by_fkey
    foreign key (created_by)
    references public.profiles (id)
    on delete set null,
  constraint expenses_voided_by_fkey
    foreign key (voided_by)
    references public.profiles (id)
    on delete set null,
  constraint expenses_amount_check
    check (amount > 0),
  constraint expenses_tax_amount_check
    check (tax_amount is null or (tax_amount >= 0 and tax_amount <= amount)),
  constraint expenses_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint expenses_payment_method_check
    check (payment_method in ('cash', 'bank_transfer', 'bank_debit', 'card', 'other')),
  constraint expenses_status_check
    check (status in ('active', 'void'))
);

create index if not exists expenses_school_date_idx
on public.expenses (school_id, expense_date desc);

create index if not exists expenses_category_date_idx
on public.expenses (category_id, expense_date desc);

create index if not exists expenses_organization_status_date_idx
on public.expenses (organization_id, status, expense_date desc);

create index if not exists expenses_vendor_idx
on public.expenses (vendor);

comment on table public.expenses is
'Operational expenses paid by Bee School. Receipts are represented by metadata only until secure document upload is implemented.';

drop trigger if exists expense_categories_set_updated_at on public.expense_categories;
create trigger expense_categories_set_updated_at
before update on public.expense_categories
for each row execute function public.set_updated_at();

drop trigger if exists expenses_set_updated_at on public.expenses;
create trigger expenses_set_updated_at
before update on public.expenses
for each row execute function public.set_updated_at();

create or replace function public.can_manage_expenses_org(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin();
$$;

revoke all on function public.can_manage_expenses_org(uuid) from public, anon;
grant execute on function public.can_manage_expenses_org(uuid) to authenticated;

create or replace function public.validate_expense_row()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_category public.expense_categories%rowtype;
  v_school public.schools%rowtype;
begin
  select * into v_school
  from public.schools s
  where s.id = new.school_id;

  if not found then
    raise exception 'School % was not found.', new.school_id;
  end if;

  new.organization_id = v_school.organization_id;

  if not public.can_manage_expenses_org(new.organization_id) then
    raise exception 'You do not have permission to manage expenses for this organization.';
  end if;

  select * into v_category
  from public.expense_categories ec
  where ec.id = new.category_id
    and ec.organization_id = new.organization_id;

  if not found then
    raise exception 'Expense category % was not found for this organization.', new.category_id;
  end if;

  if v_category.school_id is not null and v_category.school_id <> new.school_id then
    raise exception 'Expense category does not belong to this school.';
  end if;

  if new.status = 'active' and v_category.status <> 'active' then
    raise exception 'Inactive expense categories cannot be used for active expenses.';
  end if;

  if new.amount <= 0 then
    raise exception 'Expense amount must be greater than zero.';
  end if;

  if new.tax_amount is not null and (new.tax_amount < 0 or new.tax_amount > new.amount) then
    raise exception 'Expense tax amount must be between zero and the expense amount.';
  end if;

  if tg_op = 'INSERT' then
    new.created_by = coalesce(new.created_by, (select auth.uid()));
  else
    if old.status = 'void' then
      raise exception 'Voided expenses cannot be edited.';
    end if;

    new.created_by = old.created_by;
    new.created_at = old.created_at;
  end if;

  if new.status = 'void' then
    new.voided_by = coalesce(new.voided_by, (select auth.uid()));
    new.voided_at = coalesce(new.voided_at, now());
  end if;

  return new;
end;
$$;

revoke all on function public.validate_expense_row() from public, anon, authenticated;

drop trigger if exists expenses_validate_row on public.expenses;
create trigger expenses_validate_row
before insert or update on public.expenses
for each row execute function public.validate_expense_row();

alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;

revoke all on public.expense_categories from anon, authenticated;
revoke all on public.expenses from anon, authenticated;

grant select, insert, update on public.expense_categories to authenticated;
grant select, insert, update on public.expenses to authenticated;

grant all on public.expense_categories to service_role;
grant all on public.expenses to service_role;

drop policy if exists "expense_categories_management_access" on public.expense_categories;
create policy "expense_categories_management_access"
on public.expense_categories
for all
to authenticated
using (public.can_manage_expenses_org(organization_id))
with check (public.can_manage_expenses_org(organization_id));

drop policy if exists "expenses_management_access" on public.expenses;
create policy "expenses_management_access"
on public.expenses
for all
to authenticated
using (public.can_manage_expenses_org(organization_id))
with check (public.can_manage_expenses_org(organization_id));

create or replace function public.create_expense_mvp(
  p_school_id uuid,
  p_expense_date date,
  p_category_id uuid,
  p_vendor text default null,
  p_description text default null,
  p_amount numeric default null,
  p_currency text default 'JPY',
  p_tax_amount numeric default null,
  p_payment_method text default 'cash',
  p_reference text default null,
  p_receipt_reference text default null,
  p_receipt_file_path text default null,
  p_receipt_original_name text default null,
  p_notes text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_amount numeric(12, 2);
  v_currency char(3);
  v_expense_id uuid;
  v_method text;
  v_school public.schools%rowtype;
  v_tax_amount numeric(12, 2);
begin
  if p_school_id is null then
    raise exception 'School is required.';
  end if;

  select * into v_school
  from public.schools s
  where s.id = p_school_id;

  if not found then
    raise exception 'School % was not found.', p_school_id;
  end if;

  if not public.can_manage_expenses_org(v_school.organization_id) then
    raise exception 'You do not have permission to manage expenses for this organization.';
  end if;

  if p_expense_date is null then
    raise exception 'Expense date is required.';
  end if;

  if p_category_id is null then
    raise exception 'Expense category is required.';
  end if;

  if nullif(trim(coalesce(p_description, '')), '') is null then
    raise exception 'Expense description is required.';
  end if;

  v_amount = coalesce(p_amount, 0);
  if v_amount <= 0 then
    raise exception 'Expense amount must be greater than zero.';
  end if;

  v_tax_amount = p_tax_amount;
  if v_tax_amount is not null and (v_tax_amount < 0 or v_tax_amount > v_amount) then
    raise exception 'Expense tax amount must be between zero and the expense amount.';
  end if;

  v_currency = upper(coalesce(nullif(trim(coalesce(p_currency, '')), ''), 'JPY'))::char(3);
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be a three-letter code.';
  end if;

  v_method = coalesce(nullif(trim(coalesce(p_payment_method, '')), ''), 'cash');
  if v_method not in ('cash', 'bank_transfer', 'bank_debit', 'card', 'other') then
    raise exception 'Unsupported expense payment method %. Use cash, bank_transfer, bank_debit, card, or other.', v_method;
  end if;

  insert into public.expenses (
    organization_id,
    school_id,
    expense_date,
    category_id,
    vendor,
    description,
    amount,
    currency,
    tax_amount,
    payment_method,
    reference,
    receipt_reference,
    receipt_file_path,
    receipt_original_name,
    notes,
    status,
    created_by
  )
  values (
    v_school.organization_id,
    p_school_id,
    p_expense_date,
    p_category_id,
    nullif(trim(coalesce(p_vendor, '')), ''),
    trim(p_description),
    v_amount,
    v_currency,
    v_tax_amount,
    v_method,
    nullif(trim(coalesce(p_reference, '')), ''),
    nullif(trim(coalesce(p_receipt_reference, '')), ''),
    nullif(trim(coalesce(p_receipt_file_path, '')), ''),
    nullif(trim(coalesce(p_receipt_original_name, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    'active',
    (select auth.uid())
  )
  returning id into v_expense_id;

  return v_expense_id;
end;
$$;

revoke all on function public.create_expense_mvp(uuid, date, uuid, text, text, numeric, text, numeric, text, text, text, text, text, text) from public, anon;
grant execute on function public.create_expense_mvp(uuid, date, uuid, text, text, numeric, text, numeric, text, text, text, text, text, text) to authenticated;

create or replace function public.update_expense_mvp(
  p_expense_id uuid,
  p_school_id uuid,
  p_expense_date date,
  p_category_id uuid,
  p_vendor text default null,
  p_description text default null,
  p_amount numeric default null,
  p_currency text default 'JPY',
  p_tax_amount numeric default null,
  p_payment_method text default 'cash',
  p_reference text default null,
  p_receipt_reference text default null,
  p_receipt_file_path text default null,
  p_receipt_original_name text default null,
  p_notes text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_amount numeric(12, 2);
  v_currency char(3);
  v_expense public.expenses%rowtype;
  v_method text;
  v_school public.schools%rowtype;
  v_tax_amount numeric(12, 2);
begin
  select * into v_expense
  from public.expenses e
  where e.id = p_expense_id
  for update;

  if not found then
    raise exception 'Expense % was not found.', p_expense_id;
  end if;

  if v_expense.status = 'void' then
    raise exception 'Voided expenses cannot be edited.';
  end if;

  if not public.can_manage_expenses_org(v_expense.organization_id) then
    raise exception 'You do not have permission to manage expenses for this organization.';
  end if;

  if p_school_id is null then
    raise exception 'School is required.';
  end if;

  select * into v_school
  from public.schools s
  where s.id = p_school_id;

  if not found then
    raise exception 'School % was not found.', p_school_id;
  end if;

  if not public.can_manage_expenses_org(v_school.organization_id) then
    raise exception 'You do not have permission to manage expenses for this organization.';
  end if;

  if p_expense_date is null then
    raise exception 'Expense date is required.';
  end if;

  if p_category_id is null then
    raise exception 'Expense category is required.';
  end if;

  if nullif(trim(coalesce(p_description, '')), '') is null then
    raise exception 'Expense description is required.';
  end if;

  v_amount = coalesce(p_amount, 0);
  if v_amount <= 0 then
    raise exception 'Expense amount must be greater than zero.';
  end if;

  v_tax_amount = p_tax_amount;
  if v_tax_amount is not null and (v_tax_amount < 0 or v_tax_amount > v_amount) then
    raise exception 'Expense tax amount must be between zero and the expense amount.';
  end if;

  v_currency = upper(coalesce(nullif(trim(coalesce(p_currency, '')), ''), 'JPY'))::char(3);
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be a three-letter code.';
  end if;

  v_method = coalesce(nullif(trim(coalesce(p_payment_method, '')), ''), 'cash');
  if v_method not in ('cash', 'bank_transfer', 'bank_debit', 'card', 'other') then
    raise exception 'Unsupported expense payment method %. Use cash, bank_transfer, bank_debit, card, or other.', v_method;
  end if;

  update public.expenses
  set organization_id = v_school.organization_id,
      school_id = p_school_id,
      expense_date = p_expense_date,
      category_id = p_category_id,
      vendor = nullif(trim(coalesce(p_vendor, '')), ''),
      description = trim(p_description),
      amount = v_amount,
      currency = v_currency,
      tax_amount = v_tax_amount,
      payment_method = v_method,
      reference = nullif(trim(coalesce(p_reference, '')), ''),
      receipt_reference = nullif(trim(coalesce(p_receipt_reference, '')), ''),
      receipt_file_path = nullif(trim(coalesce(p_receipt_file_path, '')), ''),
      receipt_original_name = nullif(trim(coalesce(p_receipt_original_name, '')), ''),
      notes = nullif(trim(coalesce(p_notes, '')), '')
  where id = p_expense_id;

  return p_expense_id;
end;
$$;

revoke all on function public.update_expense_mvp(uuid, uuid, date, uuid, text, text, numeric, text, numeric, text, text, text, text, text, text) from public, anon;
grant execute on function public.update_expense_mvp(uuid, uuid, date, uuid, text, text, numeric, text, numeric, text, text, text, text, text, text) to authenticated;

create or replace function public.void_expense_mvp(
  p_expense_id uuid,
  p_void_reason text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_expense public.expenses%rowtype;
begin
  select * into v_expense
  from public.expenses e
  where e.id = p_expense_id
  for update;

  if not found then
    raise exception 'Expense % was not found.', p_expense_id;
  end if;

  if not public.can_manage_expenses_org(v_expense.organization_id) then
    raise exception 'You do not have permission to manage expenses for this organization.';
  end if;

  if v_expense.status = 'void' then
    return p_expense_id;
  end if;

  update public.expenses
  set status = 'void',
      voided_by = (select auth.uid()),
      voided_at = now(),
      void_reason = nullif(trim(coalesce(p_void_reason, '')), '')
  where id = p_expense_id;

  return p_expense_id;
end;
$$;

revoke all on function public.void_expense_mvp(uuid, text) from public, anon;
grant execute on function public.void_expense_mvp(uuid, text) to authenticated;

create or replace function public.get_expense_summary_mvp(
  p_date_from date default null,
  p_date_to date default null,
  p_school_id uuid default null,
  p_category_id uuid default null,
  p_vendor text default null,
  p_payment_method text default null,
  p_status text default 'active'
)
returns table (
  currency char(3),
  total_expenses numeric,
  total_tax numeric,
  expense_count bigint,
  category_totals jsonb,
  school_totals jsonb
)
language plpgsql
stable
set search_path = public
as $$
declare
  v_status text := coalesce(nullif(trim(coalesce(p_status, '')), ''), 'active');
begin
  if p_date_from is not null and p_date_to is not null and p_date_to < p_date_from then
    raise exception 'Date to cannot be before date from.';
  end if;

  if v_status not in ('active', 'void', 'all') then
    raise exception 'Unsupported expense summary status %. Use active, void, or all.', v_status;
  end if;

  return query
  with filtered_expenses as (
    select e.*
    from public.expenses e
    where public.can_manage_expenses_org(e.organization_id)
      and (p_date_from is null or e.expense_date >= p_date_from)
      and (p_date_to is null or e.expense_date <= p_date_to)
      and (p_school_id is null or e.school_id = p_school_id)
      and (p_category_id is null or e.category_id = p_category_id)
      and (p_vendor is null or e.vendor ilike '%' || p_vendor || '%')
      and (p_payment_method is null or e.payment_method = p_payment_method)
      and (v_status = 'all' or e.status = v_status)
  ),
  currencies as (
    select distinct fe.currency
    from filtered_expenses fe
    union
    select 'JPY'::char(3)
    where not exists (select 1 from filtered_expenses)
  )
  select
    c.currency,
    coalesce((select sum(fe.amount) from filtered_expenses fe where fe.currency = c.currency), 0),
    coalesce((select sum(fe.tax_amount) from filtered_expenses fe where fe.currency = c.currency), 0),
    coalesce((select count(*) from filtered_expenses fe where fe.currency = c.currency), 0),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'category_id', category_rows.category_id,
          'category_code', category_rows.category_code,
          'category_name', category_rows.category_name,
          'amount', category_rows.amount,
          'tax_amount', category_rows.tax_amount,
          'expense_count', category_rows.expense_count
        )
        order by category_rows.amount desc, category_rows.category_name
      )
      from (
        select
          ec.id as category_id,
          ec.code as category_code,
          ec.name as category_name,
          sum(fe.amount) as amount,
          coalesce(sum(fe.tax_amount), 0) as tax_amount,
          count(*) as expense_count
        from filtered_expenses fe
        join public.expense_categories ec on ec.id = fe.category_id
        where fe.currency = c.currency
        group by ec.id, ec.code, ec.name
      ) category_rows
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'school_id', school_rows.school_id,
          'school_name', school_rows.school_name,
          'amount', school_rows.amount,
          'tax_amount', school_rows.tax_amount,
          'expense_count', school_rows.expense_count
        )
        order by school_rows.amount desc, school_rows.school_name
      )
      from (
        select
          s.id as school_id,
          s.name as school_name,
          sum(fe.amount) as amount,
          coalesce(sum(fe.tax_amount), 0) as tax_amount,
          count(*) as expense_count
        from filtered_expenses fe
        join public.schools s on s.id = fe.school_id
        where fe.currency = c.currency
        group by s.id, s.name
      ) school_rows
    ), '[]'::jsonb)
  from currencies c;
end;
$$;

revoke all on function public.get_expense_summary_mvp(date, date, uuid, uuid, text, text, text) from public, anon;
grant execute on function public.get_expense_summary_mvp(date, date, uuid, uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
