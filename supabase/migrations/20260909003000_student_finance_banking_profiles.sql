create table if not exists public.student_billing_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  school_id uuid not null references public.schools (id) on delete restrict,
  student_id uuid not null,
  monthly_fee_yen integer,
  currency char(3) not null default 'JPY',
  source_type text,
  source_file_sha256 text,
  source_sheet_name text,
  source_row_number integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id, school_id, student_id),
  constraint student_billing_profiles_source_row_unique
    unique (school_id, source_file_sha256, source_sheet_name, source_row_number),
  foreign key (student_id, organization_id, school_id)
    references public.students (id, organization_id, school_id)
    on delete restrict,
  constraint student_billing_profiles_monthly_fee_check
    check (monthly_fee_yen is null or (monthly_fee_yen >= 0 and monthly_fee_yen <= 100000)),
  constraint student_billing_profiles_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint student_billing_profiles_source_row_check
    check (source_row_number is null or source_row_number > 0)
);

create index if not exists student_billing_profiles_student_idx
on public.student_billing_profiles (student_id);

comment on table public.student_billing_profiles is
'Restricted enrolled-student customer administration profile. Legacy Rico Fee maps to monthly_fee_yen when clean; invalid fee values remain null and staged for review.';

create table if not exists public.student_addresses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  school_id uuid not null references public.schools (id) on delete restrict,
  student_id uuid not null,
  postal_address text not null,
  source_type text,
  source_file_sha256 text,
  source_sheet_name text,
  source_row_number integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id, school_id, student_id),
  constraint student_addresses_source_row_unique
    unique (school_id, source_file_sha256, source_sheet_name, source_row_number),
  foreign key (student_id, organization_id, school_id)
    references public.students (id, organization_id, school_id)
    on delete restrict,
  constraint student_addresses_postal_address_check
    check (length(trim(postal_address)) > 0),
  constraint student_addresses_source_row_check
    check (source_row_number is null or source_row_number > 0)
);

create index if not exists student_addresses_student_idx
on public.student_addresses (student_id);

comment on table public.student_addresses is
'Restricted enrolled-student administration/payment address storage. Trial Lesson and Prospect records must not receive postal addresses.';

create table if not exists public.student_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  school_id uuid not null references public.schools (id) on delete restrict,
  student_id uuid not null,
  bank_name text,
  bank_code text,
  branch_name text,
  branch_name_yomigana text,
  branch_code text,
  account_type text,
  account_number text,
  account_holder_katakana text,
  source_type text,
  source_file_sha256 text,
  source_sheet_name text,
  source_row_number integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id, school_id, student_id),
  constraint student_bank_accounts_source_row_unique
    unique (school_id, source_file_sha256, source_sheet_name, source_row_number),
  foreign key (student_id, organization_id, school_id)
    references public.students (id, organization_id, school_id)
    on delete restrict,
  constraint student_bank_accounts_account_type_check
    check (account_type is null or account_type in ('ordinary', 'current')),
  constraint student_bank_accounts_bank_code_check
    check (bank_code is null or bank_code ~ '^[0-9]{4}$'),
  constraint student_bank_accounts_branch_code_check
    check (branch_code is null or branch_code ~ '^[0-9]{3}$'),
  constraint student_bank_accounts_account_number_check
    check (account_number is null or account_number ~ '^[0-9]{7}$'),
  constraint student_bank_accounts_source_row_check
    check (source_row_number is null or source_row_number > 0)
);

alter table public.student_bank_accounts
  add column if not exists branch_name_yomigana text,
  add column if not exists account_holder_katakana text;

alter table public.student_bank_accounts
  drop column if exists account_holder_yomigana;

alter table public.student_bank_accounts
  alter column bank_name drop not null,
  alter column branch_name drop not null,
  alter column account_type drop not null,
  alter column account_number drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'student_billing_profiles_source_row_unique'
      and conrelid = 'public.student_billing_profiles'::regclass
  ) then
    alter table public.student_billing_profiles
      add constraint student_billing_profiles_source_row_unique
      unique (school_id, source_file_sha256, source_sheet_name, source_row_number);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'student_addresses_source_row_unique'
      and conrelid = 'public.student_addresses'::regclass
  ) then
    alter table public.student_addresses
      add constraint student_addresses_source_row_unique
      unique (school_id, source_file_sha256, source_sheet_name, source_row_number);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'student_bank_accounts_source_row_unique'
      and conrelid = 'public.student_bank_accounts'::regclass
  ) then
    alter table public.student_bank_accounts
      add constraint student_bank_accounts_source_row_unique
      unique (school_id, source_file_sha256, source_sheet_name, source_row_number);
  end if;
end $$;

create index if not exists student_bank_accounts_student_idx
on public.student_bank_accounts (student_id);

comment on table public.student_bank_accounts is
'Highly restricted direct-debit bank account storage. Account numbers and bank/branch codes are text fields to preserve leading zeros. Office staff and teachers have no RLS access path.';

drop trigger if exists student_billing_profiles_set_updated_at on public.student_billing_profiles;
create trigger student_billing_profiles_set_updated_at
before update on public.student_billing_profiles
for each row execute function public.set_updated_at();

drop trigger if exists student_addresses_set_updated_at on public.student_addresses;
create trigger student_addresses_set_updated_at
before update on public.student_addresses
for each row execute function public.set_updated_at();

drop trigger if exists student_bank_accounts_set_updated_at on public.student_bank_accounts;
create trigger student_bank_accounts_set_updated_at
before update on public.student_bank_accounts
for each row execute function public.set_updated_at();

alter table public.student_billing_profiles enable row level security;
alter table public.student_addresses enable row level security;
alter table public.student_bank_accounts enable row level security;

revoke all on public.student_billing_profiles from anon, authenticated;
revoke all on public.student_addresses from anon, authenticated;
revoke all on public.student_bank_accounts from anon, authenticated;

grant select, insert, update on public.student_billing_profiles to authenticated;
grant select, insert, update on public.student_addresses to authenticated;
grant select, insert, update on public.student_bank_accounts to authenticated;

grant all on public.student_billing_profiles to service_role;
grant all on public.student_addresses to service_role;
grant all on public.student_bank_accounts to service_role;

drop policy if exists "student_billing_profiles_finance_access" on public.student_billing_profiles;
create policy "student_billing_profiles_finance_access"
on public.student_billing_profiles
for all
to authenticated
using (public.can_manage_student_finance_org(organization_id, school_id))
with check (public.can_manage_student_finance_org(organization_id, school_id));

drop policy if exists "student_addresses_finance_access" on public.student_addresses;
create policy "student_addresses_finance_access"
on public.student_addresses
for all
to authenticated
using (public.can_manage_student_finance_org(organization_id, school_id))
with check (public.can_manage_student_finance_org(organization_id, school_id));

drop policy if exists "student_bank_accounts_finance_access" on public.student_bank_accounts;
create policy "student_bank_accounts_finance_access"
on public.student_bank_accounts
for all
to authenticated
using (public.can_manage_student_finance_org(organization_id, school_id))
with check (public.can_manage_student_finance_org(organization_id, school_id));

drop policy if exists "student_bank_accounts_bank_admin_access" on public.student_bank_accounts;
create policy "student_bank_accounts_bank_admin_access"
on public.student_bank_accounts
as restrictive
for all
to authenticated
using (public.can_manage_student_bank_accounts_org(organization_id, school_id))
with check (public.can_manage_student_bank_accounts_org(organization_id, school_id));

notify pgrst, 'reload schema';
