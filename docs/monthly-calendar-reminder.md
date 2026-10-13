# Monthly Calendar Reminder

This operational email uses the existing Communication Center template renderer, `communications` history, `communication_integration_actions` queue, and Resend dispatcher. The migration creates an inactive template and no automation settings row. No cron job is created.

## Manual rollout

1. Confirm that the preview, send, validation, and resolver RPCs from `20261009001000_communication_center_templates.sql` exist. The new migration depends on them. If they are absent, apply that file first through Supabase SQL Editor. Manually applied SQL Editor scripts may not appear in `supabase_migrations.schema_migrations`.
2. Pause the existing `communications-dispatch` trigger for the short cutover. Apply `supabase/migrations/20261013001000_monthly_calendar_reminder.sql` through Supabase SQL Editor. Its final `NOTIFY` refreshes the PostgREST schema cache.
3. Deploy the updated `communications-dispatch` function with the new atomic action-claim code, then resume its existing trigger. This avoids an old dispatcher instance reading actions while the claim mechanism is being introduced.
4. Deploy `monthly-calendar-reminder` as an Edge Function. Set a strong `MONTHLY_CALENDAR_CRON_SECRET` in its server environment. It also needs Supabase's server-side `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Do not configure its cron trigger yet.
5. In Communication Center → Templates, edit **Monthly Calendar Reminder**. Replace `[Calendar URL]` with the verified official calendar URL and set the template to **Active**. The template stays editable there.
6. In Communication Center → Automated Communications, select the intended organization, select an active student, and use **Preview**. This calls the existing server-side preview RPC and does not queue an email.

## Activation after approval

Set a day from 1 to 28 and a Japan time in Automated Communications, then enable the automation for the intended organization. The day and time are left unset in the migration. Create a recurring Supabase Cron trigger for `monthly-calendar-reminder` with the `x-monthly-calendar-cron-secret` header; choose the trigger frequency and actual send day/time with operations. The function checks the saved Japan-time schedule, so repeated trigger invocations are safe. The existing `communications-dispatch` trigger must remain operational to deliver queued messages.

The batch RPC pages through active students by ID with no 1,000-row cap. It writes `monthly_calendar:YYYY-MM:<student_id>` as the unique communication key. A valid recipient creates one queued communication and one Resend action. A missing or invalid recipient creates a skipped communication with the reason. Repeated or concurrent scheduler runs cannot create a second row for the same student and month.

The dispatcher atomically claims pending provider actions before calling Resend. Claims have a 15-minute review lease but are **never automatically reclaimed**: the provider may have accepted a request even if the worker lost its response. Terminal failures and uncertain claims require an administrator to check the provider record and communication history. Retry only after confirming that no delivery occurred and explicitly authorizing a manual reset of that action; do not resubmit an already sent message. This policy also applies to existing communication actions after the dispatcher update.

Disabling the automation stops new queueing and prevents its unclaimed actions from being claimed. It cannot recall a provider request already in flight. The status section shows the last run, recipient count, live sent, failed, and skipped totals, and expired claims needing review for that run month.
