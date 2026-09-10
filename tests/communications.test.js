import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildCommunicationDraft,
  communicationMessageTypes,
  renderTemplate
} from "../lib/communication-templates.js";
import {
  createResendSenderClient,
  processQueuedCommunicationActions,
  readCommunicationsWorkerConfig
} from "../lib/communications-worker.js";
import { communicationSelect, trialLessonSelect } from "../lib/data.js";
import { canManageCommunications } from "../lib/roles.js";

const communicationsMigrationSql = readFileSync(
  new URL("../supabase/migrations/20260827001000_communications_followup_foundation.sql", import.meta.url),
  "utf8"
);
const communicationDeliveryStatusEnumFixSql = readFileSync(
  new URL("../supabase/migrations/20260909004000_fix_communication_delivery_status_enum_casts.sql", import.meta.url),
  "utf8"
);
const communicationsUseResendOutboundSql = readFileSync(
  new URL("../supabase/migrations/20260909005000_communications_use_resend_outbound.sql", import.meta.url),
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
const gmailTrialBookingWorkerSource = readFileSync(
  new URL("../lib/gmail-trial-booking-worker.js", import.meta.url),
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

test("communication queue RPCs cast delivery_status values to the enum type", () => {
  assert.match(
    communicationsMigrationSql,
    /create type public\.communication_delivery_status as enum \('draft', 'queued', 'sent', 'failed', 'partial_failed', 'skipped'\)/
  );
  assert.match(communicationDeliveryStatusEnumFixSql, /create or replace function public\.queue_communication_mvp/);
  assert.match(
    communicationDeliveryStatusEnumFixSql,
    /when p_channel = 'email' then 'queued'::public\.communication_delivery_status/
  );
  assert.match(communicationDeliveryStatusEnumFixSql, /else 'sent'::public\.communication_delivery_status/);
  assert.doesNotMatch(
    communicationDeliveryStatusEnumFixSql,
    /case\s+when p_channel = 'email' then 'queued' else 'sent' end/
  );
  assert.match(
    communicationDeliveryStatusEnumFixSql,
    /create or replace function public\.send_ai_eigo_student_invitation_mvp/
  );
  assert.match(communicationDeliveryStatusEnumFixSql, /'queued'::public\.communication_delivery_status/);
  assert.match(communicationDeliveryStatusEnumFixSql, /insert into public\.communications as c \(/);
  assert.match(communicationsMigrationSql, /'failed'::public\.communication_delivery_status/);
  assert.match(communicationsMigrationSql, /'skipped'::public\.communication_delivery_status/);
});

test("Bee School Office outbound communication queues use Resend", () => {
  assert.match(communicationsUseResendOutboundSql, /create or replace function public\.queue_communication_mvp/);
  assert.match(communicationsUseResendOutboundSql, /create or replace function public\.confirm_trial_lesson_mvp/);
  assert.match(communicationsUseResendOutboundSql, /create or replace function public\.enqueue_due_no_show_follow_ups/);
  assert.match(communicationsUseResendOutboundSql, /check \(provider in \('gmail', 'google_calendar', 'internal', 'resend'\)\)/);
  assert.match(communicationsUseResendOutboundSql, /case when p_channel = 'email' then 'resend' else null end/);
  assert.match(communicationsUseResendOutboundSql, /'communication:' \|\| v_communication_id::text \|\| ':resend_send'/);
  assert.match(communicationsUseResendOutboundSql, /v_email_action_idempotency_key = v_email_idempotency_key \|\| ':resend_send'/);
  assert.match(communicationsUseResendOutboundSql, /'resend',\s+'send_email'/);
  assert.doesNotMatch(communicationsUseResendOutboundSql, /'gmail',\s+'send_email'/);
  assert.doesNotMatch(communicationsEdgeFunction, /createGmailSenderClient/);
  assert.match(communicationsEdgeFunction, /createResendSenderClient/);
  assert.match(communicationsEdgeFunction, /BEE_SCHOOL_RESEND_API_KEY/);
  assert.match(communicationsEdgeFunction, /BEE_SCHOOL_EMAIL_FROM/);
  assert.match(communicationsEdgeFunction, /AI_EIGO_INVITATION_EMAIL_FROM/);
  assert.match(communicationsWorkerSource, /beeSchoolResendApiKey/);
  assert.match(communicationsWorkerSource, /beeSchoolEmailFrom/);
  assert.match(communicationsWorkerSource, /aiEigoInvitationEmailFrom/);
  assert.match(communicationsWorkerSource, /Gmail outbound email is disabled; email actions must use Resend\./);
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
    "GOOGLE_CALENDAR_ID"
  ]);
  assert.equal(config.resendReady, false);
  assert.deepEqual(config.missingResendSecrets, [
    "RESEND_API_KEY",
    "BEE_SCHOOL_RESEND_API_KEY",
    "BEE_SCHOOL_EMAIL_FROM",
    "AI_EIGO_INVITATION_EMAIL_FROM"
  ]);
  assert.match(communicationsEdgeFunction, /COMMUNICATIONS_CRON_SECRET/);
  assert.match(communicationsEdgeFunction, /createResendSenderClient/);
  assert.match(communicationsWorkerSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(communicationsWorkerSource, /RESEND_API_KEY/);
  assert.match(communicationsWorkerSource, /BEE_SCHOOL_RESEND_API_KEY/);
  assert.match(communicationsWorkerSource, /BEE_SCHOOL_EMAIL_FROM/);
  assert.match(communicationsWorkerSource, /AI_EIGO_INVITATION_EMAIL_FROM/);
  assert.doesNotMatch(studentProfilePage, /SERVICE_ROLE|GOOGLE_CLIENT_SECRET|GOOGLE_REFRESH_TOKEN/);
  assert.doesNotMatch(trialLessonsPage, /SERVICE_ROLE|GOOGLE_CLIENT_SECRET|GOOGLE_REFRESH_TOKEN/);
  assert.match(gmailTrialBookingWorkerSource, /GMAIL_SOURCE_MAILBOX/);
  assert.match(gmailTrialBookingWorkerSource, /https:\/\/gmail\.googleapis\.com\/gmail\/v1/);
  assert.doesNotMatch(communicationsWorkerSource, /users\/\$\{encodeURIComponent\(senderEmail\)\}\/messages\/send/);
  assert.doesNotMatch(gmailTrialBookingWorkerSource, /RESEND_API_KEY|AI_EIGO_INVITATION_EMAIL_FROM|resend/i);
});

test("Resend sender posts server-side email payloads and records the provider message id", async () => {
  const requests = [];
  const client = createResendSenderClient(
    { apiKey: "resend-key", from: "AI-EIGO <hello@ai-eigo.com>" },
    async (url, options = {}) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        async text() {
          return JSON.stringify({ id: "resend-message-1" });
        }
      };
    }
  );

  const result = await client.sendEmail({
    recipient: "student@example.com",
    subject: "Bee School AI-EIGO access invitation",
    body: "Please use https://ai-eigo.com/invite/secure-token"
  });
  const requestBody = JSON.parse(requests[0].options.body);

  assert.equal(requests[0].url, "https://api.resend.com/emails");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.headers.Authorization, "Bearer resend-key");
  assert.equal(requestBody.from, "AI-EIGO <hello@ai-eigo.com>");
  assert.deepEqual(requestBody.to, ["student@example.com"]);
  assert.equal(requestBody.subject, "Bee School AI-EIGO access invitation");
  assert.match(requestBody.text, /secure-token/);
  assert.match(requestBody.html, /secure-token/);
  assert.equal(result.externalId, "resend-message-1");
  assert.deepEqual(result.responsePayload, { id: "resend-message-1" });
  assert.equal(result.status, "succeeded");
});

