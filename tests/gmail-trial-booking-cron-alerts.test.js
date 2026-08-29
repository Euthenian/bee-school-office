import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildCriticalAlertEmail,
  buildRecoveryAlertEmail,
  buildSafeCurrentPollResult,
  parseCronAlertRecipients,
  processGmailTrialBookingCronAlert,
  readGmailTrialBookingCronAlertConfig
} from "../lib/gmail-trial-booking-cron-alerts.js";

const alertMigrationSql = readFileSync(
  new URL("../supabase/migrations/20260829001000_gmail_trial_booking_cron_external_alerts.sql", import.meta.url),
  "utf8"
);
const edgeFunctionSource = readFileSync(
  new URL("../supabase/functions/gmail-trial-booking-poll/index.ts", import.meta.url),
  "utf8"
);
const alertHelperSource = readFileSync(
  new URL("../lib/gmail-trial-booking-cron-alerts.js", import.meta.url),
  "utf8"
);

const readyConfig = {
  alertRecipientHeader: "ops@example.com",
  alertRecipients: ["ops@example.com"],
  ready: true
};

test("cron alert migration creates service-role-only incident tracking", () => {
  assert.match(alertMigrationSql, /create table if not exists public\.gmail_trial_booking_cron_incidents/);
  assert.match(alertMigrationSql, /incident_status text not null default 'critical'/);
  assert.match(alertMigrationSql, /critical_alert_requested_at timestamptz/);
  assert.match(alertMigrationSql, /critical_alert_sent_at timestamptz/);
  assert.match(alertMigrationSql, /recovery_alert_requested_at timestamptz/);
  assert.match(alertMigrationSql, /recovery_alert_sent_at timestamptz/);
  assert.match(alertMigrationSql, /create unique index if not exists gmail_trial_booking_cron_incidents_one_open_uidx/);
  assert.match(alertMigrationSql, /where incident_status = 'critical'/);
  assert.match(alertMigrationSql, /alter table public\.gmail_trial_booking_cron_incidents enable row level security/);
  assert.match(alertMigrationSql, /revoke all on public\.gmail_trial_booking_cron_incidents from public, anon, authenticated/);
  assert.match(alertMigrationSql, /grant all on public\.gmail_trial_booking_cron_incidents to service_role/);
});

test("cron alert RPCs use authoritative cron history and are not browser-callable", () => {
  assert.match(alertMigrationSql, /create or replace function public\.evaluate_gmail_trial_booking_cron_alert_mvp/);
  assert.match(alertMigrationSql, /create or replace function public\.record_gmail_trial_booking_cron_alert_email_result/);
  assert.match(alertMigrationSql, /cron\.job_run_details/);
  assert.match(alertMigrationSql, /net\._http_response/);
  assert.match(alertMigrationSql, /pg_advisory_xact_lock/);
  assert.match(alertMigrationSql, /coalesce\(\(select auth\.role\(\)\), ''\) <> 'service_role'/);
  assert.match(alertMigrationSql, /grant execute on function public\.evaluate_gmail_trial_booking_cron_alert_mvp/);
  assert.match(alertMigrationSql, /to service_role/);
  assert.doesNotMatch(alertMigrationSql, /to authenticated/);
  assert.doesNotMatch(alertMigrationSql, /GMAIL_POLL_CRON_SECRET|\bTRIAL_BOOKING_CRON_ALERT_EMAIL\b|GMAIL_REFRESH_TOKEN|x-gmail-poll-secret|Bearer /i);
});

test("alert recipient config is server-side and comma separated", () => {
  const values = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    GMAIL_CLIENT_ID: "client-id",
    GMAIL_CLIENT_SECRET: "client-secret",
    GMAIL_REFRESH_TOKEN: "refresh-token",
    GMAIL_SOURCE_MAILBOX: "bee@example.com",
    TRIAL_BOOKING_CRON_ALERT_EMAIL: " Ops@Example.com, ops@example.com, owner@example.jp "
  };
  const result = readGmailTrialBookingCronAlertConfig((name) => values[name]);

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.config.alertRecipients, ["ops@example.com", "owner@example.jp"]);
  assert.equal(result.config.alertRecipientHeader, "ops@example.com, owner@example.jp");
  assert.deepEqual(parseCronAlertRecipients("bad,one@example.com, two@example.jp "), [
    "one@example.com",
    "two@example.jp"
  ]);
});

