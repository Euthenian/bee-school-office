alter table public.students
  add column if not exists legacy_customer_id text,
  add column if not exists legacy_japanese_name text,
  add column if not exists legacy_source_file_sha256 text,
  add column if not exists legacy_source_sheet_name text,
  add column if not exists legacy_source_row_number integer,
  add column if not exists legacy_import_batch_id uuid references public.legacy_student_import_batches (id) on delete set null;

alter table public.students
  alter column first_name drop not null,
  alter column last_name drop not null;

alter table public.students
  drop constraint if exists students_usable_identity_check;

alter table public.students
  add constraint students_usable_identity_check
  check (
    nullif(btrim(coalesce(first_name, '')), '') is not null
    or nullif(btrim(coalesce(last_name, '')), '') is not null
    or nullif(btrim(coalesce(legacy_japanese_name, '')), '') is not null
  );

alter table public.students
  drop constraint if exists students_legacy_source_file_sha256_check;

alter table public.students
  add constraint students_legacy_source_file_sha256_check
  check (
    legacy_source_file_sha256 is null
    or legacy_source_file_sha256 ~ '^[a-f0-9]{64}$'
  );

alter table public.students
  drop constraint if exists students_legacy_source_row_number_check;

alter table public.students
  add constraint students_legacy_source_row_number_check
  check (
    legacy_source_row_number is null
    or legacy_source_row_number > 0
  );

create index if not exists students_legacy_customer_id_idx
on public.students (school_id, legacy_customer_id)
where legacy_customer_id is not null;

create unique index if not exists students_legacy_source_position_uidx
on public.students (
  school_id,
  legacy_source_file_sha256,
  legacy_source_sheet_name,
  legacy_source_row_number
);