test("Resend sender failures do not report success", async () => {
  const client = createResendSenderClient(
    { apiKey: "resend-key", from: "AI-EIGO <hello@ai-eigo.com>" },
    async () => ({
      ok: false,
      status: 403,
      async text() {
        return "";
      }
    })
  );

  await assert.rejects(
    () =>
      client.sendEmail({
        recipient: "student@example.com",
        subject: "Subject",
        body: "Body"
      }),
    /Resend send failed with HTTP 403/
  );
});

test("communications worker processes Resend email and calendar actions idempotently", async () => {
  const recordedResults = [];
  const result = await processQueuedCommunicationActions({
    config: {
      googleReady: true,
      resendReady: true,
      resendApiKey: "ai-eigo-resend-key",
      beeSchoolResendApiKey: "bee-school-resend-key",
      beeSchoolEmailFrom: "Bee School <binfo@beeschool.jp>",
      maxActions: 10
    },
    resendProvider: {
      async sendEmail(payload) {
        assert.equal(payload.recipient, "parent@example.com");
        return { externalId: "resend-message-1", responsePayload: { id: "resend-message-1" }, status: "succeeded" };
      }
    },
    aiEigoInvitationResendProvider: {
      async sendEmail() {
        throw new Error("AI-EIGO invitation sender should not handle Bee School Office email.");
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
            provider: "resend",
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
    ["resend-message-1", "calendar-event-1"]
  );
});

test("Bee School email requires the dedicated Bee School Resend key without falling back to AI-EIGO", async () => {
  const recordedResults = [];
  const result = await processQueuedCommunicationActions({
    config: {
      googleReady: true,
      resendReady: false,
      resendApiKey: "ai-eigo-resend-key",
      beeSchoolEmailFrom: "Bee School <binfo@beeschool.jp>",
      missingResendSecrets: ["BEE_SCHOOL_RESEND_API_KEY"],
      maxActions: 10
    },
    resendProvider: {
      async sendEmail() {
        throw new Error("Bee School email must not fall back to the AI-EIGO Resend key.");
      }
    },
    aiEigoInvitationResendProvider: {
      async sendEmail() {
        throw new Error("AI-EIGO sender should not handle Bee School Office email.");
      }
    },
    repository: {
      async enqueueDueNoShowFollowUps() {
        return [];
      },
      async listPendingIntegrationActions() {
        return [
          {
            idempotency_key: "bee-school-email",
            provider: "resend",
            action_type: "send_email",
            request_payload: {
              recipient: "parent@example.com",
              subject: "Subject",
              body: "Body"
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

  assert.equal(result.ok, false);
  assert.equal(result.setupRequired, true);
  assert.equal(result.processed, 0);
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.missingResendSecrets, ["BEE_SCHOOL_RESEND_API_KEY"]);
  assert.deepEqual(recordedResults, []);
});

test("communications worker never sends outbound email through Gmail", async () => {
  const recordedResults = [];
  const result = await processQueuedCommunicationActions({
    config: {
      googleReady: true,
      resendReady: true,
      maxActions: 10
    },
    resendProvider: {
      async sendEmail() {
        throw new Error("Resend should not handle Gmail-provider actions.");
      }
    },
    repository: {
      async enqueueDueNoShowFollowUps() {
        return [];
      },
      async listPendingIntegrationActions() {
        return [
          {
            idempotency_key: "legacy-gmail-action",
            provider: "gmail",
            action_type: "send_email",
            request_payload: {
              recipient: "parent@example.com",
              subject: "Subject",
              body: "Body"
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
  assert.equal(result.processed, 1);
  assert.equal(result.skipped, 1);
  assert.deepEqual(recordedResults, [
    {
      idempotencyKey: "legacy-gmail-action",
      status: "skipped",
      externalId: null,
      errorMessage: "Gmail outbound email is disabled; email actions must use Resend.",
      responsePayload: {}
    }
  ]);
});

function quietLogger() {
  return {
    error() {}
  };
}