test("missing alert recipient config prevents email evaluation", async () => {
  const result = readGmailTrialBookingCronAlertConfig(() => "");
  const repository = createFakeAlertRepository([{ action: "send_critical_alert", incidentId: "incident-1" }]);
  const emails = [];

  const summary = await processGmailTrialBookingCronAlert({
    config: result.config,
    emailProvider: createFakeEmailProvider(emails),
    pollResult: { ok: false, processed: 0 },
    repository
  });

  assert.equal(summary.setupRequired, true);
  assert.equal(summary.sent, false);
  assert.equal(repository.evaluations.length, 0);
  assert.equal(emails.length, 0);
});

test("healthy and warning states do not send external emails", async () => {
  const repository = createFakeAlertRepository([
    { action: "none", healthStatus: "healthy" },
    { action: "none", healthStatus: "warning" }
  ]);
  const emails = [];

  const healthy = await processGmailTrialBookingCronAlert({
    config: readyConfig,
    emailProvider: createFakeEmailProvider(emails),
    pollResult: { ok: true, processed: 1, inserted: 0, skippedDuplicates: 1 },
    repository
  });
  const warning = await processGmailTrialBookingCronAlert({
    config: readyConfig,
    emailProvider: createFakeEmailProvider(emails),
    pollResult: { ok: false, processed: 1, errors: [{ stage: "list" }] },
    repository
  });

  assert.equal(healthy.sent, false);
  assert.equal(warning.sent, false);
  assert.equal(emails.length, 0);
});

test("critical incident sends one safe alert and repeated critical checks do not resend", async () => {
  const repository = createFakeAlertRepository([
    criticalEvaluation("incident-1", "2026-08-29T00:00:00.000Z"),
    { action: "none", incidentId: "incident-1", healthStatus: "critical" }
  ]);
  const emails = [];

  const first = await processGmailTrialBookingCronAlert({
    config: readyConfig,
    emailProvider: createFakeEmailProvider(emails),
    now: "2026-08-29T00:50:00.000Z",
    pollResult: { ok: false, parseErrors: 0, processed: 0 },
    repository
  });
  const second = await processGmailTrialBookingCronAlert({
    config: readyConfig,
    emailProvider: createFakeEmailProvider(emails),
    now: "2026-08-29T01:05:00.000Z",
    pollResult: { ok: false, parseErrors: 0, processed: 0 },
    repository
  });

  assert.equal(first.sent, true);
  assert.equal(second.sent, false);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].subject, "[Bee School Office] Trial Booking Import CRITICAL");
  assert.match(emails[0].body, /Trial Booking Gmail import is CRITICAL/);
  assertSafeAlertBody(emails[0].body);
  assert.deepEqual(repository.records.map((record) => record.alertType), ["critical"]);
});

test("recovery from a critical incident sends one recovery email only", async () => {
  const repository = createFakeAlertRepository([
    recoveryEvaluation("incident-1", "2026-08-29T00:00:00.000Z"),
    { action: "none", incidentId: "incident-1", healthStatus: "healthy" }
  ]);
  const emails = [];

  const first = await processGmailTrialBookingCronAlert({
    config: readyConfig,
    emailProvider: createFakeEmailProvider(emails),
    now: "2026-08-29T01:00:00.000Z",
    pollResult: { ok: true, processed: 0 },
    repository
  });
  const second = await processGmailTrialBookingCronAlert({
    config: readyConfig,
    emailProvider: createFakeEmailProvider(emails),
    now: "2026-08-29T01:15:00.000Z",
    pollResult: { ok: true, processed: 0 },
    repository
  });

  assert.equal(first.sent, true);
  assert.equal(second.sent, false);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].subject, "[Bee School Office] Trial Booking Import Recovered");
  assert.match(emails[0].body, /Trial Booking Gmail import has recovered/);
  assert.match(emails[0].body, /Incident duration minutes: 60/);
  assertSafeAlertBody(emails[0].body);
  assert.deepEqual(repository.records.map((record) => record.alertType), ["recovery"]);
});

test("separate future critical incidents can each send their own first alert", async () => {
  const repository = createFakeAlertRepository([
    criticalEvaluation("incident-1", "2026-08-29T00:00:00.000Z"),
    criticalEvaluation("incident-2", "2026-08-30T00:00:00.000Z")
  ]);
  const emails = [];

  await processGmailTrialBookingCronAlert({
    config: readyConfig,
    emailProvider: createFakeEmailProvider(emails),
    pollResult: { ok: false, processed: 0 },
    repository
  });
  await processGmailTrialBookingCronAlert({
    config: readyConfig,
    emailProvider: createFakeEmailProvider(emails),
    pollResult: { ok: false, processed: 0 },
    repository
  });

  assert.deepEqual(emails.map((email) => email.subject), [
    "[Bee School Office] Trial Booking Import CRITICAL",
    "[Bee School Office] Trial Booking Import CRITICAL"
  ]);
});

