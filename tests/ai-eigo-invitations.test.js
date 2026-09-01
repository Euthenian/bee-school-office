import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AI_EIGO_INVITATION_EXPIRY_DAYS,
  AI_EIGO_INVITATION_TEMPLATE_KEY,
  applyAiEigoInvitationResult,
  canSendAiEigoInvitationForStudent,
  getAiEigoAccessDetail,
  getAiEigoAccessStatus,
  getAiEigoAccessStatusLabel,
  getAiEigoInvitationActionLabel,
  getStudentInvitationRecipient
} from "../lib/ai-eigo-invitations.js";
import { createSupabaseRestCommunicationsRepository, processQueuedCommunicationActions } from "../lib/communications-worker.js";
import {
  sendAiEigoStudentInvitation,
  studentAiEigoInvitationSelect,
  studentAiEigoLinkSelect,
  studentListSelect,
  studentProfileSelect
} from "../lib/data.js";
import { canManageAiEigoInvitations } from "../lib/roles.js";

const aiEigoBaseInvitationSql = readFileSync(
  new URL("../supabase/migrations/20260829002000_ai_eigo_student_invitations.sql", import.meta.url),
  "utf8"
);
const aiEigoClaimIdempotencySql = readFileSync(
  new URL("../supabase/migrations/20260829003000_ai_eigo_claim_idempotency.sql", import.meta.url),
  "utf8"
);
const aiEigoPgcryptoQualificationSql = readFileSync(
  new URL("../supabase/migrations/20260831001000_fix_ai_eigo_invitation_pgcrypto_qualification.sql", import.meta.url),
  "utf8"
);
const aiEigoResendProviderSql = readFileSync(
  new URL("../supabase/migrations/20260831002000_ai_eigo_invitation_resend_provider.sql", import.meta.url),
  "utf8"
);
const aiEigoInvitationSql = `${aiEigoBaseInvitationSql}\n${aiEigoClaimIdempotencySql}\n${aiEigoPgcryptoQualificationSql}\n${aiEigoResendProviderSql}`;
const latestSendSql =
  aiEigoResendProviderSql.match(
    /create or replace function public\.send_ai_eigo_student_invitation_mvp[\s\S]*?grant execute on function public\.send_ai_eigo_student_invitation_mvp\(uuid\) to authenticated;/
  )?.[0] || aiEigoBaseInvitationSql;
const latestPrepareSql = extractMigrationFunctionSql(
  aiEigoPgcryptoQualificationSql,
  "prepare_ai_eigo_student_invitation_email_mvp",
  "uuid"
);
const latestVerifySql = extractMigrationFunctionSql(
  aiEigoPgcryptoQualificationSql,
  "verify_ai_eigo_student_invitation_mvp",
  "text"
);
const latestClaimSql =
  extractMigrationFunctionSql(aiEigoPgcryptoQualificationSql, "claim_ai_eigo_student_invitation_mvp", "text, text, text") ||
  extractMigrationFunctionSql(aiEigoClaimIdempotencySql, "claim_ai_eigo_student_invitation_mvp", "text, text, text") ||
  aiEigoClaimIdempotencySql;
const latestPrivilegedInvitationSql = [latestPrepareSql, latestVerifySql, latestClaimSql].join("\n");
const studentsPage = readFileSync(new URL("../app/(app)/students/page.js", import.meta.url), "utf8");
const studentProfilePage = readFileSync(new URL("../app/(app)/students/profile/page.js", import.meta.url), "utf8");
const communicationsWorkerSource = readFileSync(new URL("../lib/communications-worker.js", import.meta.url), "utf8");

