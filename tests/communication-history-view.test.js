import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getEmailHistoryPreview, unavailableEmailBody } from "../lib/communication-history.js";
import { communicationSelect, fetchCommunications } from "../lib/data.js";
import { canManageCommunications } from "../lib/roles.js";

const page = readFileSync(new URL("../app/(app)/communications/page.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const communicationsMigration = readFileSync(
  new URL("../supabase/migrations/20260827001000_communications_followup_foundation.sql", import.meta.url), "utf8"
);

test("sent email preview uses the stored recipient, subject, body, sent date, and status", () => {
  const stored = {
    channel: "email", recipient: "parent@example.test", subject: "Original subject",
    body: "Original message\nSecond line", sent_at: "2026-11-14T05:00:00Z",
    created_at: "2026-11-13T05:00:00Z", delivery_status: "sent",
    metadata: { recipient_name: "Student greeting name" }
  };
  assert.deepEqual(getEmailHistoryPreview(stored), {
    to: "Recipient name not recorded (parent@example.test)",
    subject: stored.subject,
    date: stored.sent_at,
    status: "Sent",
    body: stored.body
  });
  assert.match(communicationSelect, /\brecipient\b/);
  assert.match(communicationSelect, /\bsubject\b/);
  assert.match(communicationSelect, /\bbody\b/);
  assert.match(communicationSelect, /\bsent_at\b/);
  assert.match(communicationSelect, /\bdelivery_status\b/);
  assert.doesNotMatch(page, /renderTemplate|fetchCommunicationTemplates\(.*viewedEmail/);
});

test("Japanese paragraphs are displayed without changing the stored text", () => {
  const body = "岩尾日菜子様\n\nご予約ありがとうございます。\n\nBEE SCHOOL";
  assert.equal(getEmailHistoryPreview({ body, delivery_status: "queued" }).body, body);
  assert.equal(getEmailHistoryPreview({ body, delivery_status: "queued" }).status, "Pending");
  assert.match(styles, /\.communication-preview-body\s*\{[^}]*white-space: pre-wrap/s);
});

test("older email with no body displays a clear unavailable message", () => {
  assert.equal(getEmailHistoryPreview({ body: null, delivery_status: "failed" }).body, unavailableEmailBody);
  assert.equal(getEmailHistoryPreview({ body: "", delivery_status: "failed" }).status, "Failed");
  assert.match(page, /communication\.channel === "email"[\s\S]*?View email/);
});

test("long messages remain complete inside the scrollable existing modal", () => {
  const body = "長いメッセージ\n".repeat(1500);
  assert.equal(getEmailHistoryPreview({ body }).body, body);
  assert.match(styles, /\.communication-modal\s*\{[^}]*max-height:[^;]+;[^}]*overflow: auto/s);
  assert.match(page, /className="communication-preview-body" style=\{\{ overflowWrap: "anywhere" \}\}/);
  assert.match(page, /aria-modal="true"[\s\S]*?role="dialog"/);
  assert.match(page, /onClick=\{onClose\} type="button">Close/);
});

test("history keeps existing filters and school-scoped access", async () => {
  const calls = [];
  const query = {
    select(value) { calls.push(["select", value]); return query; },
    order(value) { calls.push(["order", value]); return query; },
    limit(value) { calls.push(["limit", value]); return query; },
    eq(column, value) { calls.push(["eq", column, value]); return query; },
    then(resolve) { return resolve({ data: [], error: null }); }
  };
  const supabase = { from(table) { assert.equal(table, "communications"); return query; } };
  await fetchCommunications(supabase, { studentId: "student-1", prospectId: "prospect-1", trialLessonId: "trial-1" });
  assert.deepEqual(calls.filter(([operation]) => operation === "eq"), [
    ["eq", "student_id", "student-1"],
    ["eq", "prospect_id", "prospect-1"],
    ["eq", "trial_lesson_id", "trial-1"]
  ]);
  assert.ok(calls.some(([operation, value]) => operation === "limit" && value === 200));
  assert.equal(canManageCommunications({ school_memberships: [{ role: "teacher" }] }), false);
  assert.match(page, /if \(!mayCommunicate\)\s*\{[\s\S]*?Not available for this role/);
  assert.match(communicationsMigration, /create policy "communications_select_school_management"[\s\S]*?using \(public\.can_manage_school\(school_id\)\)/);
});
