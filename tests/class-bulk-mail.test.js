import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bulkQueueClassStudentEmails, classProfileSelect } from "../lib/data.js";

const classProfilePage = readFileSync(new URL("../app/(app)/classes/profile/page.js", import.meta.url), "utf8");

const adminProfile = { school_memberships: [{ role: "school_manager" }] };
const teacherProfile = { school_memberships: [{ role: "teacher" }] };
const classId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const activeStudentId = "11111111-1111-4111-8111-111111111111";
const activeNoEmailStudentId = "22222222-2222-4222-8222-222222222222";
const inactiveStudentId = "33333333-3333-4333-8333-333333333333";

test("class profile bulk mail UI targets active enrollments and uses communications permission", () => {
  assert.match(classProfilePage, /canManageCommunications\(profile\)/);
  assert.match(classProfilePage, /enrollments\.filter\(\(enrollment\) => enrollment\.status === "active"\)/);
  assert.match(classProfilePage, /Email Students/);
  assert.match(classProfilePage, /bulkQueueClassStudentEmails/);
  assert.match(classProfilePage, /getDefaultStudentEmail\(student\)/);
  assert.match(classProfilePage, /isValidStudentEmail\(getDefaultStudentEmail\(student\)\)/);
  assert.doesNotMatch(classProfilePage, /bcc|cc:/i);
});

test("class profile select loads student contacts for canonical email resolution", () => {
  assert.match(classProfileSelect, /student_contacts \(/);
  assert.match(classProfileSelect, /\bcontact_type\b/);
  assert.match(classProfileSelect, /\bvalue\b/);
  assert.match(classProfileSelect, /\bis_primary\b/);
  assert.doesNotMatch(classProfileSelect, /\bstudents\.email\b/);
});

test("class bulk mail derives recipients from active class enrollments only", async () => {
  const supabase = createBulkMailSupabase({
    classRow: classProfile([activeStudentId], [inactiveStudentId])
  });
  const result = await bulkQueueClassStudentEmails(
    supabase,
    {
      body: "Hello",
      classId,
      subject: "Class update"
    },
    adminProfile
  );

  assert.equal(result.error, null);
  assert.equal(result.data.queued, 1);
  assert.deepEqual(
    supabase.calls.filter((call) => call.type === "rpc" && call.name === "can_manage_student").map((call) => call.args),
    [{ p_student_id: activeStudentId }]
  );
  assert.equal(
    supabase.calls.some((call) => call.type === "rpc" && call.name === "queue_communication_mvp" && call.args.p_student_id === inactiveStudentId),
    false
  );
});

test("class bulk mail queues one communication per valid active recipient and skips missing email", async () => {
  const supabase = createBulkMailSupabase({
    classRow: classProfile([activeStudentId, activeNoEmailStudentId]),
    students: [
      student(activeStudentId, "active@example.com"),
      student(activeNoEmailStudentId, "")
    ]
  });

  const result = await bulkQueueClassStudentEmails(
    supabase,
    {
      body: "Hello class",
      classId,
      subject: "Class update"
    },
    adminProfile
  );

  assert.equal(result.error, null);
  assert.equal(result.data.queued, 1);
  assert.equal(result.data.skipped, 1);
  assert.equal(result.data.selected, 2);
  assert.deepEqual(
    supabase.calls.filter((call) => call.type === "rpc" && call.name === "can_manage_student").map((call) => call.args),
    [{ p_student_id: activeStudentId }, { p_student_id: activeNoEmailStudentId }]
  );

  const queueCalls = supabase.calls.filter((call) => call.type === "rpc" && call.name === "queue_communication_mvp");
  assert.equal(queueCalls.length, 1);
  assert.equal(queueCalls[0].args.p_student_id, activeStudentId);
  assert.equal(queueCalls[0].args.p_recipient, "active@example.com");
  assert.equal(queueCalls[0].args.p_subject, "Class update");
  assert.equal(queueCalls[0].args.p_body, "Hello class");
  assert.equal(queueCalls[0].args.p_channel, "email");
  assert.equal(queueCalls[0].args.p_communication_type, "custom");
  assert.equal("bcc" in queueCalls[0].args, false);
  assert.equal("cc" in queueCalls[0].args, false);
});

test("class bulk mail preserves authorization and requires active recipients", async () => {
  const unauthorized = await bulkQueueClassStudentEmails(
    createBulkMailSupabase(),
    { body: "Hello", classId, subject: "Class update" },
    teacherProfile
  );
  assert.equal(unauthorized.data, null);
  assert.match(unauthorized.error.message, /permission/);

  const noActive = await bulkQueueClassStudentEmails(
    createBulkMailSupabase({ classRow: classProfile([]) }),
    { body: "Hello", classId, subject: "Class update" },
    adminProfile
  );
  assert.equal(noActive.data, null);
  assert.match(noActive.error.message, /no active students/);
});

function classProfile(activeStudentIds = [], inactiveStudentIds = []) {
  return {
    id: classId,
    student_enrollments: [
      ...activeStudentIds.map((studentId) => ({ id: `enrollment-${studentId}`, status: "active", student_id: studentId })),
      ...inactiveStudentIds.map((studentId) => ({ id: `enrollment-${studentId}`, status: "inactive", student_id: studentId }))
    ]
  };
}

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
  const classRow = options.classRow || classProfile([activeStudentId]);

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
        eq(column, value) {
          calls.push({ type: "eq", column, value });
          return this;
        },
        async in(column, values) {
          calls.push({ type: "in", column, values });
          return { data: options.students || values.map((id) => student(id, `${id.slice(0, 8)}@example.com`)), error: null };
        },
        async maybeSingle() {
          calls.push({ type: "maybeSingle" });
          return { data: classRow, error: null };
        }
      };
    }
  };
}