test("student architecture uses contacts for invitation email and surfaces AI-EIGO state", () => {
  const student = {
    status: "active",
    student_contacts: [
      { contact_type: "email", created_at: "2026-08-29T00:00:00Z", is_primary: false, value: "secondary@example.com" },
      { contact_type: "email", created_at: "2026-08-29T00:00:01Z", is_primary: true, value: "Parent@Example.com" }
    ],
    ai_eigo_student_invitations: [],
    ai_eigo_student_links: []
  };

  assert.match(studentListSelect, /student_contacts \(/);
  assert.match(
    studentListSelect,
    /ai_eigo_student_invitations:ai_eigo_student_invitations!ai_eigo_student_invitations_student_id_fkey/
  );
  assert.match(studentListSelect, /ai_eigo_student_links:ai_eigo_student_links/);
  assert.match(
    studentProfileSelect,
    /ai_eigo_student_invitations:ai_eigo_student_invitations!ai_eigo_student_invitations_student_id_fkey/
  );
  assert.match(studentProfileSelect, /ai_eigo_student_links:ai_eigo_student_links/);
  assert.match(studentAiEigoInvitationSelect, /\bstatus\b/);
  assert.match(studentAiEigoLinkSelect, /\bentitlement_code\b/);
  assert.equal(getStudentInvitationRecipient(student), "Parent@Example.com");
  assert.equal(getAiEigoAccessStatus(student), "not_invited");
  assert.equal(getAiEigoAccessStatusLabel("not_invited"), "Not invited");
  assert.equal(getAiEigoInvitationActionLabel(student), "Send AI-EIGO invitation");
  assert.equal(canSendAiEigoInvitationForStudent(student), true);
});

test("AI-EIGO migration creates tenant-scoped invitation and link tables without raw token storage", () => {
  const invitationTable = aiEigoInvitationSql.match(/create table if not exists public\.ai_eigo_student_invitations \([\s\S]*?\n\);/)?.[0] || "";
  const linkTable = aiEigoInvitationSql.match(/create table if not exists public\.ai_eigo_student_links \([\s\S]*?\n\);/)?.[0] || "";

  assert.match(aiEigoInvitationSql, /create type public\.ai_eigo_invitation_status as enum/);
  assert.match(invitationTable, /\borganization_id uuid not null/);
  assert.match(invitationTable, /\bschool_id uuid not null/);
  assert.match(invitationTable, /\bstudent_id uuid not null/);
  assert.match(invitationTable, /\brecipient_email citext not null/);
  assert.match(invitationTable, /\btoken_hash text/);
  assert.match(invitationTable, /\btoken_expires_at timestamptz/);
  assert.match(invitationTable, /constraint ai_eigo_student_invitations_student_id_organization_id_school_id_fkey/);
  assert.match(linkTable, /\bai_eigo_user_id text not null/);
  assert.match(linkTable, /\bentitlement_code text not null default 'bee'/);
  assert.match(linkTable, /check \(entitlement_code = 'bee'\)/);
  assert.match(linkTable, /unique \(student_id\)/);
  assert.match(linkTable, /unique \(ai_eigo_user_id\)/);
  assert.match(aiEigoInvitationSql, /ai_eigo_student_invitations_token_hash_uidx/);
  assert.match(aiEigoInvitationSql, /ai_eigo_student_invitations_one_active_per_student_uidx/);
  assert.doesNotMatch(invitationTable, /\braw_token\b|\btoken\b text|\binvitation_url\b/i);
  assert.doesNotMatch(aiEigoInvitationSql, /\bbee_student\b|\bpremium\b|\bpro\b|\bavatar\b|\bisBee\b|\bplan\b/i);
});

test("AI-EIGO authorization follows school-managed student access and keeps privileged writes server-side", () => {
  assert.equal(canManageAiEigoInvitations({ school_memberships: [{ role: "school_manager" }] }), true);
  assert.equal(canManageAiEigoInvitations({ school_memberships: [{ role: "office_staff" }] }), true);
  assert.equal(canManageAiEigoInvitations({ school_memberships: [{ role: "teacher" }] }), false);

  assert.match(aiEigoInvitationSql, /security definer[\s\S]*set search_path = public, pg_temp/);
  assert.match(aiEigoInvitationSql, /public\.can_manage_student\(v_student\.id\)/);
  assert.match(aiEigoInvitationSql, /revoke all on public\.ai_eigo_student_invitations from public, anon, authenticated/);
  assert.match(aiEigoInvitationSql, /revoke all on public\.ai_eigo_student_links from public, anon, authenticated/);
  assert.match(aiEigoInvitationSql, /grant select on public\.ai_eigo_student_invitations to authenticated/);
  assert.match(aiEigoInvitationSql, /grant select on public\.ai_eigo_student_links to authenticated/);
  assert.doesNotMatch(aiEigoInvitationSql, /grant (insert|update|delete)[^;]+public\.ai_eigo_student_(invitations|links)[^;]+to authenticated/i);
  assert.match(aiEigoInvitationSql, /grant execute on function public\.send_ai_eigo_student_invitation_mvp\(uuid\) to authenticated/);
  assert.match(aiEigoInvitationSql, /coalesce\(\(select auth\.role\(\)\), ''\) <> 'service_role'/);
  assert.match(aiEigoInvitationSql, /grant execute on function public\.claim_ai_eigo_student_invitation_mvp\(text, text, text\) to service_role/);
  assert.doesNotMatch(aiEigoInvitationSql, /grant execute on function public\.claim_ai_eigo_student_invitation_mvp\(text, text, text\) to authenticated/);
});

test("AI-EIGO privileged invitation RPCs qualify pgcrypto under the restricted search path", () => {
  assert.ok(latestPrepareSql);
  assert.ok(latestVerifySql);
  assert.ok(latestClaimSql);
  assert.match(latestPrivilegedInvitationSql, /security definer[\s\S]*set search_path = public, pg_temp/);
  assert.doesNotMatch(latestPrivilegedInvitationSql, /set search_path = public,\s*extensions|set search_path = extensions/i);
  assert.match(latestPrepareSql, /extensions\.gen_random_bytes\(32\)/);
  assert.match(latestPrepareSql, /extensions\.digest\(v_raw_token, 'sha256'\)/);
  assert.match(latestVerifySql, /extensions\.digest\(trim\(p_token\), 'sha256'\)/);
  assert.match(latestClaimSql, /extensions\.digest\(trim\(p_token\), 'sha256'\)/);
  assert.deepEqual(listUnqualifiedPgcryptoCalls(latestPrivilegedInvitationSql), []);
});

test("send invitation RPC queues the existing Resend integration and returns the created invitation state", async () => {
  const calls = [];
  const supabase = {
    async rpc(name, params) {
      calls.push(["rpc", name, params]);
      return {
        data: [{ id: "invite-1", recipient_email: "student@example.com", status: "pending_send" }],
        error: null
      };
    }
  };

  const result = await sendAiEigoStudentInvitation(supabase, "student-1");
  const actionPayload = latestSendSql.match(/jsonb_build_object\([\s\S]*?'invitation_id', v_invitation_id[\s\S]*?\)/)?.[0] || "";

  assert.deepEqual(calls, [["rpc", "send_ai_eigo_student_invitation_mvp", { p_student_id: "student-1" }]]);
  assert.equal(result.data.id, "invite-1");
  assert.match(latestSendSql, /insert into public\.communications/);
  assert.match(latestSendSql, /insert into public\.communication_integration_actions/);
  assert.match(aiEigoInvitationSql, /where ct\.template_key = 'ai_eigo_student_invitation'/);
  assert.match(aiEigoInvitationSql, /public\.render_text_template\(v_template\.body_template, v_context\)/);
  assert.match(latestSendSql, /'resend'/);
  assert.match(latestSendSql, /'send_email'/);
  assert.match(latestSendSql, /:resend_send/);
  assert.doesNotMatch(latestSendSql, /:gmail_send|'gmail'/);
  assert.match(actionPayload, new RegExp(`'template_key', '${AI_EIGO_INVITATION_TEMPLATE_KEY}'`));
  assert.match(actionPayload, /'invitation_id', v_invitation_id/);
  assert.doesNotMatch(actionPayload, /https:\/\/ai-eigo\.com|v_raw_token|token_hash|invitation_link/i);
});

test("communications worker prepares AI-EIGO invitation email just in time and uses Resend sender", async () => {
  const emails = [];
  const records = [];
  const prepared = [];

  const result = await processQueuedCommunicationActions({
    config: { googleReady: true, resendReady: true, maxActions: 10 },
    emailProvider: {
      async sendEmail() {
        throw new Error("Gmail should not be used for AI-EIGO invitations.");
      }
    },
    resendProvider: {
      async sendEmail(payload) {
        emails.push(payload);
        return { externalId: "resend-message-1", responsePayload: { id: "resend-message-1" }, status: "succeeded" };
      }
    },
    calendarProvider: {
      async createEvent() {
        throw new Error("Calendar should not be used for AI-EIGO invitations.");
      }
    },
    repository: {
      async enqueueDueNoShowFollowUps() {
        return [];
      },
      async listPendingIntegrationActions() {
        return [
          {
            idempotency_key: "ai-eigo-invite-email",
            provider: "resend",
            action_type: "send_email",
            request_payload: {
              template_key: AI_EIGO_INVITATION_TEMPLATE_KEY,
              invitation_id: "invite-1"
            }
          }
        ];
      },
      async prepareAiEigoInvitationEmail({ invitationId }) {
        prepared.push(invitationId);
        return {
          recipient: "student@example.com",
          subject: "Bee School AI-EIGO access invitation",
          body: "Please use https://ai-eigo.com/invite/secure-token"
        };
      },
      async recordActionResult(row) {
        records.push(row);
      }
    },
    logger: quietLogger()
  });

  assert.equal(result.ok, true);
  assert.deepEqual(prepared, ["invite-1"]);
  assert.equal(emails[0].recipient, "student@example.com");
  assert.match(emails[0].body, /https:\/\/ai-eigo\.com\/invite\/secure-token/);
  assert.equal(records[0].status, "succeeded");
  assert.equal(records[0].externalId, "resend-message-1");
  assert.match(communicationsWorkerSource, /createResendSenderClient/);
  assert.match(communicationsWorkerSource, /prepareAiEigoInvitationEmail/);
});

test("REST communications repository calls the service-only AI-EIGO email preparation RPC", async () => {
  const requests = [];
  const repository = createSupabaseRestCommunicationsRepository(
    { supabaseUrl: "https://example.supabase.co", serviceRoleKey: "service-role" },
    async (url, options = {}) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        async json() {
          return [{ recipient: "student@example.com", subject: "Subject", body: "Body" }];
        }
      };
    }
  );

  const payload = await repository.prepareAiEigoInvitationEmail({ invitationId: "invite-1" });

  assert.equal(payload.recipient, "student@example.com");
  assert.match(requests[0].url, /\/rest\/v1\/rpc\/prepare_ai_eigo_student_invitation_email_mvp$/);
  assert.equal(JSON.parse(requests[0].options.body).p_invitation_id, "invite-1");
});

