# Bee School Office Google Workspace Communications

Bee School Office now has the database and UI foundation for outbound communication, trial confirmation, Google Calendar preparation, and no-show follow-up.

The Next.js frontend remains a static Sakura-compatible app. It must never contain Google OAuth secrets or Supabase service-role credentials. Live sending and Calendar writes belong in Supabase Edge Functions.

## Current Foundation

- `communication_templates` stores canonical reusable message templates.
- `communications` stores immutable message snapshots and delivery state.
- `communication_integration_actions` stores idempotent provider actions such as Gmail send and Google Calendar event creation.
- `communication_automation_settings` stores tenant-aware automation values, beginning with `no_show_follow_up_delay_hours`.
- `trial_lessons` now records `no_show_at`, `follow_up_due_at`, `automated_follow_up_sent_at`, `phone_follow_up_completed_at`, and `follow_up_state`.
- `confirm_trial_lesson_mvp` updates the final date/time, sets status to `booked`, queues the confirmation email, and records the Calendar event action with idempotency keys.
- `enqueue_due_no_show_follow_ups` is service-role only and queues due no-show follow-up emails without depending on Sakura or a staff computer.
- `communications-dispatch` is the Supabase Edge Function boundary for Gmail and Google Calendar execution.

Until Google credentials are installed, the system records/queues actions but does not perform live Gmail or Calendar calls.

## Existing Gmail Setup

Bee School Office already has the canonical Gmail integration for:

```text
bee.school.fukuoka@gmail.com
```

Do not create a second Google OAuth client, a second refresh token secret, a second Gmail account, or a replacement ingestion path for outgoing mail. Outbound Gmail must reuse the same OAuth client and secret names used by the existing incoming booking-email worker.

Existing Gmail secret names:

```text
GMAIL_CLIENT_ID
GMAIL_CLIENT_SECRET
GMAIL_REFRESH_TOKEN
GMAIL_SOURCE_MAILBOX
```

`GMAIL_REFRESH_TOKEN` is the single refresh-token secret used by both incoming booking-email ingestion and outgoing Gmail sends.

Current Gmail scopes required:

```text
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.send
```

If the existing token only has Gmail read access, reauthorize the existing OAuth client for the Bee School mailbox with:

```text
npm run gmail:reauthorize
```

The helper uses offline access and replaces the existing `GMAIL_REFRESH_TOKEN` Supabase secret. It must not print or commit the refresh token.

## Supabase Secrets

Set these as Supabase Edge Function secrets, not in `.env.local`:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
GMAIL_CLIENT_ID
GMAIL_CLIENT_SECRET
GMAIL_REFRESH_TOKEN
GMAIL_SOURCE_MAILBOX
GOOGLE_CALENDAR_ID
GOOGLE_CALENDAR_TIME_ZONE
COMMUNICATIONS_CRON_SECRET
COMMUNICATIONS_MAX_ACTIONS
```

Calendar remains a separate future provider setup. Do not change the Gmail booking ingestion architecture when Calendar is configured later.

## Cron Shape

After the Edge Function is deployed, Supabase Cron should invoke it on a short interval such as every 15 minutes. Use the Supabase project function URL and pass the shared secret in the `x-communications-cron-secret` header.

The scheduled job must call only the Edge Function. It must not call the static Next.js app or require Sakura hosting to be online.

## Idempotency

Provider actions use stable idempotency keys:

- `trial_lesson:<trial_lesson_id>:trial_lesson_confirmation_email`
- `trial_lesson:<trial_lesson_id>:google_calendar_event`
- `trial_lesson:<trial_lesson_id>:no_show_follow_up_email`
- `communication:<communication_id>:gmail_send`

Retries must update existing pending/failed actions and must not create duplicate Gmail messages or Calendar events after an action has succeeded.
