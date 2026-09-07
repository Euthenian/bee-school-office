# Bee School Office Excel Import Mapping

## One-Time Legacy Student Workbook Import

The legacy Bee School student workbook must go through a dry-run/staging pass before any production student records are created. Use:

```bash
node scripts/legacy-student-import-dry-run.js --file <legacy.xlsx> --school Ohashi --write-report <report.json>
```

The importer reads local `.xlsx` files directly and can also read controlled CSV exports. It produces a dry-run report only; it does not insert production students, contacts, enrollments, charges, notes, or entitlements.

Staging is backed by:

```text
legacy_student_import_batches
legacy_student_import_rows
```

These tables retain source row number, raw source JSON, normalized candidate JSON, validation state, warnings, errors, unresolved data, duplicate candidates, and the eventual `imported_student_id`/`imported_at` audit fields. RLS is enabled and access is limited to authenticated staff who can manage the target school, plus `service_role`.

Approved mapping boundaries:

```text
CustomerID -> normalized legacy_customer_id migration reference
Active -> authoritative students.status mapping only: Y = active, N = inactive
t -> students.first_name candidate
Last Name -> students.last_name candidate
Birthday -> students.date_of_birth candidate
Age -> students.age_override only when Birthday is blank
Mail / Gmail2 / email-like columns -> student_contacts email candidates
携帯 / phone-like columns -> student_contacts phone candidates
Teacher -> existing teacher profile mapping only
lesson type -> group/private candidate when recognized
Group Name -> class/enrollment grouping review
Joining / Joining Date / Start Date -> students.start_date candidate only when non-conflicting
Stop -> staged historical stop_date only; zero effect on students.status
Fee -> staged only; pricing policy required before final import
Review asked / Review left -> staged only; do not fabricate timestamps
Address 1 - Street / address-like columns -> staged only; enrolled-student address model required
Japanese name columns such as NameJp and adjacent Japanese-name columns -> staged until workbook direction confirms family/given mapping
```

Owner-approved obsolete columns are intentionally ignored even when populated:

```text
Name Suffix
To finance
RICO Next fee
Detail next fee
Column2
```

Do not create Bee School Office production fields for those obsolete columns, do not include them in the unresolved report, and do not block a row because they contain data. They may remain only in `raw_source_data` inside staging/import audit rows.

Production import should create every safely identifiable Students-sheet row, whether active or inactive. Rows with staged-only warnings such as unresolved teachers, conflicting start/joining dates, legacy fees, addresses, review state, Japanese-name direction, partial alphabet names, or duplicate candidates remain eligible for safe general student-field import; unresolved values stay in staging for later review. A row should be completely blocked only when the student identity or required current status cannot be imported safely.

The real production import runner is:

```bash
node scripts/legacy-student-import-production.js --execute
```

It is locked to `data/legacy/students-legacy.xlsm`, worksheet `Students`, unless explicit arguments are passed. The owner-approved production pass stages all 256 source rows, ignores only Students rows 2 and 129, and applies inactive status overrides only to rows 88, 195, and 219. The expected production result is 254 imported students: 63 active and 191 inactive. Production idempotency is keyed by school, source file SHA-256, sheet name, and source row number; CustomerID is preserved but is not unique because some real students share it.

The production student table carries nullable legacy identity fields for this import:

```text
students.legacy_customer_id
students.legacy_japanese_name
students.legacy_source_file_sha256
students.legacy_source_sheet_name
students.legacy_source_row_number
students.legacy_import_batch_id
```

These fields allow raw Japanese legacy names and source identity to be preserved without fabricating Japanese first/last name splits.

## Student Birthdays

Future Excel import work must map birthday or date-of-birth columns to:

```text
students.date_of_birth
```

The database column is nullable and uses SQL type `date`.

Do not infer, invent, or default a date when the source cell is missing, blank, malformed, or ambiguous. Leave `students.date_of_birth` null instead.

Do not import or store `age`. Age must be calculated from `students.date_of_birth` at read/display time so class grouping, birthday reminders, and statistics stay current.

## Trial Lessons

Future Excel import work must map trial-lesson rows into the prospect/trial schema, not into `students`, until an explicit conversion action creates a student.

Known mappings:

```text
Name -> prospects.japanese_name, prospects.alphabet_name, or trial_lesson_participants names depending on the source context
Furigana -> prospects.furigana or trial_lesson_participants.furigana
Email -> prospect_contacts where contact_type = 'email'
Phone -> prospect_contacts where contact_type = 'phone'
How they reached out -> prospects.inquiry_method_id
Time of Taiken -> trial_lessons.trial_time
Student 1 / Student 2 -> trial_lesson_participants rows
Age group -> trial_lesson_participants.age_group_level_id
Level -> trial_lesson_participants.requested_level_id or trial_lessons.level_id
Course -> source/review field first; do not automatically map to trial_lessons.level_id without an explicit owner-approved mapping table
Request -> trial_lessons.customer_request
How they know Bee -> prospects.acquisition_source_id
Type of lesson -> trial_lessons.lesson_type
Notes -> trial_lessons.internal_notes
Teacher -> trial_lessons.assigned_teacher_profile_id
Joined -> conversion status through trial_lessons.status = 'joined' and converted student links
PC -> UNRESOLVED - requires owner definition
```

Postal address must not be imported into Prospect or Trial Lesson records. If a source sheet or old paper Taiken form includes address, postal code, or equivalent physical-address fields, leave them out of the trial/prospect import path and defer them to a future enrollment/payment setup model for enrolled customers.

Do not infer or invent mappings for ambiguous columns. Keep raw source values available during future import review when owner definition is required.

The current Gmail Trial Booking flow stores `Course` separately from `Lesson type`. `Course` is reference data during review, and staff select the final class level manually. Future Excel imports should follow the same boundary unless a dedicated mapping model is implemented.