test("email send failure does not mark an invitation as successfully invited", () => {
  assert.match(aiEigoInvitationSql, /when p_status = 'failed' then 'send_failed'::public\.ai_eigo_invitation_status/);
  assert.match(aiEigoInvitationSql, /last_send_error = case when p_status = 'failed'/);
  assert.match(aiEigoInvitationSql, /token_hash = case when p_status = 'failed' then null else inv\.token_hash end/);
  assert.match(aiEigoInvitationSql, /token_expires_at = case when p_status = 'failed' then null else inv\.token_expires_at end/);
});

test("secure invitation tokens are random, hashed, expiring, and single-claim", () => {
  assert.equal(AI_EIGO_INVITATION_EXPIRY_DAYS, 14);
  assert.match(aiEigoInvitationSql, /gen_random_bytes\(32\)/);
  assert.match(aiEigoInvitationSql, /encode\(digest\(v_raw_token, 'sha256'\), 'hex'\)/);
  assert.match(aiEigoInvitationSql, /v_expires_at = v_now \+ interval '14 days'/);
  assert.match(aiEigoInvitationSql, /v_link = 'https:\/\/ai-eigo\.com\/invite\/' \|\| v_raw_token/);
  assert.match(aiEigoInvitationSql, /v_hash = encode\(digest\(trim\(p_token\), 'sha256'\), 'hex'\)/);
  assert.match(aiEigoInvitationSql, /if v_invitation\.token_expires_at <= v_now then/);
  assert.match(aiEigoInvitationSql, /set status = 'expired'/);
  assert.match(aiEigoInvitationSql, /if v_invitation\.claimed_at is not null or v_invitation\.status = 'claimed' then/);
  assert.match(aiEigoInvitationSql, /set status = 'claimed'/);
  assert.match(aiEigoClaimIdempotencySql, /status = 'claimed'[\s\S]*and \(token_hash is null or token_expires_at is not null\)/);
  const latestClaimedUpdate =
    latestClaimSql.match(/update public\.ai_eigo_student_invitations inv\s+set status = 'claimed'[\s\S]*?where inv\.id = v_invitation\.id;/)?.[0] || "";
  assert.doesNotMatch(latestClaimedUpdate, /token_hash\s*=/);
  assert.doesNotMatch(latestClaimedUpdate, /token_expires_at\s*=/);
});

