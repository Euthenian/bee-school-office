# Legacy Taiken dry-run workflow

This workflow audits only the `Taiken` worksheet in `data/legacy/students-legacy.xlsm`. It resolves the existing Bee School HQ / Ohashi tenant and compares historical prospects with the current Students. It stops after local reports: it does not persist staging rows, import production data, create or update Students, create Auth users, deploy, or push.

## Run the audit

From the repository root:

```powershell
node scripts/legacy-taiken-import-dry-run.js
```

The defaults are the real legacy workbook, a fresh live database snapshot, no approved teacher mappings, and `data/legacy/taiken-audit/` for output. The worksheet name is fixed; there is no `--execute`, `--import`, or staging-write option.

Supported options:

| Option | Purpose |
| --- | --- |
| `--file <path>` | Audit the Taiken sheet in another workbook. |
| `--snapshot <path>` | Explicitly replay a previously captured database snapshot instead of fetching current database state. The report identifies this as offline replay and retains the snapshot timestamp. |
| `--teacher-map <path>` | Supply owner-approved exact raw Teacher values mapped to existing eligible Ohashi profile UUIDs. |
| `--report-dir <path>` | Change the local output directory. Use a private, ignored location. |
| `--help` | Print command help without connecting to the database. |

The full outputs are:

- `data/legacy/taiken-audit/taiken-dry-run.md`: counts, exact headers, categorical values and mappings, correlations, proposed UUID links, and row-by-row blockers.
- `data/legacy/taiken-audit/taiken-dry-run.json`: full raw rows, exact normalized candidate values, source identities, match candidates, warnings, excluded non-data rows, and live schema metadata.

These files contain personal information, including names, contact details, Student UUIDs and raw legacy addresses. The owner explicitly approved versioning these two exact report files in this private repository for the machine handoff. Other files in the audit directory, including database snapshots and local tooling, remain ignored. Keep credentials, teacher mappings, and custom report directories out of Git. The committed reports preserve the original dry-run state; their no-push and ignored-directory wording describes that audit run, before this separately authorized Git handoff. Each run replaces these report filenames; compare the recorded workbook SHA-256 and snapshot timestamp when reviewing different runs.

## Database reads

The server-side snapshot helper loads `.env.local` when present. It uses `SUPABASE_DB_URL`, `DATABASE_URL`, `POSTGRES_URL`, or the existing `supabase/.temp/pooler-url`, in that order. The password must be supplied through `SUPABASE_DB_PASSWORD` or `PGPASSWORD`; passwords embedded in connection URLs are deliberately discarded.

For a Supabase pooler, the helper validates the configured project reference from `SUPABASE_PROJECT_REF` or `supabase/.temp/project-ref`. No actual tenant or Student UUID is hard-coded in the implementation.

The preferred transport is a local `psql` executable. `LEGACY_TAIKEN_PSQL` can specify its path. When psql is unavailable, the helper accepts an existing local `pg` module at `LEGACY_TAIKEN_PG_MODULE`, or at the private fallback path `data/legacy/taiken-audit/.tools/node_modules/pg/lib/index.js`. This optional client is a server-side audit tool, not an application or browser dependency.

Both transports start a repeatable-read, read-only transaction, run a fixed SELECT, and roll back. The snapshot must confirm the read-only transaction and exactly one Bee School HQ / Ohashi target. Missing access, missing metadata, or a failed connection aborts the audit rather than treating unknown Students as an empty matching population. Driver errors and credentials are not printed.

The snapshot reads current target-school Students and their email/phone contacts, teacher memberships and staff assignments, canonical lookup lists, and schema/RLS metadata. It changes no permissions and invokes no production RPCs.

## Source and mapping rules

The inspected workbook contains 108 genuine Taiken records. The audit preserves every genuine row, including unresolved inquiries, non-joined prospects, cancellations and old trials. Use the generated report as the authority for the exact current file hash, physical row count, headers and populated columns; the workbook may change between runs.

The actual headers include `コース`, lowercase `Level s2`, and the misspelling `adress`. Empty header cells receive distinct JSON keys such as `Column28`; the report also records the original empty header separately. Only explicitly identified FP-only legend rows, if present, are excluded as non-data.

