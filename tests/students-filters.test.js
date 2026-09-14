import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createDefaultStudentFilters,
  filterStudents,
  getStudentCourseClassOptions,
  getVisibleSelectedIds,
  hasActiveStudentFilters
} from "../lib/students.js";

const studentsPage = readFileSync(new URL("../app/(app)/students/page.js", import.meta.url), "utf8");

function student(id, overrides = {}) {
  return {
    id,
    first_name: overrides.first_name || "Taro",
    last_name: overrides.last_name || "Yamada",
    preferred_name: overrides.preferred_name || "",
    legacy_customer_id: overrides.legacy_customer_id || "",
    legacy_japanese_name: overrides.legacy_japanese_name || "",
    school_id: overrides.school_id || "school-ohashi",
    start_date: overrides.start_date || "2026-09-01",
    status: overrides.status || "active",
    ai_eigo_student_invitations: overrides.ai_eigo_student_invitations || [],
    ai_eigo_student_links: overrides.ai_eigo_student_links || [],
    student_enrollments: overrides.student_enrollments || [
      {
        courses: { id: "course-a", name: "Phonics" },
        class_name: "Tuesday A",
        classes: null,
        status: "active"
      }
    ]
  };
}

test("student filters combine school, course, date, AI-EIGO, status, and search", () => {
  const rows = [
    student("target", {
      first_name: "Hana",
      school_id: "school-ohashi",
      start_date: "2026-09-10",
      ai_eigo_student_invitations: [{ id: "invite-1", status: "sent", created_at: "2026-09-10T00:00:00Z" }]
    }),
    student("wrong-school", { first_name: "Hana", school_id: "school-tenjin" }),
    student("wrong-status", { first_name: "Hana", status: "inactive" }),
    student("wrong-ai", { first_name: "Hana", ai_eigo_student_invitations: [] }),
    student("wrong-date", { first_name: "Hana", start_date: "2025-12-31" }),
    student("wrong-course", {
      first_name: "Hana",
      student_enrollments: [{ courses: { id: "course-b", name: "Conversation" }, class_name: "Friday B", classes: null, status: "active" }]
    })
  ];

  assert.deepEqual(
    filterStudents(
      rows,
      {
        ...createDefaultStudentFilters(),
        aiEigo: "invited",
        courseClass: "Phonics / Tuesday A",
        schoolId: "school-ohashi",
        search: "hana",
        startDate: "this_month",
        status: "active"
      },
      "2026-09-14"
    ).map((row) => row.id),
    ["target"]
  );
});

test("student filters support linked and not-invited AI-EIGO states and date buckets", () => {
  const rows = [
    student("linked", { ai_eigo_student_links: [{ id: "link-1", ai_eigo_user_id: "user-1" }] }),
    student("not-invited", { ai_eigo_student_invitations: [] }),
    student("older", { start_date: "2025-04-01" })
  ];

  assert.deepEqual(filterStudents(rows, { aiEigo: "linked" }, "2026-09-14").map((row) => row.id), ["linked"]);
  assert.deepEqual(filterStudents(rows, { aiEigo: "not_invited" }, "2026-09-14").map((row) => row.id), [
    "not-invited",
    "older"
  ]);
  assert.deepEqual(filterStudents(rows, { startDate: "older" }, "2026-09-14").map((row) => row.id), ["older"]);
});

test("student course/class options are derived from enrollment display values", () => {
  const rows = [
    student("one", { student_enrollments: [{ courses: { name: "Phonics" }, class_name: "A", classes: null, status: "active" }] }),
    student("two", { student_enrollments: [{ courses: { name: "Conversation" }, class_name: "B", classes: null, status: "active" }] }),
    student("three", { student_enrollments: [{ courses: { name: "Phonics" }, class_name: "A", classes: null, status: "active" }] })
  ];

  assert.deepEqual(getStudentCourseClassOptions(rows), [
    { value: "Conversation / B", label: "Conversation / B" },
    { value: "Phonics / A", label: "Phonics / A" }
  ]);
});

test("student visible selection excludes hidden rows after filtering", () => {
  const visible = [student("one"), student("two")];
  const selected = getVisibleSelectedIds(new Set(["one", "hidden"]), visible);

  assert.deepEqual([...selected], ["one"]);
  assert.equal(hasActiveStudentFilters(createDefaultStudentFilters()), false);
  assert.equal(hasActiveStudentFilters({ ...createDefaultStudentFilters(), schoolId: "school-ohashi" }), true);
});

test("students page exposes filter controls and visible-row selection without replacing AI-EIGO actions", () => {
  assert.match(studentsPage, /All schools/);
  assert.match(studentsPage, /All courses\/classes/);
  assert.match(studentsPage, /Start date/);
  assert.match(studentsPage, /AI-EIGO/);
  assert.match(studentsPage, /Clear all filters/);
  assert.match(studentsPage, /Select all visible students/);
  assert.match(studentsPage, /visibleStudents\.map/);
  assert.match(studentsPage, /sendAiEigoStudentInvitation/);
  assert.match(studentsPage, /AiEigoStudentListCell/);
});