test("AI-EIGO claim contract links the student and only returns canonical bee entitlement", () => {
  assert.match(aiEigoInvitationSql, /create or replace function public\.verify_ai_eigo_student_invitation_mvp/);
  assert.match(aiEigoInvitationSql, /create or replace function public\.claim_ai_eigo_student_invitation_mvp/);
  assert.match(aiEigoInvitationSql, /insert into public\.ai_eigo_student_links/);
  assert.match(aiEigoInvitationSql, /v_link\.entitlement_code/);
  assert.match(aiEigoInvitationSql, /'bee'/);
  assert.doesNotMatch(aiEigoInvitationSql, /all Premium|Ai-eigo Plus|arbitrary future Premium|avatar/i);
});

test("AI-EIGO claim contract is idempotent only for the same linked user", () => {
  assert.match(aiEigoClaimIdempotencySql, /drop function if exists public\.claim_ai_eigo_student_invitation_mvp\(text, text, text\)/);
  assert.match(latestClaimSql, /claim_status text/);
  assert.match(latestClaimSql, /v_claim_user_id = trim\(p_ai_eigo_user_id\)/);
  assert.match(latestClaimSql, /where inv\.token_hash = v_hash/);
  assert.match(latestClaimSql, /if v_invitation\.claimed_at is not null or v_invitation\.status = 'claimed' then/);
  assert.match(latestClaimSql, /if v_invitation\.claimed_ai_eigo_user_id = v_claim_user_id then/);
  assert.match(latestClaimSql, /where link\.student_id = v_invitation\.student_id\s+and link\.ai_eigo_user_id = v_claim_user_id/);
  assert.match(latestClaimSql, /'already_linked_same_user'::text/);
  assert.match(latestClaimSql, /'linked'::text/);
  assert.match(latestClaimSql, /AI-EIGO invitation has already been claimed by another AI-EIGO user/);
});

