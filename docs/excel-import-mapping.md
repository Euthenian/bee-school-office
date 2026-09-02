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
Active -> students.status candidate
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
Stop -> inactive/stopped status and enrollment end-date review
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

Final import remains blocked until the dry-run report is reviewed and any required policies are approved for Japanese name direction, enrolled-student postal addresses, legacy fee/pricing, review-state timestamps, unknown teachers, duplicate candidates, and conflicting start/joining dates.

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
