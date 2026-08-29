# Bee School Office Excel Import Mapping

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
