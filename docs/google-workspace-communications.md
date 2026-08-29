# Bee School Office Google Workspace Communications

Bee School Office uses Google Workspace integration only at server-side boundaries. The static Next.js frontend must never contain Google OAuth secrets, refresh tokens, Supabase service-role credentials, Cron secrets, or Calendar credentials.

## Implemented Foundations

Outbound communications foundation:

- `communication_templates` stores reusable message templates.
- `communications` stores message snapshots, recipients, sender, source, delivery status, provider IDs, and errors.
- `communication_integration_actions` stores idempotent provider actions such as Gmail send and Google Calendar event creation.
- `communication_automation_settings` stores tenant-aware automation values, beginning with `no_show_follow_up_delay_hours`.
- `confirm_trial_lesson_mvp` updates the final trial date/time, marks the Trial Lesson as booked, queues confirmation email, and records the Calendar action.
- `enqueue_due_no_show_follow_ups` is service-role only and queues due no-show follow-up emails.
- `communications-dispatch` is the Supabase Edge Function boundary for live Gmail and Google Calendar execution.

Inbound Trial Booking foundation:

- `gmail-trial-booking-poll` is the Supabase Edge Function that polls Gmail for incoming Trial Booking email.
- Parsed rows are inserted into `pending_trial_booking_imports`.
- Human review is mandatory before any live Prospect, contact, Trial Lesson, or participant is created.
- The conversion path is documented in `docs/trial-booking-automation.md`.

## Canonical Gmail Account

Bee School Office uses the canonical Gmail integration for:

```text
bee.school.fukuoka@gmail.com
```

Do not create a second Google OAuth client, a second refresh token secret, a second Gmail account, or a replacement ingestion path unless the architecture is explicitly changed.

Existing Gmail secret names:

```text
GMAIL_CLIENT_ID
GMAIL_CLIENT_SECRET
GMAIL_REFRESH_TOKEN
GMAIL_SOURCE_MAILBOX
```

`GMAIL_REFRESH_TOKEN` is the shared refresh-token secret used by Gmail read and send workflows.

Current Gmail scopes required:

```text
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.send
```

If the existing token only has read access, reauthorize the existing OAuth client for the Bee School mailbox with:

```text
npm run gmail:reauthorize
```

The helper uses offline access and replaces the existing `GMAIL_REFRESH_TOKEN` Supabase secret. It must not print, document, or commit the token value.

## Supabase Secrets

Set server-side integration values as Supabase Edge Function secrets, not in `.env.local`:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
GMAIL_CLIENT_ID
GMAIL_CLIENT_SECRET
GMAIL_REFRESH_TOKEN
GMAIL_SOURCE_MAILBOX
GMAIL_TENANT_ORGANIZATION_ID
GMAIL_TENANT_SCHOOL_ID
GMAIL_IMPORT_AFTER
GMAIL_POLL_MAX_RESULTS
GMAIL_POLL_CRON_SECRET
TRIAL_BOOKING_CRON_ALERT_EMAIL
GOOGLE_CALENDAR_ID
GOOGLE_CALENDAR_TIME_ZONE
COMMUNICATIONS_CRON_SECRET
COMMUNICATIONS_MAX_ACTIONS
```

Only secret names are documented here. Secret values must remain in Supabase or another approved secret store.

## Cron Shape

Supabase Cron should invoke Edge Functions, not the static Next.js app and not Sakura hosting.

- Gmail Trial Booking polling uses `GMAIL_POLL_CRON_SECRET` and the `x-gmail-poll-secret` request header.
- Communications dispatch uses `COMMUNICATIONS_CRON_SECRET` and the `x-communications-cron-secret` request header.

The scheduled job must call only the intended Edge Function. Cron must not create live Trial Lessons directly; Gmail polling stops at pending imports.

Gmail Trial Booking Cron critical/recovery email alerting reuses the same server-side Gmail sender infrastructure. Recipients come only from the Supabase Edge Function secret `TRIAL_BOOKING_CRON_ALERT_EMAIL`; the browser must never supply or see recipient configuration.

## Idempotency

Outbound provider actions use stable idempotency keys:

- `trial_lesson:<trial_lesson_id>:trial_lesson_confirmation_email`
- `trial_lesson:<trial_lesson_id>:google_calendar_event`
- `trial_lesson:<trial_lesson_id>:no_show_follow_up_email`
- `communication:<communication_id>:gmail_send`

Inbound Trial Booking ingestion uses the Gmail message ID plus source mailbox. Gmail thread ID is preserved for audit context but is not the idempotency key.

Retries must update or skip existing work and must not create duplicate Gmail sends, Calendar events, or pending Trial Booking imports.

## Deferred

Do not claim these exist unless a later implementation proves otherwise:

- External SMS/Slack/LINE/push alerts for Cron failure.
- Full Calendar provider rollout beyond queued action foundations.
- Automatic live Trial Lesson creation from Gmail polling.
