import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { selectClassEmailTemplates, summarizeClassEmailRecipients } from "../lib/class-mail.js";
import {
  addExistingStudentToClass, previewClassTemplateEmail, removeStudentFromClass,
  searchClassStudentCandidates, sendClassTemplateEmail
} from "../lib/data.js";

const migration = readFileSync(new URL("../supabase/migrations/20261026001000_class_profile_student_and_template_email.sql", import.meta.url), "utf8");
const removeMigration = readFileSync(new URL("../supabase/migrations/20261028003000_remove_student_from_class.sql", import.meta.url), "utf8");
const profilePage = readFileSync(new URL("../app/(app)/classes/profile/page.js", import.meta.url), "utf8");
const addDialog = readFileSync(new URL("../components/ClassAddStudentDialog.js", import.meta.url), "utf8");
const classRow = { id: "class-id", organization_id: "org-id", school_id: "school-id" };

test("student search stays in the current school and shows existing enrollment state", async () => {
  const calls = [];
  const query = new Proxy({}, { get(_target, name) {
    return (...args) => {
      calls.push([name, ...args]);
      return name === "limit" ? Promise.resolve({ data: [], error: null }) : query;
    };
  } });
  const supabase = { from(table) { calls.push(["from", table]); return query; } };
  await searchClassStudentCandidates(supabase, classRow, "Sakura");
  assert.deepEqual(calls.filter(([name]) => name === "eq"), [
    ["eq", "organization_id", "org-id"], ["eq", "school_id", "school-id"], ["eq", "status", "active"]
  ]);
  assert.ok(calls.some(([name, select]) => name === "select" && select.includes("student_enrollments")));
  assert.ok(calls.some(([name, filter]) => name === "or" && filter.includes("legacy_japanese_name")));
  assert.match(addDialog, /activeEnrollment\.class_id === classRow\.id/);
  assert.match(addDialog, /students\.some\(\(student\) => student\.id === studentId\)/);
  assert.match(profilePage, /fetchClassProfile\(supabase, classRow\.id\)/);
  assert.match(profilePage, /setState\(\(current\) => \(\{ \.\.\.current, classRow: data \}\)\)/);
});

test("add-to-class RPC receives only the chosen existing IDs and preserves history", async () => {
  const calls = [];
  const supabase = { rpc(name, args) { calls.push({ name, args }); return { data: "enrollment-id", error: null }; } };
  await addExistingStudentToClass(supabase, "class-id", "student-id");
  assert.deepEqual(calls, [{ name: "add_existing_student_to_class_mvp", args: {
    p_class_id: "class-id", p_student_id: "student-id"
  } }]);
  assert.match(migration, /from public\.students where id = p_student_id for update/);
  assert.match(migration, /v_class\.school_id <> v_student\.school_id/);
  assert.match(migration, /v_class\.organization_id <> v_student\.organization_id/);
  assert.match(migration, /where se\.student_id = p_student_id and se\.status = 'active'/);
  assert.match(migration, /Student not found or permission denied/);
  assert.match(migration, /insert into public\.student_enrollments/);
  assert.doesNotMatch(migration, /update public\.student_enrollments|delete from public\.student_enrollments/i);
});

test("remove-from-class ends the class enrollment and keeps its history", async () => {
  const calls = [];
  const supabase = { rpc(name, args) { calls.push({ name, args }); return { data: "enrollment-id", error: null }; } };
  await removeStudentFromClass(supabase, "class-id", "enrollment-id");
  assert.deepEqual(calls, [{ name: "remove_student_from_class_mvp", args: {
    p_class_id: "class-id", p_enrollment_id: "enrollment-id"
  } }]);
  assert.match(removeMigration, /where id = p_enrollment_id and class_id = p_class_id\s+for update/);
  assert.match(removeMigration, /not public\.can_manage_student\(v_enrollment\.student_id\)/);
  assert.match(removeMigration, /set status = 'completed'/);
  assert.doesNotMatch(removeMigration, /delete from public\.student_enrollments|update public\.students/i);
  assert.match(profilePage, /removeStudentFromClass\(supabase, classRow\.id, removeTarget\.id\)/);
  assert.match(profilePage, /Remove student from class\?/);
});

