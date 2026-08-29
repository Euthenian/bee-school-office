import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildCommunicationDraft,
  communicationMessageTypes,
  renderTemplate
} from "../lib/communication-templates.js";
import {
  processQueuedCommunicationActions,
  readCommunicationsWorkerConfig
} from "../lib/communications-worker.js";
import { communicationSelect, trialLessonSelect } from "../lib/data.js";
import { canManageCommunications } from "../lib/roles.js";

const communicationsMigrationSql = readFileSync(
  new URL("../supabase/migrations/20260827001000_communications_followup_foundation.sql", import.meta.url),
  "utf8"
);
const communicationsWorkerSource = readFileSync(new URL("../lib/communications-worker.js", import.meta.url), "utf8");
const communicationsPage = readFileSync(new URL("../app/(app)/communications/page.js", import.meta.url), "utf8");
const studentProfilePage = readFileSync(new URL("../app/(app)/students/profile/page.js", import.meta.url), "utf8");
const trialLessonsPage = readFileSync(new URL("../app/(app)/trial-lessons/page.js", import.meta.url), "utf8");
const communicationsEdgeFunction = readFileSync(
  new URL("../supabase/functions/communications-dispatch/index.ts", import.meta.url),
  "utf8"
);

test("communication template registry renders trial confirmation variables", () => {
  const draft = buildCommunicationDraft("trial_lesson_confirmation", {
    confirmed_date: "27 Aug 2026",
    confirmed_time: "16:30",
    lesson_type: "Group",
    recipient_name: "Parent Example",
    school_name: "Ohashi",
    student_name: "Student Example",
    teacher: "Teacher Example"
  });

  assert.deepEqual(
    communicationMessageTypes.map((type) => type.value),
    [
      "trial_lesson_confirmation",
      "trial_reminder",
      "no_show_follow_up",
      "schedule_change",
      "welcome_enrollment",
      "payment_information",
      "general_message",
      "custom"
    ]
  );
  assert.equal(draft.templateKey, "trial_lesson_confirmation");
  assert.match(draft.subject, /27 Aug 2026 16:30/);
  assert.match(draft.body, /Student Example/);
  assert.match(draft.body, /Teacher Example/);
  assert.equal(renderTemplate("Hello {{ name }}", { name: "Bee" }), "Hello Bee");
});

