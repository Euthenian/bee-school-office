create table if not exists public.legacy_student_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  school_id uuid not null references public.schools (id) on delete restrict,
  source_file_name text not null,
  source_file_sha256 text,
  source_sheet_names text[] not null default '{}'::text[],
  import_status text not null default 'dry_run',
  dry_run_summary jsonb not null default '{}'::jsonb,
  approved_mapping jsonb not null default '{}'::jsonb,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id, school_id),
  constraint legacy_student_import_batches_school_id_organization_id_fkey
    foreign key (school_id, organization_id)
    references public.schools (id, organization_id)
    on delete restrict,
  constraint legacy_student_import_batches_import_status_check
    check (import_status in ('dry_run', 'ready_for_import', 'importing', 'imported', 'cancelled', 'failed')),
  constraint legacy_student_import_batches_source_file_name_required
    check (length(btrim(source_file_name)) > 0),
  constraint legacy_student_import_batches_source_file_sha256_check
    check (source_file_sha256 is null or source_file_sha256 ~ '^[a-f0-9]{64}$')
);

create table if not exists public.legacy_student_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  organization_id uuid not null,
  school_id uuid not null,
  source_sheet_name text not null,
  source_row_number integer not null,
  legacy_customer_id text,
  raw_source_data jsonb not null,
  normalized_candidate jsonb not null,
  validation_state text not null default 'valid',
  warnings jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  unresolved jsonb not null default '[]'::jsonb,
  duplicate_candidates jsonb not null default '[]'::jsonb,
  imported_student_id uuid references public.students (id) on delete restrict,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint legacy_student_import_rows_batch_scope_fkey
    foreign key (batch_id, organization_id, school_id)
    references public.legacy_student_import_batches (id, organization_id, school_id)
    on delete cascade,
  constraint legacy_student_import_rows_imported_student_scope_fkey
    foreign key (imported_student_id, organization_id, school_id)
    references public.students (id, organization_id, school_id)
    on delete restrict,
  constraint legacy_student_import_rows_source_row_number_check
    check (source_row_number > 0),
  constraint legacy_student_import_rows_validation_state_check
    check (validation_state in ('valid', 'warning', 'error')),
  constraint legacy_student_import_rows_raw_source_data_object_check
    check (jsonb_typeof(raw_source_data) = 'object'),
  constraint legacy_student_import_rows_normalized_candidate_object_check
    check (jsonb_typeof(normalized_candidate) = 'object'),
  constraint legacy_student_import_rows_warnings_array_check
    check (jsonb_typeof(warnings) = 'array'),
  constraint legacy_student_import_rows_errors_array_check
    check (jsonb_typeof(errors) = 'array'),
  constraint legacy_student_import_rows_unresolved_array_check
    check (jsonb_typeof(unresolved) = 'array'),
  constraint legacy_student_import_rows_duplicate_candidates_array_check
    check (jsonb_typeof(duplicate_candidates) = 'array'),
  constraint legacy_student_import_rows_source_position_key
    unique (batch_id, source_sheet_name, source_row_number)
);

create index if not exists legacy_student_import_batches_school_status_idx
on public.legacy_student_import_batches (school_id, import_status, created_at desc);

create index if not exists legacy_student_import_rows_batch_state_idx
on public.legacy_student_import_rows (batch_id, validation_state, source_row_number);

create index if not exists legacy_student_import_rows_legacy_customer_id_idx
on public.legacy_student_import_rows (batch_id, legacy_customer_id)
where legacy_customer_id is not null;

create index if not exists legacy_student_import_rows_imported_student_idx
on public.legacy_student_import_rows (imported_student_id)
where imported_student_id is not null;

drop trigger if exists legacy_student_import_batches_set_updated_at on public.legacy_student_import_batches;
create trigger legacy_student_import_batches_set_updated_at
before update on public.legacy_student_import_batches
for each row execute function public.set_updated_at();

drop trigger if exists legacy_student_import_rows_set_updated_at on public.legacy_student_import_rows;
create trigger legacy_student_import_rows_set_updated_at
before update on public.legacy_student_import_rows
for each row execute function public.set_updated_at();

alter table public.legacy_student_import_batches enable row level security;
alter table public.legacy_student_import_rows enable row level security;

revoke all on public.legacy_student_import_batches from anon, authenticated;
revoke all on public.legacy_student_import_rows from anon, authenticated;

grant select, insert, update, delete on public.legacy_student_import_batches to authenticated;
grant select, insert, update, delete on public.legacy_student_import_rows to authenticated;
grant all on public.legacy_student_import_batches to service_role;
grant all on public.legacy_student_import_rows to service_role;

drop policy if exists "legacy_student_import_batches_select_staff" on public.legacy_student_import_batches;
create policy "legacy_student_import_batches_select_staff"
on public.legacy_student_import_batches
for select
to authenticated
using (public.can_manage_school(school_id));

drop policy if exists "legacy_student_import_batches_insert_staff" on public.legacy_student_import_batches;
create policy "legacy_student_import_batches_insert_staff"
on public.legacy_student_import_batches
for insert
to authenticated
with check (
  public.can_access_org(organization_id)
  and public.can_manage_school(school_id)
);

drop policy if exists "legacy_student_import_batches_update_staff" on public.legacy_student_import_batches;
create policy "legacy_student_import_batches_update_staff"
on public.legacy_student_import_batches
for update
to authenticated
using (public.can_manage_school(school_id))
with check (
  public.can_access_org(organization_id)
  and public.can_manage_school(school_id)
);

drop policy if exists "legacy_student_import_batches_delete_staff" on public.legacy_student_import_batches;
create policy "legacy_student_import_batches_delete_staff"
on public.legacy_student_import_batches
for delete
to authenticated
using (public.can_manage_school(school_id));

drop policy if exists "legacy_student_import_rows_select_staff" on public.legacy_student_import_rows;
create policy "legacy_student_import_rows_select_staff"
on public.legacy_student_import_rows
for select
to authenticated
using (public.can_manage_school(school_id));

drop policy if exists "legacy_student_import_rows_insert_staff" on public.legacy_student_import_rows;
create policy "legacy_student_import_rows_insert_staff"
on public.legacy_student_import_rows
for insert
to authenticated
with check (
  public.can_access_org(organization_id)
  and public.can_manage_school(school_id)
);

drop policy if exists "legacy_student_import_rows_update_staff" on public.legacy_student_import_rows;
create policy "legacy_student_import_rows_update_staff"
on public.legacy_student_import_rows
for update
to authenticated
using (public.can_manage_school(school_id))
with check (
  public.can_access_org(organization_id)
  and public.can_manage_school(school_id)
);

drop policy if exists "legacy_student_import_rows_delete_staff" on public.legacy_student_import_rows;
create policy "legacy_student_import_rows_delete_staff"
on public.legacy_student_import_rows
for delete
to authenticated
using (public.can_manage_school(school_id));
