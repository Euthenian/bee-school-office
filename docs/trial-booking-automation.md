# Gmail Trial Booking Automation

This document describes the implemented Trial Booking flow. It does not describe a planned replacement architecture.

## End-To-End Flow

Implemented flow:

```text
Website Trial Booking form
-> email to binfo@beeschool.jp
-> copy to bee.school.fukuoka@gmail.com
-> Gmail API
-> Supabase Edge Function gmail-trial-booking-poll
-> pending_trial_booking_imports
-> human review
-> Create Trial Lesson
-> prospect/contact/trial_lesson/trial_lesson_participant rows
```

Gmail polling never creates a live Trial Lesson by itself. A staff member must review the pending import and explicitly click Create Trial Lesson.

## Gmail Detection And Decoding

The Gmail worker searches incoming mailbox data with a query built from:

- `in:inbox`
- `-in:sent`
- `-from:calendar-notification@google.com`
- no reply/forward subjects
- subject contains `Trial Booking`
- `after:<GMAIL_IMPORT_AFTER>`

The parser is deterministic. It does not depend on an LLM.

Gmail API message bodies are base64url-encoded bytes. The worker decodes those bytes with UTF-8 so Japanese text is preserved. It prefers `text/plain` and falls back to extracting text from `text/html` when plain text is absent.

The parser keeps `Course` and `Lesson type` separate:

- `course` stores the booking email's Course value.
- `lesson_type` stores the booking email's Lesson type value.

`course` is source/reference data. It is not automatically mapped to `class_levels.id` or `trial_lessons.level_id`. Staff must select the final level manually during conversion.

## Idempotency And Source Metadata

The idempotency key is:

```text
source_mailbox + gmail_message_id
```

`gmail_thread_id` is preserved for audit/debug context, but it is not the idempotency key because a thread can contain multiple distinct Gmail messages.

Raw/source metadata is preserved, including source mailbox, Gmail message ID, Gmail thread ID, sender, recipient, subject, received timestamp, and raw body. Review edits should not overwrite these immutable source fields.

## Pending Trial Booking Imports

`pending_trial_booking_imports` stores parsed booking data before a live Trial Lesson exists.

Important fields:

- `booking_source`
- `trial_type`
- `student_name`
- `email`
- `phone`
- `student_age`
- `course`
- `lesson_type`
- `first_preferred_date`
- `first_preferred_time`
- `second_preferred_date`
- `second_preferred_time`
- `customer_message`
- `raw_body`
- `parse_status`
- `parse_error`
- `review_status`
- `converted_trial_lesson_id`
- `converted_at`
- `converted_by`

Parse statuses:

- `parsed`
- `parse_error`
- `ignored`

Review statuses:

- `pending_review`
- `reviewed`
- `dismissed`
- `converted`

The pending list is available at `/trial-lessons/imports/`. The review screen is `/trial-lessons/imports/review/`.

The Trial Lessons page and main sidebar show a pending booking count badge for `review_status = 'pending_review'`, scoped by the authenticated Supabase client and RLS.

## Review UI

The review UI lets staff edit parsed booking fields:

- student name
- email
- phone
- student age
- course
- lesson type
- first preferred date/time
- second preferred date/time
- customer message

Source metadata such as Gmail IDs, source mailbox, sender, subject, received time, and raw body is displayed read-only and must remain immutable.

Saving review corrections writes only back to `pending_trial_booking_imports` and sets `review_status = 'reviewed'`. It does not create prospects, contacts, Trial Lessons, or participants.

## Conversion To Live Trial Lesson

Only pending imports with:

```text
parse_status = 'parsed'
review_status = 'reviewed'
```

can be converted.

Conversion uses:

```text
convert_pending_trial_booking_import_to_trial_lesson
```

The RPC performs the conversion atomically:

- locks the pending import
- validates same-school authorization through `can_manage_school()`
- enforces reviewed/parsed status
- checks idempotency
- reuses an explicitly selected prospect or creates a new prospect
- creates missing non-duplicate email/phone contacts
- creates the Trial Lesson
- creates the participant
- marks the pending import as converted
- stores `converted_trial_lesson_id`, `converted_at`, and `converted_by`

If staff double-click or retry after conversion, the RPC returns the existing Trial Lesson information instead of creating another Trial Lesson.

Prospect candidate search is same-tenant and same-school. It uses normalized email, normalized phone, and student name as matching signals. The UI shows candidates but does not automatically merge or select one. Staff choose either Use existing prospect or Create new prospect.

## Scheduler

Production polling is scheduled through Supabase Cron / `pg_cron`.

- Job name: `bee-school-gmail-trial-booking-poll`
- Cadence: `*/15 * * * *`
- Edge Function: `gmail-trial-booking-poll`
- Secure header: `x-gmail-poll-secret`
- Secret source: `GMAIL_POLL_CRON_SECRET`

Existing Gmail messages are skipped by idempotency. The scheduler only creates pending import rows. It never creates live prospects, contacts, Trial Lessons, or participants.

Do not change `GMAIL_IMPORT_AFTER` during normal scheduling; it protects against accidental historical backfill.

## Cron Monitoring

Cron health monitoring is implemented through:

```text
get_gmail_trial_booking_cron_health
```

Authoritative sources:

- `cron.job_run_details`
- `net._http_response`

Health thresholds:

- healthy: successful run within the last 30 minutes
- warning: more than 30 minutes without success, or one recent failed execution
- critical: more than 45 minutes without success, no success, missing job, or repeated failures

The dashboard displays an alert only when the status is warning or critical. Healthy state does not create noisy alerts.

The health RPC exposes only safe status metadata such as last run, last success, last result, HTTP status, minutes since last success, and recent failure count. It must not expose Cron secrets, OAuth tokens, service-role keys, authorization headers, or Gmail secrets.

## External Critical Alerting

External email alerting is implemented for critical Gmail Trial Booking Cron incidents only. It reuses the server-side Gmail sender infrastructure from the communications worker.

Configuration:

- `TRIAL_BOOKING_CRON_ALERT_EMAIL`: comma-separated alert recipient email addresses, stored as a Supabase Edge Function secret.

Behavior:

- warning states do not send email
- transition to critical sends one email with subject `[Bee School Office] Trial Booking Import CRITICAL`
- repeated critical checks for the same incident do not resend
- transition from critical back to healthy sends one email with subject `[Bee School Office] Trial Booking Import Recovered`
- separate later incidents may each send their own critical and recovery messages

Persistent incident state is stored in `gmail_trial_booking_cron_incidents`. The alert RPCs are service-role only and expose no browser-callable email trigger.

Alert bodies include safe operational metadata only: status, detection/recovery time, last success, minutes since last success, latest safe Cron/function result, HTTP status, and recent failure count. They must not include booking content, customer data, Gmail OAuth values, Cron secrets, service-role keys, authorization headers, Vault values, or raw email bodies.

SMS, Slack, LINE, and push alerting are still deferred.