test("communications migration creates tenant-safe logs, idempotent actions, RLS, and follow-up state", () => {
  for (const table of [
    "communication_templates",
    "communications",
    "communication_integration_actions",
    "communication_automation_settings"
  ]) {
    assert.match(communicationsMigrationSql, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(communicationsMigrationSql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(communicationsMigrationSql, new RegExp(`revoke all on public\\.${table} from anon, authenticated`));
  }

  assert.match(communicationsMigrationSql, /add column if not exists no_show_at timestamptz/);
  assert.match(communicationsMigrationSql, /add column if not exists follow_up_due_at timestamptz/);
  assert.match(communicationsMigrationSql, /add column if not exists automated_follow_up_sent_at timestamptz/);
  assert.match(communicationsMigrationSql, /add column if not exists phone_follow_up_completed_at timestamptz/);
  assert.match(communicationsMigrationSql, /add column if not exists follow_up_state public\.trial_follow_up_state/);
  assert.match(communicationsMigrationSql, /constraint communications_trial_lesson_id_organization_id_school_id_fkey/);
  assert.match(communicationsMigrationSql, /idempotency_key text unique/);
  assert.match(communicationsMigrationSql, /create or replace function public\.confirm_trial_lesson_mvp/);
  assert.match(communicationsMigrationSql, /create or replace function public\.queue_communication_mvp/);
  assert.match(communicationsMigrationSql, /create or replace function public\.enqueue_due_no_show_follow_ups/);
  assert.match(communicationsMigrationSql, /create or replace function public\.record_communication_integration_result/);
  assert.match(communicationsMigrationSql, /create or replace function public\.mark_trial_lesson_phone_follow_up_complete/);
  assert.match(communicationsMigrationSql, /grant execute on function public\.enqueue_due_no_show_follow_ups\(integer\) to service_role/);
  assert.match(communicationsMigrationSql, /grant select, insert, update on public\.communication_integration_actions to authenticated/);
  assert.match(communicationsMigrationSql, /notify pgrst, 'reload schema'/);
});

test("communications stay administrative in UI and data helpers expose follow-up fields", () => {
  assert.equal(canManageCommunications({ school_memberships: [{ role: "teacher" }] }), false);
  assert.equal(canManageCommunications({ school_memberships: [{ role: "office_staff" }] }), true);

  for (const column of [
    "no_show_at",
    "follow_up_due_at",
    "automated_follow_up_sent_at",
    "phone_follow_up_completed_at",
    "follow_up_state"
  ]) {
    assert.match(trialLessonSelect, new RegExp(`\\b${column}\\b`));
  }

  assert.match(communicationSelect, /\bdelivery_status\b/);
  assert.match(studentProfilePage, /CommunicationComposer/);
  assert.match(studentProfilePage, /CommunicationHistory/);
  assert.match(studentProfilePage, />\s*Send email\s*</);
  assert.match(studentProfilePage, /\/communications\/\?studentId=/);
  assert.match(communicationsPage, /fetchCommunications/);
  assert.match(communicationsPage, /Communication history/);
  assert.match(trialLessonsPage, /needs_follow_up/);
  assert.match(trialLessonsPage, /Confirm trial lesson/);
  assert.match(trialLessonsPage, /Mark phone follow-up complete/);
  assert.match(trialLessonsPage, /getDefaultTrialLessonEmail/);
});

test("communications Edge Function uses server secrets and reports setup-required without Google credentials", () => {
  const { config, errors, googleReady, missingGoogleSecrets } = readCommunicationsWorkerConfig((name) =>
    ({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role"
    })[name]
  );

  assert.deepEqual(errors, []);
  assert.equal(googleReady, false);
  assert.equal(config.googleReady, false);
  assert.deepEqual(missingGoogleSecrets, [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REFRESH_TOKEN",
    "GOOGLE_GMAIL_SENDER_EMAIL",
    "GOOGLE_CALENDAR_ID"
  ]);
  assert.match(communicationsEdgeFunction, /COMMUNICATIONS_CRON_SECRET/);
  assert.match(communicationsWorkerSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(studentProfilePage, /SERVICE_ROLE|GOOGLE_CLIENT_SECRET|GOOGLE_REFRESH_TOKEN/);
  assert.doesNotMatch(trialLessonsPage, /SERVICE_ROLE|GOOGLE_CLIENT_SECRET|GOOGLE_REFRESH_TOKEN/);
});

test("communications worker processes queued email and calendar actions idempotently", async () => {
  const recordedResults = [];
  const result = await processQueuedCommunicationActions({
    config: {
      googleReady: true,
      maxActions: 10
    },
    emailProvider: {
      async sendEmail(payload) {
        assert.equal(payload.recipient, "parent@example.com");
        return { externalId: "gmail-message-1", responsePayload: { id: "gmail-message-1" }, status: "succeeded" };
      }
    },
    calendarProvider: {
      async createEvent(payload) {
        assert.equal(payload.date, "2026-08-27");
        return { externalId: "calendar-event-1", responsePayload: { id: "calendar-event-1" }, status: "succeeded" };
      }
    },
    repository: {
      async enqueueDueNoShowFollowUps() {
        return [{ trial_lesson_id: "trial-1" }];
      },
      async listPendingIntegrationActions() {
        return [
          {
            idempotency_key: "trial-1-email",
            provider: "gmail",
            action_type: "send_email",
            request_payload: {
              recipient: "parent@example.com",
              subject: "Subject",
              body: "Body"
            }
          },
          {
            idempotency_key: "trial-1-calendar",
            provider: "google_calendar",
            action_type: "create_calendar_event",
            request_payload: {
              date: "2026-08-27",
              time: "16:30",
              summary: "Trial"
            }
          }
        ];
      },
      async recordActionResult(row) {
        recordedResults.push(row);
      }
    },
    logger: quietLogger()
  });

  assert.equal(result.ok, true);
  assert.equal(result.enqueuedNoShowFollowUps, 1);
  assert.equal(result.processed, 2);
  assert.equal(result.succeeded, 2);
  assert.deepEqual(
    recordedResults.map((row) => row.externalId),
    ["gmail-message-1", "calendar-event-1"]
  );
});

function quietLogger() {
  return {
    error() {}
  };
}
