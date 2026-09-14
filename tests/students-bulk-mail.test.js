import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bulkQueueStudentEmails } from "../lib/data.js";

const studentsPage = readFileSync(new URL("../app/(app)/students/page.js", import.meta.url), "utf8");

const adminProfile = { school_memberships: [{ role: "school_manager" }] };
const teacherProfile = { school_memberships: [{ role: "teacher" }] };
const firstStudentId = "11111111-1111-4111-8111-111111111111";
const secondStudentId = "22222222-2222-4222-8222-222222222222";

test("student bulk mail UI is admin-only and uses recipient counts", () => {
  assert.match(studentsPage, /mayManageStudents \? \(/);
  assert.match(studentsPage, /Send mail/);
  assert.match(studentsPage, /BulkStudentMailDialog/);
  assert.match(studentsPage, /Recipients:/);
  assert.match(studentsPage, /No email:/);
  assert.match(studentsPage, /onClick=\{onCancel\}/);
  assert.match(studentsPage, /onSubmit=\{handleBulkMailSubmit\}/);
});

test("non-admin bulk mail data-layer invocation is rejected before Supabase or queue calls", async () => {
  const supabase = createBulkMailSupabase();

  const result = await bulkQueueStudentEmails(
    supabase,
    { body: "Hello", studentIds: [firstStudentId], subject: "Bee School" },
    teacherProfile
  );

  assert.equal(result.data, null);
  assert.match(result.error.message, /permission/);
  assert.deepEqual(supabase.calls, []);
});

test("bulk mail validates selected ids, subject, and body before queueing", async () => {
  const missingSubject = await bulkQueueStudentEmails(
    createBulkMailSupabase(),
    { body: "Hello", studentIds: [firstStudentId], subject: " " },
    adminProfile
  );
  assert.match(missingSubject.error.message, /Subject is required/);

  const missingBody = await bulkQueueStudentEmails(
    createBulkMailSupabase(),
    { body: "", studentIds: [firstStudentId], subject: "Bee School" },
    adminProfile
  );
  assert.match(missingBody.error.message, /Message is required/);

  const invalidIdSupabase = createBulkMailSupabase();
  const invalidId = await bulkQueueStudentEmails(
    invalidIdSupabase,
    { body: "Hello", studentIds: [firstStudentId, "bad-id"], subject: "Bee School" },
    adminProfile
  );
  assert.match(invalidId.error.message, /valid student IDs/);
  assert.deepEqual(invalidIdSupabase.calls, []);
});

test("bulk mail queues only selected students with canonical email and skips missing email", async () => {
  const supabase = createBulkMailSupabase({
    students: [
      student(firstStudentId, "first@example.com"),
      student(secondStudentId, "")
    ]
  });

  const result = await bulkQueueStudentEmails(
    supabase,
    { body: "Hello families", studentIds: [firstStudentId, secondStudentId, firstStudentId], subject: "Bee School update" },
    adminProfile
  );

  assert.equal(result.error, null);
  assert.equal(result.data.queued, 1);
  assert.equal(result.data.skipped, 1);
  assert.equal(result.data.selected, 2);
  assert.deepEqual(
    supabase.calls.filter((call) => call.type === "rpc" && call.name === "can_manage_student").map((call) => call.args),
    [{ p_student_id: firstStudentId }, { p_student_id: secondStudentId }]
  );
  assert.deepEqual(supabase.calls.find((call) => call.type === "in"), {
    type: "in",
    column: "id",
    values: [firstStudentId, secondStudentId]
  });

  const queuedCall = supabase.calls.find((call) => call.type === "rpc" && call.name === "queue_communication_mvp");
  assert.equal(queuedCall.args.p_student_id, firstStudentId);
  assert.equal(queuedCall.args.p_recipient, "first@example.com");
  assert.equal(queuedCall.args.p_subject, "Bee School update");
  assert.equal(queuedCall.args.p_body, "Hello families");
  assert.equal(queuedCall.args.p_channel, "email");
  assert.equal(queuedCall.args.p_communication_type, "custom");
  assert.equal(supabase.calls.some((call) => call.type === "externalEmailSend"), false);
});

test("bulk mail rejects unauthorized selected students before queueing", async () => {
  const supabase = createBulkMailSupabase({
    canManageStudent: (studentId) => studentId !== secondStudentId
  });

  const result = await bulkQueueStudentEmails(
    supabase,
    { body: "Hello", studentIds: [firstStudentId, secondStudentId], subject: "Bee School" },
    adminProfile
  );

  assert.equal(result.data, null);
  assert.match(result.error.message, /one or more selected students/);
  assert.equal(supabase.calls.some((call) => call.type === "rpc" && call.name === "queue_communication_mvp"), false);
});

test("bulk mail reports selected rows that cannot be loaded instead of sending a partial batch", async () => {
  const supabase = createBulkMailSupabase({
    students: [student(firstStudentId, "first@example.com")]
  });

  const result = await bulkQueueStudentEmails(
    supabase,
    { body: "Hello", studentIds: [firstStudentId, secondStudentId], subject: "Bee School" },
    adminProfile
  );

  assert.equal(result.data, null);
  assert.match(result.error.message, /could not be loaded/);
  assert.equal(supabase.calls.some((call) => call.type === "rpc" && call.name === "queue_communication_mvp"), false);
});

function student(id, email) {
  return {
    id,
    organization_id: "org-1",
    school_id: "school-1",
    student_contacts: email
      ? [
          {
            contact_type: "email",
            is_primary: true,
            label: "Guardian",
            value: email
          }
        ]
      : []
  };
}

function createBulkMailSupabase(options = {}) {
  const calls = [];
  const canManageStudent = options.canManageStudent || (() => true);

  return {
    calls,
    auth: {
      async getUser() {
        calls.push({ type: "auth.getUser" });
        return { data: { user: { id: "admin-user" } }, error: null };
      }
    },
    async rpc(name, args) {
      calls.push({ type: "rpc", name, args });
      if (name === "can_manage_student") {
        return { data: canManageStudent(args.p_student_id), error: null };
      }
      if (name === "queue_communication_mvp") {
        return { data: `communication-${args.p_student_id}`, error: null };
      }
      return { data: null, error: new Error(`Unexpected RPC ${name}`) };
    },
    from(table) {
      calls.push({ type: "from", table });
      return {
        select() {
          calls.push({ type: "select" });
          return this;
        },
        async in(column, values) {
          calls.push({ type: "in", column, values });
          return { data: options.students || values.map((id) => student(id, `${id.slice(0, 8)}@example.com`)), error: null };
        }
      };
    }
  };
}