| Legacy source | Existing production candidate | Rule |
| --- | --- | --- |
| Name | `prospects.japanese_name`, with `alphabet_name` for Latin-script names | Preserve the contact name. A missing required name blocks production readiness. |
| furigana | `prospects.furigana` | Kana-only names are accepted; operational notes remain raw for review. |
| mail / phone | Separate `prospect_contacts` rows | Normalize valid contacts only. Invalid originals stay in raw staging. Numeric phones with lost leading zeros are not silently repaired. |
| how they reached out | `prospects.inquiry_method_id` | Match the existing inquiry-method catalog using exact values or obvious explicit aliases. |
| How they know Bee | `prospects.acquisition_source_id` | Keep acquisition source independent from inquiry method. Unknown values remain unresolved. |
| day of taiken / Time of Taiken | `trial_lessons.trial_date` / `trial_time` | Parse validated calendar dates and Excel date/time serials; ambiguous or invalid values remain unresolved. |
| Type of lesson / コース | `trial_lessons.lesson_type` | Use existing `group`/`private` values only. A clear course type is a fallback only when Type of lesson is blank; conflicting values block the candidate. |
| Age group S1 | `trial_lessons.level_id`; named participant age group | Use unambiguous existing class-level mappings. Do not invent levels from numeric ages. |
| Level S1 / Level s2 | `trial_lesson_participants.requested_level_id` | Existing class levels only. Unmapped proficiency labels remain raw. |
| name of student 1 / name of student 2 | Separate `trial_lesson_participants` rows | Create one candidate per explicitly named participant. Never turn a contact-person name into an invented child participant. Mixed or unnamed households require review. |
| Request / notes | `trial_lessons.customer_request` / `internal_notes` | Preserve source text; do not append postal address. |
| Teacher | `trial_lessons.assigned_teacher_profile_id` | Only an exact owner-approved mapping to an eligible existing Ohashi teacher profile. Unknown teachers remain unassigned and warned. |
| adress / address | Raw audit JSON only | Never included in production candidates. |
| Column1 / PC / FP / Origin / Date received | Raw audit JSON only | No inferred business meaning or fabricated stable CustomerID. |

The prospective parent IDs are not fabricated. A future approved import transaction would attach `prospect_contacts.prospect_id`, `trial_lessons.prospect_id`, and `trial_lesson_participants.trial_lesson_id` after creating the relevant existing-schema rows.

The existing Trial Lesson schema requires `trial_date`, `trial_time`, `lesson_type` and `level_id`. Rows missing those values remain in the audit with blockers. The audit never substitutes invented schedules, lesson types, class levels or attendance outcomes to satisfy those constraints.

## Status evidence and existing Student links

Use only the existing statuses: `inquiry`, `booked`, `completed`, `no_show`, `cancelled`, `joined`, and `did_not_join`.

Explicit yes in Joined or Joined2 proposes Joined when the other evidence does not conflict. Explicit no/n or a historical refusal date proposes Did not join. Recognized cancellation wording proposes Cancelled. Blank outcomes stay unresolved; a scheduled date alone does not establish attendance.

Dates in Joined/Joined2 are conversion candidates for owner review. They do not establish an approved conversion by themselves. Source row 33 contains conflicting Joined=yes, Joined2=n, and refusal-date evidence: it remains unresolved, with no automatic converted Student link. The report shows every unique raw status value and its correlation with current Student matches.

Student matching stays inside the resolved organization and school:

- **A:** One strong existing match: a reliable stable legacy ID if available, or exact normalized email/phone plus a compatible exact name. The real Taiken sheet has no verified CustomerID.
- **B:** Probable or ambiguous candidates, including weak single signals, conflicting identities and household ambiguity. The owner reviews these.
- **C:** No current Student match found. Preserve the historical record without a link.

Named participant identities take precedence over the contact person. Multiple strong participants with different Student UUIDs require review of the trial's single primary link. Unnamed multi-person evidence prevents selecting a contact person automatically.

Only A plus confirmed, non-conflicting conversion evidence may populate the proposed `trial_lessons.converted_student_id`. Independently matched, explicitly named participants use their existing relational converted Student field. No Student is created, updated, merged, or deduplicated.

The current `/trial-lessons` page already renders **View student** from `trial_lessons.converted_student_id`, with a converted-participant fallback, and opens `/students/profile/?id=<uuid>`. This action retains its existing Trial Lesson manage permissions; the audit does not alter UI permissions.

## Staging and reruns

The unapplied migration [20260908001000_legacy_taiken_import_staging.sql](../supabase/migrations/20260908001000_legacy_taiken_import_staging.sql) extends the existing `legacy_student_import_batches` and `legacy_student_import_rows`. It creates no parallel Taiken production tables and changes no existing Student/Trial Lesson RLS.

The extension adds `import_kind=taiken`, a source SHA-256, match candidates/category, chosen existing Student UUID, future imported prospect/trial receipts and import status. Existing raw JSON, normalized candidates, warnings and duplicate-candidate fields are reused.

The deterministic source key is:

```text
school_id + source_file_sha256 + Taiken + source_row_number
```

A unique index reserves that identity across batches, and composite foreign keys enforce tenant scope and batch/source consistency. Taiken source identity and raw data are immutable. Imported receipts cannot be reset, reassigned or deleted, and must refer to the matching prospect/trial/existing Student relationships.

The current audit never inserts these staging rows. Rerunning it only regenerates reports. A changed workbook has a different source hash and requires duplicate review; the source key alone does not prove that rows from different workbook versions describe different real trials.

## Stop after review

Production import is deliberately not implemented or executed in this phase. Do not apply the staging migration or run a different importer as part of the audit.

Before a separately authorized production phase, review the exact UUID proposals, ambiguous Student/household identities, contradictory status evidence, date-only Joined meanings, missing required historical fields, teacher aliases and unresolved class/course mappings. Decide how historical refusal dates should be represented in existing notes, since there is no dedicated production refusal-date field.

That later phase still needs a reviewed executor that locks each staged source row and atomically writes the existing prospect/contact/trial/participant relationships and receipt. It must retain cross-batch idempotency, never create duplicate Students, and verify the resulting View student links. None of these writes are authorized by running this dry-run command.

Repository validation for this implementation is:

```powershell
npm run lint
npm run test
npm run build
```
