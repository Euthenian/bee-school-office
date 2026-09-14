import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bulkUpdateStudentStatus } from "../lib/data.js";
import { studentStatusValues } from "../lib/students.js";

const studentsPage = readFileSync(new URL("../app/(app)/students/page.js", import.meta.url), "utf8");

const adminProfile = { school_memberships: [{ role: "school_manager" }] };
const teacherProfile = { school_memberships: [{ role: "teacher" }] };
const firstStudentId = "11111111-1111-4111-8111-111111111111";
const secondStudentId = "22222222-2222-4222-8222-222222222222";

test("student bulk status UI is admin-only and uses the confirmation dialog", () => {
  assert.match(studentsPage, /mayManageStudents \? \(/);
  assert.match(studentsPage, /Change status/);
  assert.match(studentsPage, /BulkStudentStatusDialog/);
  assert.match(studentsPage, /Update the status for <strong>\{count\}<\/strong> selected student/);
  assert.match(studentsPage, /onClick=\{onCancel\}/);
  assert.match(studentsPage, /onClick=\{onConfirm\}/);
  assert.match(studentsPage, /studentStatuses/);
});

test("student bulk status supports only existing student statuses", () => {
  assert.deepEqual(studentStatusValues, ["active", "pending", "paused", "withdrawn", "graduated", "inactive"]);
});

test("non-admin bulk status data-layer invocation is rejected before Supabase mutation", async () => {
  const supabase = createBulkStatusSupabase();

  const result = await bulkUpdateStudentStatus(
    supabase,
    { status: "inactive", studentIds: [firstStudentId] },
    teacherProfile
  );

  assert.equal(result.data, null);
  assert.match(result.error.message, /permission/);
  assert.deepEqual(supabase.calls, []);
});

test("bulk status rejects invalid statuses and invalid student ids", async () => {
  const invalidStatusSupabase = createBulkStatusSupabase();
  const invalidStatus = await bulkUpdateStudentStatus(
    invalidStatusSupabase,
    { status: "deleted", studentIds: [firstStudentId] },
    adminProfile
  );

  assert.equal(invalidStatus.data, null);
  assert.match(invalidStatus.error.message, /valid student status/);
  assert.deepEqual(invalidStatusSupabase.calls, []);

  const invalidIdsSupabase = createBulkStatusSupabase();
  const invalidIds = await bulkUpdateStudentStatus(
    invalidIdsSupabase,
    { status: "inactive", studentIds: [firstStudentId, "not-a-student-id"] },
    adminProfile
  );

  assert.equal(invalidIds.data, null);
  assert.match(invalidIds.error.message, /valid student IDs/);
  assert.deepEqual(invalidIdsSupabase.calls, []);
});

test("bulk status authorizes every selected student before updating only selected ids", async () => {
  const supabase = createBulkStatusSupabase();

  const result = await bulkUpdateStudentStatus(
    supabase,
    { status: "paused", studentIds: [firstStudentId, secondStudentId, firstStudentId] },
    adminProfile
  );

  assert.equal(result.error, null);
  assert.deepEqual(
    supabase.calls.filter((call) => call.type === "rpc"),
    [
      { type: "rpc", name: "can_manage_student", args: { p_student_id: firstStudentId } },
      { type: "rpc", name: "can_manage_student", args: { p_student_id: secondStudentId } }
    ]
  );
  assert.deepEqual(supabase.calls.find((call) => call.type === "update").payload, { status: "paused" });
  assert.deepEqual(supabase.calls.find((call) => call.type === "in"), {
    type: "in",
    column: "id",
    values: [firstStudentId, secondStudentId]
  });
  assert.deepEqual(
    result.data.map((student) => [student.id, student.status]),
    [
      [firstStudentId, "paused"],
      [secondStudentId, "paused"]
    ]
  );
});

test("bulk status stops before mutation when any selected student is unauthorized", async () => {
  const supabase = createBulkStatusSupabase({
    canManageStudent: (studentId) => studentId !== secondStudentId
  });

  const result = await bulkUpdateStudentStatus(
    supabase,
    { status: "inactive", studentIds: [firstStudentId, secondStudentId] },
    adminProfile
  );

  assert.equal(result.data, null);
  assert.match(result.error.message, /one or more selected students/);
  assert.equal(supabase.calls.some((call) => call.type === "update"), false);
});

test("bulk status reports failure if RLS prevents an expected selected-row update", async () => {
  const supabase = createBulkStatusSupabase({
    updatedRows: [{ id: firstStudentId, status: "inactive" }]
  });

  const result = await bulkUpdateStudentStatus(
    supabase,
    { status: "inactive", studentIds: [firstStudentId, secondStudentId] },
    adminProfile
  );

  assert.equal(result.data, null);
  assert.match(result.error.message, /could not be updated/);
});

function createBulkStatusSupabase(options = {}) {
  const calls = [];
  const state = { ids: [], payload: null };
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
      return { data: canManageStudent(args.p_student_id), error: null };
    },
    from(table) {
      calls.push({ type: "from", table });
      return {
        update(payload) {
          state.payload = payload;
          calls.push({ type: "update", payload });
          return this;
        },
        in(column, values) {
          state.ids = values;
          calls.push({ type: "in", column, values });
          return this;
        },
        async select() {
          calls.push({ type: "select" });
          return {
            data: options.updatedRows || state.ids.map((id) => ({ id, status: state.payload.status })),
            error: null
          };
        }
      };
    }
  };
}