test("AI-EIGO claim retry does not create duplicate links or change link identity", () => {
  const claimedBranch =
    latestClaimSql.match(
      /if v_invitation\.claimed_at is not null or v_invitation\.status = 'claimed' then[\s\S]*?raise exception 'AI-EIGO invitation has already been claimed by another AI-EIGO user.';/
    )?.[0] || "";

  assert.doesNotMatch(claimedBranch, /insert into public\.ai_eigo_student_links/);
  assert.doesNotMatch(claimedBranch, /update public\.ai_eigo_student_invitations[\s\S]*status = 'manual_review'/);
  assert.match(claimedBranch, /v_link\.student_id/);
  assert.match(claimedBranch, /v_link\.organization_id/);
  assert.match(claimedBranch, /v_link\.school_id/);
  assert.match(claimedBranch, /v_link\.ai_eigo_user_id/);
  assert.match(claimedBranch, /v_link\.ai_eigo_email::text/);
  assert.match(claimedBranch, /v_link\.entitlement_code/);
  assert.match(claimedBranch, /v_link\.linked_at/);
});

test("AI-EIGO verify reports claimed invitations as non-claimable information", () => {
  const verifySql =
    aiEigoBaseInvitationSql.match(
      /create or replace function public\.verify_ai_eigo_student_invitation_mvp[\s\S]*?grant execute on function public\.verify_ai_eigo_student_invitation_mvp\(text\) to service_role;/
    )?.[0] || "";

  assert.match(verifySql, /when v_row\.claimed_at is not null then 'claimed'/);
  assert.match(verifySql, /v_row\.status = 'sent'\s+and v_row\.revoked_at is null\s+and v_row\.claimed_at is null\s+and v_row\.token_expires_at > now\(\)/);
  assert.match(verifySql, /when v_row\.claimed_at is not null then 'already_claimed'/);
});

