create or replace function public.can_manage_student_finance_org(p_organization_id uuid, p_school_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or public.has_org_role(p_organization_id, array['franchise_owner', 'office_staff']::public.membership_role[])
    or (
      p_school_id is not null
      and public.has_school_role(p_school_id, array['school_manager', 'office_staff']::public.membership_role[])
    );
$$;

comment on function public.can_manage_student_finance_org(uuid, uuid) is
'Finance/customer-administration access helper for billing/address administration. Teachers are intentionally excluded.';

revoke all on function public.can_manage_student_finance_org(uuid, uuid) from public, anon;
grant execute on function public.can_manage_student_finance_org(uuid, uuid) to authenticated;

create or replace function public.can_manage_student_bank_accounts_org(p_organization_id uuid, p_school_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or public.has_org_role(p_organization_id, array['franchise_owner']::public.membership_role[])
    or (
      p_school_id is not null
      and public.has_school_role(p_school_id, array['school_manager']::public.membership_role[])
    );
$$;

comment on function public.can_manage_student_bank_accounts_org(uuid, uuid) is
'Highly restricted bank-account/direct-debit access helper. Allows super_admin, organization franchise_owner, and school_manager only; office_staff and teachers are intentionally excluded.';

revoke all on function public.can_manage_student_bank_accounts_org(uuid, uuid) from public, anon;
grant execute on function public.can_manage_student_bank_accounts_org(uuid, uuid) to authenticated;

create table if not exists public.legacy_finance_banking_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  school_id uuid not null references public.schools (id) on delete restrict,
  source_file_name text not null,
  source_file_sha256 text not null,
  source_sheet_name text not null,
  import_status text not null default 'dry_run',
  dry_run_summary jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, source_file_sha256, source_sheet_name),
  foreign key (school_id, organization_id) references public.schools (id, organization_id) on delete restrict,
  constraint legacy_finance_banking_batches_status_check
    check (import_status in ('dry_run', 'staged', 'importing', 'imported', 'failed', 'abandoned'))
);

comment on table public.legacy_finance_banking_import_batches is
'Restricted dry-run/staging batches for legacy Rico direct-debit/customer finance data. Applying this migration does not import production bank data.';

create table if not exists public.legacy_finance_banking_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.legacy_finance_banking_import_batches (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete restrict,
  school_id uuid not null references public.schools (id) on delete restrict,
  source_file_sha256 text not null,
  source_sheet_name text not null,
  source_row_number integer not null,
  source_identity text not null,
  legacy_customer_id text,
  matched_student_id uuid references public.students (id) on delete restrict,
  match_confidence text not null,
  student_match_category text not null,
  masked_source_data jsonb not null default '{}'::jsonb,
  normalized_non_sensitive_data jsonb not null default '{}'::jsonb,
  raw_sensitive_source_data jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  import_status text not null default 'dry_run',
  imported_billing_profile_id uuid,
  imported_bank_account_id uuid,
  imported_address_id uuid,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, source_file_sha256, source_sheet_name, source_row_number),
  unique (source_identity),
  foreign key (school_id, organization_id) references public.schools (id, organization_id) on delete restrict,
  constraint legacy_finance_banking_rows_source_row_check check (source_row_number > 0),
  constraint legacy_finance_banking_rows_match_category_check check (student_match_category in ('A', 'B', 'C', 'D')),
  constraint legacy_finance_banking_rows_status_check
    check (import_status in ('dry_run', 'staged', 'imported', 'owner_review', 'skipped', 'failed')),
  constraint legacy_finance_banking_rows_a_requires_student_check
    check ((student_match_category = 'A' and matched_student_id is not null) or (student_match_category <> 'A' and matched_student_id is null)),
  constraint legacy_finance_banking_rows_no_import_without_a_check
    check (imported_at is null or student_match_category = 'A')
);

comment on table public.legacy_finance_banking_import_rows is
'Restricted row-level staging for legacy Rico financial/customer data. raw_sensitive_source_data can contain full source bank fields and must never be exposed through generated Git reports, browser logs, dashboards or teacher-readable paths.';
comment on column public.legacy_finance_banking_import_rows.masked_source_data is
'Source row with bank account numbers masked for operational review.';
comment on column public.legacy_finance_banking_import_rows.normalized_non_sensitive_data is
'Normalized metadata and validation status. Account numbers remain masked here.';
comment on column public.legacy_finance_banking_import_rows.raw_sensitive_source_data is
'Full sensitive source values for the approved import and owner review only. Access is restricted by bank-account RLS; office_staff and teachers have no policy path.';

create index if not exists legacy_finance_banking_import_rows_batch_idx
on public.legacy_finance_banking_import_rows (batch_id);

create index if not exists legacy_finance_banking_import_rows_student_idx
on public.legacy_finance_banking_import_rows (matched_student_id)
where matched_student_id is not null;

create index if not exists legacy_finance_banking_import_rows_customer_id_idx
on public.legacy_finance_banking_import_rows (school_id, legacy_customer_id)
where legacy_customer_id is not null;

drop trigger if exists legacy_finance_banking_import_batches_set_updated_at on public.legacy_finance_banking_import_batches;
create trigger legacy_finance_banking_import_batches_set_updated_at
before update on public.legacy_finance_banking_import_batches
for each row execute function public.set_updated_at();

drop trigger if exists legacy_finance_banking_import_rows_set_updated_at on public.legacy_finance_banking_import_rows;
create trigger legacy_finance_banking_import_rows_set_updated_at
before update on public.legacy_finance_banking_import_rows
for each row execute function public.set_updated_at();

alter table public.legacy_finance_banking_import_batches enable row level security;
alter table public.legacy_finance_banking_import_rows enable row level security;

revoke all on public.legacy_finance_banking_import_batches from anon, authenticated;
revoke all on public.legacy_finance_banking_import_rows from anon, authenticated;

grant select, insert, update on public.legacy_finance_banking_import_batches to authenticated;
grant select, insert, update on public.legacy_finance_banking_import_rows to authenticated;
grant all on public.legacy_finance_banking_import_batches to service_role;
grant all on public.legacy_finance_banking_import_rows to service_role;

drop policy if exists "legacy_finance_banking_batches_admin_access" on public.legacy_finance_banking_import_batches;
create policy "legacy_finance_banking_batches_admin_access"
on public.legacy_finance_banking_import_batches
for all
to authenticated
using (public.can_manage_student_finance_org(organization_id, school_id))
with check (public.can_manage_student_finance_org(organization_id, school_id));

drop policy if exists "legacy_finance_banking_rows_admin_access" on public.legacy_finance_banking_import_rows;
create policy "legacy_finance_banking_rows_admin_access"
on public.legacy_finance_banking_import_rows
for all
to authenticated
using (public.can_manage_student_finance_org(organization_id, school_id))
with check (public.can_manage_student_finance_org(organization_id, school_id));

drop policy if exists "legacy_finance_banking_rows_bank_admin_access" on public.legacy_finance_banking_import_rows;
create policy "legacy_finance_banking_rows_bank_admin_access"
on public.legacy_finance_banking_import_rows
as restrictive
for all
to authenticated
using (public.can_manage_student_bank_accounts_org(organization_id, school_id))
with check (public.can_manage_student_bank_accounts_org(organization_id, school_id));

notify pgrst, 'reload schema';
