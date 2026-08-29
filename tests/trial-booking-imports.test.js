import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildPendingTrialBookingImport,
  getPendingTrialBookingImportDeduplicationKey,
  isTrialBookingSubject,
  parseTrialBookingEmail,
  PENDING_TRIAL_BOOKING_IMPORT_TABLE
} from "../lib/trial-booking-imports.js";

const pendingImportSql = readFileSync(
  new URL("../supabase/migrations/20260826006000_pending_trial_booking_imports.sql", import.meta.url),
  "utf8"
);
const pendingImportCourseSql = readFileSync(
  new URL("../supabase/migrations/20260826007000_pending_trial_booking_imports_course.sql", import.meta.url),
  "utf8"
);

const baseInput = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  schoolId: "22222222-2222-4222-8222-222222222222",
  sourceMailbox: "bee.school.fukuoka@gmail.com",
  gmailMessageId: "gmail-message-001",
  gmailThreadId: "gmail-thread-001",
  receivedAt: "2026-08-19T09:00:00+09:00",
  headers: [
    { name: "From", value: "booking@example.com" },
    { name: "To", value: "bee.school.fukuoka@gmail.com" }
  ]
};

const realSubject = "[ADS KIDS - FREE TRIAL] New Trial Booking";
const realBody = `BOOKING SOURCE: KIDS CAMPAIGN
TRIAL TYPE: FREE
Student name: Example Student
Email: example@example.com
Phone: 09000000000
Student age: 7
Course: 小学生英会話
Lesson type: プライベートレッスン
First preferred date: 2026-08-19`;

test("trial booking parser extracts the known real format without hard-coding campaign values", () => {
  const parsed = parseTrialBookingEmail({ subject: realSubject, body: realBody });

  assert.equal(parsed.parse_status, "parsed");
  assert.equal(parsed.parse_error, null);
  assert.equal(parsed.rawBody, realBody);
  assert.equal(parsed.fields.booking_source, "KIDS CAMPAIGN");
  assert.equal(parsed.fields.trial_type, "FREE");
  assert.equal(parsed.fields.student_name, "Example Student");
  assert.equal(parsed.fields.email, "example@example.com");
  assert.equal(parsed.fields.phone, "09000000000");
  assert.equal(parsed.fields.student_age, 7);
  assert.equal(parsed.fields.course, "小学生英会話");
  assert.equal(parsed.fields.lesson_type, "プライベートレッスン");
  assert.equal(parsed.fields.first_preferred_date, "2026-08-19");
});

test("trial booking parser keeps Course distinct from Lesson type", () => {
  const parsed = parseTrialBookingEmail({
    subject: "New Trial Booking",
    body: `Student name: Example Student
Course: 小学生英会話
Lesson type: グループレッスン`
  });

  assert.equal(parsed.parse_status, "parsed");
  assert.equal(parsed.fields.course, "小学生英会話");
  assert.equal(parsed.fields.lesson_type, "グループレッスン");
});

test("subject detection accepts different prefixes when Trial Booking is present", () => {
  assert.equal(isTrialBookingSubject("Website Campaign - New Trial Booking for Ohashi"), true);
  assert.equal(isTrialBookingSubject("[ADS KIDS - FREE TRIAL] New Trial Booking"), true);
  assert.equal(isTrialBookingSubject("Website inquiry only"), false);
});

test("same Gmail thread can hold different Gmail message ids", () => {
  const first = buildPendingTrialBookingImport({
    ...baseInput,
    subject: "Campaign A Trial Booking",
    gmailMessageId: "gmail-message-001",
    gmailThreadId: "gmail-thread-shared",
    rawBody: realBody
  });
  const second = buildPendingTrialBookingImport({
    ...baseInput,
    subject: "Campaign B Trial Booking",
    gmailMessageId: "gmail-message-002",
    gmailThreadId: "gmail-thread-shared",
    rawBody: realBody
  });

  assert.equal(first.gmail_thread_id, "gmail-thread-shared");
  assert.equal(second.gmail_thread_id, "gmail-thread-shared");
  assert.notEqual(getPendingTrialBookingImportDeduplicationKey(first), getPendingTrialBookingImportDeduplicationKey(second));
});

test("duplicate Gmail message id uses the same source-mailbox idempotency key", () => {
  const first = buildPendingTrialBookingImport({
    ...baseInput,
    subject: realSubject,
    gmailMessageId: "gmail-message-duplicate",
    gmailThreadId: "gmail-thread-a",
    rawBody: realBody
  });
  const duplicate = buildPendingTrialBookingImport({
    ...baseInput,
    subject: "Another Trial Booking subject",
    gmailMessageId: "gmail-message-duplicate",
    gmailThreadId: "gmail-thread-b",
    rawBody: realBody
  });

  assert.equal(getPendingTrialBookingImportDeduplicationKey(first), getPendingTrialBookingImportDeduplicationKey(duplicate));
});

test("missing optional second preferred fields stays cleanly nullable", () => {
  const row = buildPendingTrialBookingImport({
    ...baseInput,
    subject: realSubject,
    rawBody: realBody
  });

  assert.equal(row.parse_status, "parsed");
  assert.equal(row.second_preferred_date, null);
  assert.equal(row.second_preferred_time, null);
});

test("missing required booking identification returns explicit parse error", () => {
  const parsed = parseTrialBookingEmail({
    subject: "New Trial Booking",
    body: `Email: example@example.com
Phone: 09000000000`
  });

  assert.equal(parsed.parse_status, "parse_error");
  assert.match(parsed.parse_error, /Student name is required/);
});

test("extra blank lines, whitespace, and CRLF line endings are tolerated", () => {
  const body = "\r\n  BOOKING SOURCE :   AD TEST  \r\n\r\nStudent name:   Example Student  \r\nFirst preferred time: 9:30\r\nMessage: Please call first.\r\n  Thank you.  \r\n";
  const parsed = parseTrialBookingEmail({
    subject: "Trial Booking - whitespace test",
    body
  });

  assert.equal(parsed.parse_status, "parsed");
  assert.equal(parsed.fields.booking_source, "AD TEST");
  assert.equal(parsed.fields.student_name, "Example Student");
  assert.equal(parsed.fields.first_preferred_time, "09:30");
  assert.equal(parsed.fields.customer_message, "Please call first.\nThank you.");
});

test("pending import migration preserves RLS and Gmail message idempotency", () => {
  assert.match(pendingImportSql, new RegExp(`create table if not exists public\\.${PENDING_TRIAL_BOOKING_IMPORT_TABLE}`));
  assert.match(
    pendingImportSql,
    /constraint pending_trial_booking_imports_source_mailbox_gmail_message_id_k\s+unique \(source_mailbox, gmail_message_id\)/
  );
  assert.doesNotMatch(pendingImportSql, /unique \([^)]*gmail_thread_id/i);
  assert.match(pendingImportSql, /alter table public\.pending_trial_booking_imports enable row level security/);
  assert.match(pendingImportSql, /revoke all on public\.pending_trial_booking_imports from anon, authenticated/);
  assert.match(pendingImportSql, /grant select, insert, update, delete on public\.pending_trial_booking_imports to authenticated/);
  assert.match(pendingImportSql, /using \(public\.can_manage_school\(school_id\)\)/);
  assert.match(pendingImportSql, /public\.can_access_org\(organization_id\)/);
  assert.match(pendingImportCourseSql, /add column if not exists course text/);
});