test("AI-EIGO terminal and exception claim paths stay protected", () => {
  assert.match(latestClaimSql, /if v_invitation\.revoked_at is not null or v_invitation\.status = 'revoked' then/);
  assert.match(latestClaimSql, /AI-EIGO invitation has been revoked/);
  assert.match(latestClaimSql, /if v_invitation\.token_expires_at is null or v_invitation\.token_expires_at <= v_now then/);
  assert.match(latestClaimSql, /AI-EIGO invitation has expired/);
  assert.match(latestClaimSql, /if v_claim_email <> v_invitation\.recipient_email then/);
  assert.match(latestClaimSql, /status = 'manual_review'/);
  assert.match(latestClaimSql, /AI-EIGO login email did not match the invitation recipient/);
  assert.match(latestClaimSql, /Invitation recipient email is shared by multiple Bee students/);
  assert.match(latestClaimSql, /where link\.student_id = v_invitation\.student_id\s+or link\.ai_eigo_user_id = v_claim_user_id/);
  assert.match(aiEigoBaseInvitationSql, /set status = 'revoked'[\s\S]*where inv\.student_id = v_student\.id/);
});

test("mismatched or shared AI-EIGO accounts go to manual review instead of auto-granting Bee", () => {
  assert.match(aiEigoInvitationSql, /if v_claim_email <> v_invitation\.recipient_email then/);
  assert.match(aiEigoInvitationSql, /status = 'manual_review'/);
  assert.match(aiEigoInvitationSql, /AI-EIGO login email did not match the invitation recipient/);
  assert.match(aiEigoInvitationSql, /Invitation recipient email is shared by multiple Bee students/);
  assert.match(aiEigoInvitationSql, /where link\.student_id = v_invitation\.student_id\s+or link\.ai_eigo_user_id = trim\(p_ai_eigo_user_id\)/);
  assert.match(aiEigoInvitationSql, /The Bee student or AI-EIGO account is already linked/);
});

test("student UI shows AI-EIGO status and send/resend actions without QR-code activation", () => {
  const invitedStudent = applyAiEigoInvitationResult(
    {
      id: "student-1",
      status: "active",
      student_contacts: [{ contact_type: "email", is_primary: true, value: "student@example.com" }],
      ai_eigo_student_invitations: [],
      ai_eigo_student_links: []
    },
    { id: "invite-1", recipient_email: "student@example.com", status: "sent", sent_at: "2026-08-29T00:00:00Z" }
  );
  const linkedStudent = {
    ...invitedStudent,
    ai_eigo_student_links: [{ ai_eigo_user_id: "ai-user-1", entitlement_code: "bee", linked_at: "2026-08-29T00:00:00Z" }]
  };

  assert.equal(getAiEigoAccessStatus(invitedStudent), "sent");
  assert.equal(getAiEigoInvitationActionLabel(invitedStudent), "Resend invitation");
  assert.equal(getAiEigoAccessStatus(linkedStudent), "linked");
  assert.equal(getAiEigoInvitationActionLabel(linkedStudent), "");
  assert.match(getAiEigoAccessDetail(linkedStudent), /AI-EIGO: Linked/);
  assert.match(studentsPage, /AI-EIGO/);
  assert.match(studentsPage, /AiEigoStudentListCell/);
  assert.match(studentProfilePage, /AI-EIGO Access/);
  assert.match(studentProfilePage, /handleSendAiEigoInvitation/);
  assert.doesNotMatch(`${studentsPage}\n${studentProfilePage}`, /secure Gmail sending/);
  assert.doesNotMatch(`${studentsPage}\n${studentProfilePage}\n${communicationsWorkerSource}`, /QRCode|qr_code|classroom QR|generic Bee code/i);
});

function quietLogger() {
  return {
    error() {}
  };
}

function extractMigrationFunctionSql(sql, functionName, grantArgs) {
  return (
    sql.match(
      new RegExp(
        `create or replace function public\\.${functionName}[\\s\\S]*?grant execute on function public\\.${functionName}\\(${grantArgs}\\) to service_role;`
      )
    )?.[0] || ""
  );
}

function listUnqualifiedPgcryptoCalls(sql) {
  return [...sql.matchAll(/\b(?:digest|gen_random_bytes)\s*\(/g)]
    .filter((match) => sql.slice(Math.max(0, match.index - "extensions.".length), match.index) !== "extensions.")
    .map((match) => match[0]);
}
