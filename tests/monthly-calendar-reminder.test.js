import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runMonthlyCalendarReminderBatches } from "../lib/monthly-calendar-reminder-worker.js";
import {
  createSupabaseRestCommunicationsRepository,
  processQueuedCommunicationActions
} from "../lib/communications-worker.js";

const migration = readFileSync(new URL("../supabase/migrations/20261013001000_monthly_calendar_reminder.sql", import.meta.url), "utf8");
const edge = readFileSync(new URL("../supabase/functions/monthly-calendar-reminder/index.ts", import.meta.url), "utf8");
const center = readFileSync(new URL("../app/(app)/communications/page.js", import.meta.url), "utf8");

test("monthly audience is exactly active students in the configured organization and moves by ID batches", () => {
  assert.match(migration, /s\.organization_id = v_settings\.organization_id and s\.status = 'active'/);
  assert.match(migration, /s\.id > v_settings\.last_student_id/);
  assert.match(migration, /order by s\.id limit p_limit/);
  for (const excluded of ["paused", "withdrawn", "graduated", "inactive", "pending"]) {
    assert.doesNotMatch(migration, new RegExp(`s\\.status\\s*=\\s*'${excluded}'`));
  }
});

test("recipient and name use the existing renderer; missing email is logged as skipped", () => {
  assert.match(migration, /public\.resolve_student_email_template_mvp\(v_settings\.template_key, v_student\.id\)/);
  assert.match(migration, /c\.contact_type = 'email'/);
  assert.match(migration, /order by c\.is_primary desc, c\.created_at asc, c\.id asc/);
  assert.match(migration, /raise exception 'No valid email recipient'/);
  assert.match(migration, /v_name := nullif\(concat_ws/);
  assert.match(migration, /v_body := replace\(v_body, '\{\{' \|\| v_match\[1\]/);
  assert.match(migration, /'automated', 'skipped', 'resend', v_key, v_error/);
  assert.match(migration, /jsonb_build_object\('month', v_month, 'reason', v_error\)/);
});

test("template URL is staff supplied, active, and rendered anew for each student", () => {
  assert.match(migration, /'monthly_calendar_reminder', 'Monthly Calendar Reminder'/);
  assert.match(migration, /\[Calendar URL\]/);
  assert.match(migration, /array\['student_name'\], false, 'inactive'/);
  assert.match(migration, /t\.status = 'active'/);
  assert.match(migration, /t\.body_template not like '%\[Calendar URL\]%'/);
  assert.doesNotMatch(migration, /\{\{calendar_url\}\}/);
  assert.match(migration, /v_message := public\.resolve_student_email_template_mvp/);
});

test("monthly keys are unique across repeated and concurrent batches but differ by month", () => {
  assert.match(migration, /v_key := 'monthly_calendar:' \|\| v_month \|\| ':' \|\| v_student\.id::text/);
  assert.match(migration, /on conflict \(idempotency_key\) do nothing returning id into v_id/);
  assert.match(migration, /if v_id is not null then\s+insert into public\.communication_integration_actions/);
  assert.match(migration, /limit 1 for update skip locked/);
  assert.match(migration, /to_char\(clock_timestamp\(\) at time zone 'Asia\/Tokyo', 'YYYY-MM'\)/);
});

test("disabled automation never queues and failure requires deliberate review", () => {
  assert.match(migration, /enabled boolean not null default false/);
  assert.match(migration, /where s\.enabled/);
  assert.match(migration, /and \(s\.run_month is distinct from v_month or s\.run_completed_at is null\)/);
  assert.match(migration, /where a\.status = 'pending' and a\.claim_token is null/);
  const claimFunction = migration.split("create function public.claim_communication_integration_actions")[1]
    .split("create function public.release_communication_integration_claim")[0];
  assert.doesNotMatch(claimFunction, /claim_expires_at\s*</);
  assert.match(edge, /MONTHLY_CALENDAR_CRON_SECRET/);
  assert.doesNotMatch(migration, /cron\.schedule/);
  assert.match(center, /<AutomatedCommunications/);
});

test("scheduler handles multiple batches without sending email itself", async () => {
  const requests = [];
  const results = [
    { due: true, processed: 200, queued: 198, skipped: 2, complete: false },
    { due: true, processed: 1, queued: 1, skipped: 0, complete: true },
    { due: false }
  ];
  const summary = await runMonthlyCalendarReminderBatches({
    supabaseUrl: "https://example.supabase.co/",
    serviceRoleKey: "test-key",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, async json() { return results.shift(); } };
    }
  });
  assert.deepEqual(summary, { batches: 2, processed: 201, queued: 199, skipped: 2, moreDue: false });
  assert.equal(requests.length, 3);
  assert.ok(requests.every(({ url }) => url.endsWith("/rpc/enqueue_monthly_calendar_reminder_batch")));
  assert.ok(requests.every(({ options }) => JSON.parse(options.body).p_limit === 200));
});

