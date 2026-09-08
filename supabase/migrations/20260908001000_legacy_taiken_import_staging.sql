-- Audit/staging only. This migration does not import a prospect, trial, or student.
-- Keep the existing legacy staging tables and their staff-only tenant RLS.
-- Applying this migration and executing an import are separate, reviewed steps.

alter table public.legacy_student_import_batches
  add column if not exists import_kind text not null default 'students';

alter table public.legacy_student_import_batches
  add constraint legacy_import_batches_kind_check
    check (import_kind in ('students', 'taiken')),
  add constraint legacy_import_batches_taiken_source_check
    check (
      import_kind <> 'taiken'
      or (
        source_file_sha256 is not null
        and source_sheet_names = array['Taiken']::text[]
      )
    ),
  add constraint legacy_import_batches_id_kind_key unique (id, import_kind),
  add constraint legacy_import_batches_id_hash_key unique (id, source_file_sha256);

alter table public.legacy_student_import_rows
  add column if not exists import_kind text not null default 'students',
  add column if not exists source_file_sha256 text,
  add column if not exists student_match_candidates jsonb not null default '[]'::jsonb,
  add column if not exists student_match_category text not null default 'not_evaluated',
  add column if not exists chosen_converted_student_id uuid,
  add column if not exists imported_trial_lesson_id uuid,
  add column if not exists imported_prospect_id uuid,
  add column if not exists import_status text not null default 'dry_run';

alter table public.legacy_student_import_rows
  add constraint legacy_import_rows_kind_check
    check (import_kind in ('students', 'taiken')),
  add constraint legacy_import_rows_batch_kind_fkey
    foreign key (batch_id, import_kind)
    references public.legacy_student_import_batches (id, import_kind)
    on delete cascade,
  add constraint legacy_import_rows_batch_hash_fkey
    foreign key (batch_id, source_file_sha256)
    references public.legacy_student_import_batches (id, source_file_sha256)
    on delete cascade,
  add constraint legacy_import_rows_source_hash_check
    check (source_file_sha256 is null or source_file_sha256 ~ '^[a-f0-9]{64}$'),
  add constraint legacy_import_rows_taiken_source_check
    check (
      import_kind <> 'taiken'
      or (source_sheet_name = 'Taiken' and source_file_sha256 is not null)
    ),
  add constraint legacy_import_rows_student_match_candidates_check
    check (jsonb_typeof(student_match_candidates) = 'array'),
  add constraint legacy_import_rows_student_match_category_check
    check (student_match_category in ('A', 'B', 'C', 'not_applicable', 'not_evaluated')),
  add constraint legacy_import_rows_chosen_match_check
    check (chosen_converted_student_id is null or student_match_category = 'A'),
  add constraint legacy_import_rows_chosen_student_scope_fkey
    foreign key (chosen_converted_student_id, organization_id, school_id)
    references public.students (id, organization_id, school_id)
    on delete restrict,
  add constraint legacy_import_rows_trial_scope_fkey
    foreign key (imported_trial_lesson_id, organization_id, school_id)
    references public.trial_lessons (id, organization_id, school_id)
    on delete restrict,
  add constraint legacy_import_rows_prospect_scope_fkey
    foreign key (imported_prospect_id, organization_id, school_id)
    references public.prospects (id, organization_id, school_id)
    on delete restrict,
  add constraint legacy_import_rows_trial_prospect_pair_check
    check ((imported_trial_lesson_id is null) = (imported_prospect_id is null)),
  add constraint legacy_import_rows_taiken_never_creates_student_check
    check (import_kind <> 'taiken' or imported_student_id is null),
  add constraint legacy_import_rows_trial_fields_kind_check
    check (
      import_kind = 'taiken'
      or (
        chosen_converted_student_id is null
        and imported_trial_lesson_id is null
        and imported_prospect_id is null
      )
    ),
  add constraint legacy_import_rows_import_status_check
    check (import_status in (
      'dry_run', 'needs_review', 'ready_for_import', 'importing', 'imported', 'failed', 'cancelled'
    )),
  add constraint legacy_import_rows_taiken_import_receipt_check
    check (
      import_kind <> 'taiken'
      or (
        (import_status = 'imported' and imported_trial_lesson_id is not null and imported_at is not null)
        or (import_status <> 'imported' and imported_trial_lesson_id is null and imported_at is null)
      )
    );