test("class template choices include active compatible templates and a manual option", () => {
  const template = (key, status, variables = ["student_name"], channel = "email") => ({
    id: key, template_key: key, status, channel, variable_keys: variables
  });
  const selected = selectClassEmailTemplates([
    template("welcome_enrollment", "active"), template("inactive", "inactive"),
    template("trial", "active", ["confirmed_date"]),
    template("student_departure_confirmation", "active"), template("sms", "active", [], "phone")
  ]);
  assert.deepEqual(selected.map((item) => item.template_key), ["welcome_enrollment"]);
  assert.match(profilePage, /General message \(write your own\)/);
  assert.match(profilePage, /selectedTemplate\.subject_template/);
  assert.match(profilePage, /selectedTemplate\.body_template/);
});

test("class email preview does not queue and send resolves each student on the server", async () => {
  const calls = [];
  const supabase = { rpc(name, args) { calls.push({ name, args }); return { data: {}, error: null }; } };
  await previewClassTemplateEmail(supabase, "class-id", "welcome_enrollment");
  await sendClassTemplateEmail(supabase, "class-id", "welcome_enrollment");
  assert.deepEqual(calls.map((call) => call.name), ["preview_class_template_email_mvp", "send_class_template_email_mvp"]);
  assert.deepEqual(calls[0].args, { p_class_id: "class-id", p_template_key: "welcome_enrollment" });
  assert.deepEqual(calls[1].args, calls[0].args);
  assert.match(migration, /prepare_class_template_email_mvp\(p_class_id, p_template_key, false\)/);
  assert.match(migration, /prepare_class_template_email_mvp\(p_class_id, p_template_key, true\)/);
  assert.match(migration, /for v_student_id in[\s\S]*se\.status = 'active'/);
  assert.match(migration, /resolve_student_email_template_mvp\(p_template_key, v_student_id\)/);
  assert.match(migration, /queue_communication_mvp\([\s\S]*v_message->>'recipient'/);
  assert.match(migration, /v_recipient = any\(v_seen\)/);
  assert.match(migration, /v_missing := v_missing \+ 1/);
  assert.match(profilePage, /if \(!preview\?\.recipient_count \|\| submitting\) return/);
});

test("recipient summary deduplicates a shared guardian address", () => {
  const student = (email) => ({ student_contacts: email ? [{ contact_type: "email", is_primary: true, value: email }] : [] });
  assert.deepEqual(summarizeClassEmailRecipients([
    student("guardian@example.com"), student("GUARDIAN@example.com"), student("")
  ]), { recipientCount: 1, missingCount: 1, duplicateCount: 1 });
});

test("class profile resolves the authoritative staff teacher before the login profile", async () => {
  const { getEnrollmentTeacher, formatTeacherName } = await import("../lib/class-details.js");
  const { classProfileSelect } = await import("../lib/data.js");
  // Postgres truncated this constraint name to 63 characters when it was created.
  assert.match(classProfileSelect, /assigned_teacher_staff:staff!student_enrollments_assigned_teacher_staff_id_organization_id_f \(/);
  assert.match(profilePage, /formatTeacherName\(getEnrollmentTeacher\(enrollment\)\)/);

  // Embed hints longer than Postgres's 63-character limit can never match a constraint.
  const dataSource = readFileSync(new URL("../lib/data.js", import.meta.url), "utf8");
  const longHints = [...dataSource.matchAll(/![a-z0-9_]+/g)].map(([hint]) => hint.slice(1)).filter((hint) => hint.length > 63);
  assert.deepEqual(longHints, []);

  const staffOnly = { assigned_teacher_staff_id: "s1", assigned_teacher_profile_id: null, assigned_teacher: null,
    assigned_teacher_staff: { id: "s1", display_name: "Teacher B", legal_name: "Legal B", email: "b@example.com" } };
  assert.equal(formatTeacherName(getEnrollmentTeacher(staffOnly)), "Teacher B");
  assert.equal(formatTeacherName(getEnrollmentTeacher({ ...staffOnly,
    assigned_teacher_staff: { ...staffOnly.assigned_teacher_staff, display_name: null } })), "Legal B");
  assert.equal(formatTeacherName(getEnrollmentTeacher({ assigned_teacher_staff: null,
    assigned_teacher: { full_name: "Profile A", email: "a@example.com" } })), "Profile A");
  assert.equal(formatTeacherName(getEnrollmentTeacher({ assigned_teacher_staff: null, assigned_teacher: null })), "No teacher assigned");
  assert.equal(formatTeacherName(getEnrollmentTeacher(null)), "No teacher assigned");
});

test("simultaneous classes are named and saved by their class teacher", async () => {
  const { buildClassMutation, formatClassName, formatClassOption, filterClasses } = await import("../lib/classes.js");
  const { classSelect, classProfileSelect, createClass, updateClass } = await import("../lib/data.js");
  const teacherA = { lesson_day: "wednesday", lesson_time: "18:00:00", schools: { name: "Ohashi" },
    assigned_teacher_staff: { display_name: "Teacher A", legal_name: "Legal A" } };
  const teacherB = { ...teacherA, assigned_teacher_staff: { display_name: null, legal_name: "Legal B" } };
  const unlabelled = { ...teacherA, assigned_teacher_staff: null };
  assert.equal(formatClassName(teacherA), "Wednesday 18:00 (Teacher A)");
  assert.equal(formatClassName(teacherB), "Wednesday 18:00 (Legal B)");
  assert.equal(formatClassName(unlabelled), "Wednesday 18:00");
  assert.equal(formatClassOption(teacherA), "Wednesday 18:00 (Teacher A) - Ohashi");
  assert.deepEqual(filterClasses([teacherA, teacherB], { search: "teacher a" }), [teacherA]);

  // Until 20261028001000 is applied, classes has no staff teacher column to select.
  for (const select of [classSelect, classProfileSelect]) {
    assert.doesNotMatch(select, /^\s{2}assigned_teacher_staff_id,/m);
    assert.doesNotMatch(select, /classes_assigned_teacher_staff_id_organization_id_fkey/);
  }

  assert.equal(buildClassMutation({ assignedTeacherStaffId: "staff-a" }).assignedTeacherStaffId, "staff-a");
  assert.equal(buildClassMutation().assignedTeacherStaffId, "");
  const calls = [];
  const supabase = { rpc(name, args) { calls.push({ name, args }); return { data: "class-id", error: null }; } };
  await createClass(supabase, { schoolId: "school", lessonDay: "wednesday", lessonTime: "18:00", assignedTeacherStaffId: "staff-a" });
  await updateClass(supabase, { classId: "class-id", schoolId: "school", lessonDay: "wednesday", lessonTime: "18:00", assignedTeacherStaffId: "" });
  assert.equal(calls[0].name, "create_class_mvp");
  assert.equal(calls[0].args.p_assigned_teacher_staff_id, "staff-a");
  assert.equal(calls[1].name, "update_class_mvp");
  assert.equal("p_assigned_teacher_staff_id" in calls[1].args, false);

  // Deactivating from the profile must keep the class teacher.
  assert.match(profilePage, /assignedTeacherStaffId: classRow\.assigned_teacher_staff_id/);
});

test("student class picker follows the class teacher and the migration keeps enrollments authoritative", () => {
  const assignment = readFileSync(new URL("../components/StudentClassAssignment.js", import.meta.url), "utf8");
  const editPage = readFileSync(new URL("../app/(app)/classes/edit/page.js", import.meta.url), "utf8");
  const classMigration = readFileSync(new URL("../supabase/migrations/20261028001000_teacher_specific_classes.sql", import.meta.url), "utf8");
  assert.match(assignment, /if \(teacherId\) onChange\("assignedTeacherStaffId", teacherId\)/);
  assert.match(assignment, /teacherMismatch \?/);
  assert.match(editPage, /assignedTeacherStaffId: classResult\.data\?\.assigned_teacher_staff_id/);
  assert.match(classMigration, /nulls not distinct/);
  assert.match(classMigration, /drop index if exists public\.classes_school_day_time_uidx/);
  assert.match(classMigration, /on conflict \(school_id, lesson_day, lesson_time, assigned_teacher_staff_id\)/);
  assert.doesNotMatch(classMigration, /update public\.student_enrollments/);
  assert.doesNotMatch(classMigration, /delete from/i);
});