test("atomic claim gives concurrent dispatchers one send; failed result stays terminal", async () => {
  const action = {
    idempotency_key: "monthly_calendar:2026-10:student-1:resend_send",
    claim_token: null, status: "pending", provider: "resend", action_type: "send_email",
    request_payload: { recipient: "parent@example.com", subject: "Calendar", body: "October" }
  };
  let sent = 0;
  const repository = {
    async enqueueDueNoShowFollowUps() { return []; },
    async claimPendingIntegrationActions() {
      if (action.status !== "pending" || action.claim_token) return [];
      action.claim_token = "claim-1";
      return [{ ...action }];
    },
    async recordActionResult({ claimToken, status }) {
      assert.equal(claimToken, action.claim_token);
      action.status = status;
      action.claim_token = null;
    }
  };
  const options = {
    config: { maxActions: 10, beeSchoolResendApiKey: "test-key", beeSchoolEmailFrom: "Bee School <test@example.com>" },
    repository,
    resendProvider: { async sendEmail() { sent += 1; return { status: "failed", errorMessage: "Provider rejected" }; } },
    logger: { error() {} }
  };
  await Promise.all([
    processQueuedCommunicationActions(options),
    processQueuedCommunicationActions(options)
  ]);
  assert.equal(sent, 1);
  assert.equal(action.status, "failed");
  await processQueuedCommunicationActions(options);
  assert.equal(sent, 1);
});

test("an uncertain provider result keeps its claim and is not sent again", async () => {
  let claimed = false;
  let sendCount = 0;
  const repository = {
    async enqueueDueNoShowFollowUps() { return []; },
    async claimPendingIntegrationActions() {
      if (claimed) return [];
      claimed = true;
      return [{
        idempotency_key: "monthly_calendar:2026-10:student-2:resend_send",
        claim_token: "claim-2", provider: "resend", action_type: "send_email",
        request_payload: { recipient: "parent@example.com", subject: "Calendar", body: "October" }
      }];
    },
    async recordActionResult() { throw new Error("Database response lost"); }
  };
  const options = {
    config: { maxActions: 10, beeSchoolResendApiKey: "test-key", beeSchoolEmailFrom: "Bee School <test@example.com>" },
    repository,
    resendProvider: { async sendEmail() { sendCount += 1; return { status: "succeeded", externalId: "provider-1" }; } },
    logger: { error() {} }
  };
  const first = await processQueuedCommunicationActions(options);
  await processQueuedCommunicationActions(options);
  assert.equal(sendCount, 1);
  assert.equal(first.ok, false);
  assert.equal(first.errors[0].message, "Database response lost");
  assert.equal(claimed, true);
});

test("dispatcher sends claim token to the guarded result RPC", async () => {
  const requests = [];
  const repository = createSupabaseRestCommunicationsRepository({
    supabaseUrl: "https://example.supabase.co", serviceRoleKey: "service-key"
  }, async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    return { ok: true, async json() { return []; } };
  });
  await repository.claimPendingIntegrationActions({ limit: 10 });
  await repository.recordActionResult({ idempotencyKey: "key", claimToken: "claim", status: "succeeded" });
  assert.match(requests[0].url, /claim_communication_integration_actions$/);
  assert.match(requests[1].url, /record_claimed_communication_integration_result$/);
  assert.equal(requests[1].body.p_claim_token, "claim");
});
