import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { selectClassEmailTemplates, summarizeClassEmailRecipients } from "../lib/class-mail.js";
import {
  addExistingStudentToClass, previewClassTemplateEmail,
  searchClassStudentCandidates, sendClassTemplateEmail
} from "../lib/data.js";

const migration = readFileSync(new URL("../supabase/migrations/20261026001000_class_profile_student_and_template_email.sql", import.meta.url), "utf8");
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
