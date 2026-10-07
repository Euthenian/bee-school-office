import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  fetchCommunicationTemplates,
  previewStudentTemplateCommunication,
  saveCommunicationTemplate,
  sendStudentTemplateCommunication
} from "../lib/data.js";

const migration = readFileSync(new URL("../supabase/migrations/20261009001000_communication_center_templates.sql", import.meta.url), "utf8");
const composer = readFileSync(new URL("../components/StudentTemplateComposer.js", import.meta.url), "utf8");
const wrapper = readFileSync(new URL("../components/CommunicationComposer.js", import.meta.url), "utf8");
const center = readFileSync(new URL("../app/(app)/communications/page.js", import.meta.url), "utf8");
const profile = readFileSync(new URL("../app/(app)/students/profile/page.js", import.meta.url), "utf8");

test("active email templates are selectable and inactive templates are rejected by the server", async () => {
  const query = { select: () => query, eq: () => query, order: () => query };
  const supabase = { from(table) { assert.equal(table, "communication_templates"); return query; } };
  assert.equal(await fetchCommunicationTemplates(supabase), query);
  assert.match(composer, /template\.status === "active"/);
  assert.match(migration, /where template_key = p_template_key and status = 'active' and channel = 'email'/);
  assert.match(migration, /raise exception 'Active email template not found\.'/);
});

test("name and recipient are derived from student rows with a deterministic valid primary-email rule", () => {
  assert.match(migration, /concat_ws\(' ', nullif\(btrim\(v_student\.first_name\)/);
  assert.match(migration, /v_student\.legacy_japanese_name/);
  assert.match(migration, /v_student\.preferred_name/);
  assert.match(migration, /c\.contact_type = 'email'/);
  assert.match(migration, /order by c\.is_primary desc, c\.created_at asc, c\.id asc/);
  assert.match(migration, /raise exception 'No valid email recipient'/);
});

test("unknown, undeclared, malformed and missing variables fail before preview or send", () => {
  assert.match(migration, /v_key not in \('student_name', 'student_email', 'recipient_name', 'school_name'\)/);
  assert.match(migration, /or not v_key = any\(p_variable_keys\)/);
  assert.match(migration, /raise exception 'Malformed template variable\.'/);
  assert.match(migration, /raise exception 'Missing template variable: %'/);
  assert.match(migration, /perform public\.validate_student_email_template_mvp\(/);
});

test("browser preview/send pass only template key and student ID; send resolves again", async () => {
  const calls = [];
  const supabase = { rpc(name, args) { calls.push({ name, args }); return { data: "ok", error: null }; } };
  await previewStudentTemplateCommunication(supabase, "welcome_enrollment", "student-1");
  await sendStudentTemplateCommunication(supabase, "welcome_enrollment", "student-1");
  assert.deepEqual(calls, [
    { name: "preview_student_email_template_mvp", args: { p_template_key: "welcome_enrollment", p_student_id: "student-1" } },
    { name: "send_student_email_template_mvp", args: { p_template_key: "welcome_enrollment", p_student_id: "student-1" } }
  ]);
  assert.match(migration, /v_message := public\.resolve_student_email_template_mvp\(p_template_key, p_student_id\)/);
  assert.doesNotMatch(composer, /queueCommunication\(/);
});

test("queue stores the server-resolved snapshot in existing communications history", () => {
  assert.match(migration, /return public\.queue_communication_mvp\(/);
  assert.match(migration, /v_message->>'recipient', v_message->>'subject', v_message->>'body'/);
  assert.match(center, /setHistoryVersion\(\(current\) => current \+ 1\)/);
  assert.match(center, /fetchCommunications/);
});

test("only super admins may create or edit templates; keys remain stable", async () => {
  const calls = [];
  const supabase = { rpc(name, args) { calls.push({ name, args }); return { data: "id", error: null }; } };
  await saveCommunicationTemplate(supabase, {
    id: null, template_key: "welcome", name: "Welcome", subject_template: "Hello",
    body_template: "Welcome", variable_keys: [], status: "inactive"
  });
  assert.equal(calls[0].name, "save_student_email_template_mvp");
  assert.equal(calls[0].args.p_status, "inactive");
  assert.match(migration, /not public\.is_super_admin\(\)/);
  assert.match(migration, /where id = p_template_id and template_key = p_template_key/);
  assert.doesNotMatch(migration, /delete from public\.communication_templates/i);
});

test("profile and center share student composer while trial composition stays intact", () => {
  assert.match(profile, /<CommunicationComposer/);
  assert.match(profile, /context=\{\{ studentId: student\.id \}\}/);
  assert.match(center, /<CommunicationComposer context=\{\{ studentId, studentTemplateMode: true \}\}/);
  assert.match(wrapper, /context\?\.studentTemplateMode \|\| \(context\?\.studentId && !context\?\.trialLessonId\)/);
  assert.match(wrapper, /LegacyCommunicationComposer/);
});