test("safe current poll result contains counts only", () => {
  const result = buildSafeCurrentPollResult({
    ok: false,
    processed: 2,
    inserted: 1,
    skippedDuplicates: 1,
    parseErrors: 0,
    errors: [{ message: "raw Gmail OAuth failure that should not be copied" }]
  });

  assert.equal(result, "current_poll_failed processed=2 inserted=1 duplicates=1 parse_errors=0 failed=1");
});

test("critical and recovery email builders do not include secrets or booking data", () => {
  const critical = buildCriticalAlertEmail({
    detectedAt: "2026-08-29T00:50:00.000Z",
    health: criticalEvaluation("incident-1", "2026-08-29T00:00:00.000Z")
  });
  const recovery = buildRecoveryAlertEmail({
    health: recoveryEvaluation("incident-1", "2026-08-29T00:00:00.000Z"),
    incident: recoveryEvaluation("incident-1", "2026-08-29T00:00:00.000Z"),
    recoveredAt: "2026-08-29T01:00:00.000Z"
  });

  assertSafeAlertBody(critical.body);
  assertSafeAlertBody(recovery.body);
  assert.doesNotMatch(critical.body, /Student|Phone|raw_body|gmail_message_id|Bearer|Authorization/i);
  assert.doesNotMatch(recovery.body, /Student|Phone|raw_body|gmail_message_id|Bearer|Authorization/i);
});

test("poll Edge Function integrates alerting without creating live Trial Lesson data", () => {
  assert.match(edgeFunctionSource, /processGmailTrialBookingCronAlert/);
  assert.match(edgeFunctionSource, /createGmailSenderClient/);
  assert.match(edgeFunctionSource, /TRIAL_BOOKING_CRON_ALERT_EMAIL|readGmailTrialBookingCronAlertConfig/);
  assert.match(edgeFunctionSource, /x-gmail-poll-secret/);
  assert.doesNotMatch(edgeFunctionSource, /create_trial_lesson_mvp/);
  assert.doesNotMatch(edgeFunctionSource, /from\("trial_lessons"\)/);
  assert.doesNotMatch(edgeFunctionSource, /from\("prospects"\)/);
  assert.doesNotMatch(alertHelperSource, /pending_trial_booking_imports|student_charges|payroll_entries|expenses/);
});

function criticalEvaluation(incidentId, incidentStartedAt) {
  return {
    action: "send_critical_alert",
    incidentId,
    healthStatus: "critical",
    incidentStartedAt,
    lastCronStatus: "succeeded",
    lastHttpStatus: 502,
    lastResult: "current_poll_failed processed=0 inserted=0 duplicates=0 parse_errors=0 failed=1",
    lastRunAt: "2026-08-29T00:45:00.000Z",
    lastSuccessAt: "2026-08-29T00:00:00.000Z",
    minutesSinceLastSuccess: 50,
    recentFailureCount: 2
  };
}

function recoveryEvaluation(incidentId, incidentStartedAt) {
  return {
    action: "send_recovery_alert",
    incidentId,
    healthStatus: "healthy",
    incidentStartedAt,
    lastCronStatus: "succeeded",
    lastHttpStatus: 200,
    lastResult: "current_poll_ok processed=0 inserted=0 duplicates=0 parse_errors=0 failed=0",
    lastRunAt: "2026-08-29T01:00:00.000Z",
    lastSuccessAt: "2026-08-29T01:00:00.000Z",
    minutesSinceLastSuccess: 0,
    recentFailureCount: 0
  };
}

function createFakeAlertRepository(evaluations) {
  return {
    evaluations: [],
    records: [],
    async evaluateCronAlert(input) {
      this.evaluations.push(input);
      return evaluations.shift() || { action: "none", healthStatus: "healthy" };
    },
    async recordCronAlertEmailResult(record) {
      this.records.push(record);
    }
  };
}

function createFakeEmailProvider(emails) {
  return {
    async sendEmail(email) {
      emails.push(email);
      return { externalId: `gmail-${emails.length}`, status: "succeeded" };
    }
  };
}

function assertSafeAlertBody(body) {
  assert.doesNotMatch(body, /Authorization|Bearer|GMAIL_|SUPABASE_|refresh_token|service_role|raw_body/i);
  assert.doesNotMatch(body, /student_name|customer_message|gmail_message_id|gmail_thread_id|source_mailbox/i);
  assert.doesNotMatch(body, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
}