-- Unlike the old per-batch key, this reserves a source row across every retry/batch.
-- A future approved executor must lock this row and create the prospect, trial,
-- participants and receipt in ONE transaction. A dry run never executes that path.
create unique index legacy_import_rows_taiken_source_identity_uidx
on public.legacy_student_import_rows (
  school_id, source_file_sha256, source_sheet_name, source_row_number
)
where import_kind = 'taiken';

create unique index legacy_import_rows_taiken_trial_receipt_uidx
on public.legacy_student_import_rows (imported_trial_lesson_id)
where imported_trial_lesson_id is not null;

create index legacy_import_rows_taiken_review_idx
on public.legacy_student_import_rows (school_id, import_status, student_match_category, source_row_number)
where import_kind = 'taiken';

create or replace function public.protect_legacy_taiken_import_receipt()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.import_kind = 'taiken' and old.imported_trial_lesson_id is not null then
      raise exception 'Imported Taiken audit rows must be retained for source idempotency.';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.import_kind = 'taiken' then
    if row(
      new.import_kind, new.organization_id, new.school_id, new.source_file_sha256,
      new.source_sheet_name, new.source_row_number, new.raw_source_data
    ) is distinct from row(
      old.import_kind, old.organization_id, old.school_id, old.source_file_sha256,
      old.source_sheet_name, old.source_row_number, old.raw_source_data
    ) then
      raise exception 'Taiken source identity and raw audit data are immutable.';
    end if;

    if old.imported_trial_lesson_id is not null and row(
      new.imported_trial_lesson_id, new.imported_prospect_id, new.import_status,
      new.imported_at, new.chosen_converted_student_id, new.student_match_category
    ) is distinct from row(
      old.imported_trial_lesson_id, old.imported_prospect_id, old.import_status,
      old.imported_at, old.chosen_converted_student_id, old.student_match_category
    ) then
      raise exception 'An imported Taiken receipt cannot be reset or reassigned.';
    end if;
  end if;

  if new.import_kind = 'taiken' and new.imported_trial_lesson_id is not null then
    if not exists (
      select 1
      from public.trial_lessons tl
      where tl.id = new.imported_trial_lesson_id
        and tl.organization_id = new.organization_id
        and tl.school_id = new.school_id
        and tl.prospect_id = new.imported_prospect_id
        and tl.converted_student_id is not distinct from new.chosen_converted_student_id
        and (new.chosen_converted_student_id is null or tl.status = 'joined')
    ) then
      raise exception 'Taiken receipt must match the trial, its prospect, and its chosen existing student.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.protect_legacy_taiken_import_receipt() from public, anon, authenticated;

create trigger legacy_import_rows_protect_taiken_receipt
before insert or update or delete on public.legacy_student_import_rows
for each row execute function public.protect_legacy_taiken_import_receipt();

comment on column public.legacy_student_import_batches.import_kind is
  'Shared legacy staging discriminator. Existing student import callers retain their students default.';
comment on column public.legacy_student_import_rows.raw_source_data is
  'Original source audit JSON. For Taiken, postal address remains here only and must never enter production payloads.';
comment on column public.legacy_student_import_rows.student_match_category is
  'A: strong exact match; B: probable/ambiguous; C: no match; not_applicable: no joined evidence; not_evaluated: matching not performed.';
comment on column public.legacy_student_import_rows.chosen_converted_student_id is
  'Existing Student UUID proposed for trial_lessons.converted_student_id. Only category A may choose automatically; this staging column creates no student.';

-- No grants, RLS policies, production constraints, Auth users, or production RPCs
-- are changed. Both shared tables retain their existing enabled RLS and
-- can_manage_school / can_access_org policies. Composite FKs enforce tenant scope.
