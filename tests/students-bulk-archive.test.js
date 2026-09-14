import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bulkUpdateStudentStatus } from "../lib/data.js";

const studentsPage = readFileSync(new URL("../app/(app)/students/page.js", import.meta.url), "utf8");
const dataSource = readFileSync(new URL("../lib/data.js", import.meta.url), "utf8");

const adminProfile = { school_memberships: [{ role: "school_manager" }] };
const teacherProfile = { school_memberships: [{ role: "teacher" }] };
const firstStudentId = "11111111-1111-4111-8111-111111111111";
const secondStudentId = "22222222-2222-4222-8222-222222222222";

test("student bulk archive UI is admin-only and clearly preserves linked history", () => {
  assert.match(studentsPage, /mayManageStudents \? \(/);
  assert.match(studentsPage, /Archive/);
  assert.match(studentsPage, /BulkStudentArchiveDialog/);
  assert.match(studentsPage, /Archive \{count\} selected students\?/);
  assert.match(studentsPage, /marked inactive/);
  assert.match(studentsPage, /linked data will not be deleted/);
  assert.match(studentsPage, /danger-button/);
  assert.match(studentsPage, /onClick=\{onCancel\}/);
  assert.match(studentsPage, /onClick=\{onConfirm\}/);
});

test("student bulk archive uses the existing bulk status mutation with inactive", () => {
  assert.match(studentsPage, /bulkUpdateStudentStatus\(/);
  assert.match(studentsPage, /status: "inactive"/);
  assert.doesNotMatch(studentsPage, /from\("students"\)\s*\.delete|delete_student|bulkDelete/i);
  assert.doesNotMatch(dataSource, /bulkArchiveStudents|delete_student|from\("students"\)\s*\.delete/i);
});

test("non-admin archive invocation through the status mutation is rejected before Supabase mutation", async () => {
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

test("archive affects only explicitly selected student ids and leaves linked tables untouched", async () => {
  const supabase = createBulkStatusSupabase();

  const result = await bulkUpdateStudentStatus(
    supabase,
    { status: "inactive", studentIds: [firstStudentId, secondStudentId, firstStudentId] },
    adminProfile
  );

  assert.equal(result.error, null);
  assert.deepEqual(supabase.calls.find((call) => call.type === "update").payload, { status: "inactive" });
  assert.deepEqual(supabase.calls.find((call) => call.type === "in"), {
    type: "in",
    column: "id",
    values: [firstStudentId, secondStudentId]
  });
  assert.deepEqual(
    result.data.map((student) => [student.id, student.status]),
    [
      [firstStudentId, "inactive"],
      [secondStudentId, "inactive"]
    ]
  );
  assert.equal(
    supabase.calls.some((call) =>
      ["student_enrollments", "student_notes", "student_charges", "student_payments", "communications", "ai_eigo_student_links"].includes(
        call.table
      )
    ),
    false
  );
});

test("archive rejects malformed selected ids through the existing status mutation validation", async () => {
  const supabase = createBulkStatusSupabase();

  const result = await bulkUpdateStudentStatus(
    supabase,
    { status: "inactive", studentIds: [firstStudentId, "not-a-student-id"] },
    adminProfile
  );

  assert.equal(result.data, null);
  assert.match(result.error.message, /valid student IDs/);
  assert.deepEqual(supabase.calls, []);
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
