import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  billingMonthFromDate,
  getTokyoDateKey,
  minimumBillingMonthFromNotice,
  validateDepartureConfirmation
} from "../lib/student-departure.js";
import { confirmStudentDeparture, fetchStudentDepartureState, voidStudentDepartureConfirmation } from "../lib/data.js";
import { shouldZeroMonthlyBilling } from "../lib/monthly-billing.js";

const baseSql = readFileSync(new URL("../supabase/migrations/20261013002000_student_departure_confirmation.sql", import.meta.url), "utf8");
const sql = readFileSync(new URL("../supabase/migrations/20261013003000_student_departure_notice_cutoff.sql", import.meta.url), "utf8");
const editPage = readFileSync(new URL("../app/(app)/students/edit/page.js", import.meta.url), "utf8");
const newPage = readFileSync(new URL("../app/(app)/students/new/page.js", import.meta.url), "utf8");

test("valid departure stores independent lesson and billing months", () => {
  assert.equal(billingMonthFromDate("2026-11-30"), "2026-11");
  assert.equal(validateDepartureConfirmation({
    noticeDate: "2026-10-20", finalLessonDate: "2026-10-30", finalBillingMonth: "2026-11",
    billingProfileId: "profile-id", billingStartDate: "2026-04-01"
  }), "");
  assert.match(sql, /update public\.students set last_lesson_date = p_final_lesson_date/);
  assert.match(sql, /update public\.student_billing_profiles set billing_end_date = v_billing_end_date/);
  assert.match(sql, /update public\.students set status = 'withdrawn'/);
  assert.match(sql, /insert into public\.student_departure_confirmations/);
  assert.match(sql, /if not exists \([\s\S]*from public\.student_departure_confirmations dc[\s\S]*set billing_end_date = p_last_lesson_date/);
  assert.equal(shouldZeroMonthlyBilling("2026-11-30", "2026-11-01"), false);
  assert.equal(shouldZeroMonthlyBilling("2026-11-30", "2026-12-01"), true);
});

test("notice cutoff accepts the 15th and requires next-month tuition from the 16th", () => {
  const base = { finalLessonDate: "2026-10-30", billingProfileId: "profile-id" };
  assert.equal(minimumBillingMonthFromNotice("2026-10-10"), "2026-10");
  assert.equal(minimumBillingMonthFromNotice("2026-10-15"), "2026-10");
  assert.equal(minimumBillingMonthFromNotice("2026-10-16"), "2026-11");
  assert.equal(minimumBillingMonthFromNotice("2026-12-16"), "2027-01");
  assert.equal(validateDepartureConfirmation({ ...base, noticeDate: "2026-10-10", finalBillingMonth: "2026-10" }), "");
  assert.equal(validateDepartureConfirmation({ ...base, noticeDate: "2026-10-15", finalBillingMonth: "2026-10" }), "");
  assert.match(validateDepartureConfirmation({ ...base, noticeDate: "2026-10-16", finalBillingMonth: "2026-10" }), /2026-11 or later/);
  assert.equal(validateDepartureConfirmation({ ...base, noticeDate: "2026-10-20", finalBillingMonth: "2026-11" }), "");
  assert.equal(validateDepartureConfirmation({ ...base, noticeDate: "2026-10-20", finalBillingMonth: "2026-12" }), "");
  assert.equal(validateDepartureConfirmation({ ...base, noticeDate: "2026-10-10", finalLessonDate: "2026-11-30", finalBillingMonth: "2026-10" }), "");
  assert.match(sql, /extract\(day from p_notice_date\) > 15/);
  assert.match(sql, /p_final_billing_month < v_minimum_billing_month/);
});

test("notice date defaults to the current Tokyo calendar date and missing notice is rejected", () => {
  assert.equal(getTokyoDateKey(new Date("2026-10-15T14:59:00Z")), "2026-10-15");
  assert.equal(getTokyoDateKey(new Date("2026-10-15T15:01:00Z")), "2026-10-16");
  assert.match(validateDepartureConfirmation({ finalLessonDate: "2026-10-30", finalBillingMonth: "2026-11", billingProfileId: "profile-id" }), /Departure notice date is required/);
  assert.match(sql, /if p_notice_date is null then raise exception 'Departure notice date is required/);
  assert.match(editPage, /noticeDate: getTokyoDateKey\(\)/);
  assert.match(editPage, /Departure notice date/);
});

test("final billing month has a visible YYYY-MM hint and rejects malformed or empty values", () => {
  const base = { noticeDate: "2026-10-20", finalLessonDate: "2026-11-30", billingProfileId: "profile-id" };
  assert.equal(validateDepartureConfirmation({ ...base, finalBillingMonth: "2026-11" }), "");
  for (const finalBillingMonth of ["2026-1", "2026-00", "2026-13", "2026-11-01", "invalid", "0000-11"]) {
    assert.match(validateDepartureConfirmation({ ...base, finalBillingMonth }), /Final billing month must use YYYY-MM/);
  }
  assert.match(validateDepartureConfirmation({ ...base, finalBillingMonth: "" }), /Final billing month is required/);
  assert.match(editPage, /type="month"/);
  assert.match(editPage, /Format: YYYY-MM \(e\.g\. 2026-11\)/);
  assert.match(editPage, /<form[^>]*noValidate onSubmit=\{handleConfirmDeparture\}>/);
  assert.match(editPage, /role="alert">\{departureError\}/);
});

test("missing dates, premature billing month, and missing billing profile block confirmation", () => {
  const base = { noticeDate: "2026-10-20", finalLessonDate: "2026-11-30", finalBillingMonth: "2026-11", billingProfileId: "profile-id" };
  assert.match(validateDepartureConfirmation({ ...base, finalLessonDate: "" }), /Final lesson date is required/);
  assert.match(validateDepartureConfirmation({ ...base, finalBillingMonth: "" }), /Final billing month is required/);
  assert.match(validateDepartureConfirmation({ ...base, finalBillingMonth: "2026-10" }), /2026-11 or later/);
  assert.match(validateDepartureConfirmation({ ...base, billingProfileId: "" }), /billing profile/);
  assert.match(validateDepartureConfirmation({ ...base, billingStartDate: "2026-12-01" }), /billing start date/);
  assert.equal(validateDepartureConfirmation({ ...base, noticeDate: "2026-10-10", finalBillingMonth: "2026-10" }), "");
  assert.match(sql, /A valid current billing profile is required/);
});

test("client passes the exact confirmation RPC signature and never queues email", async () => {
  const calls = [];
  const supabase = { async rpc(name, args) { calls.push({ name, args }); return { data: "event-id", error: null }; } };
  const result = await confirmStudentDeparture(supabase, {
    studentId: "student-id", noticeDate: "2026-10-20", finalLessonDate: "2026-10-30",
    finalBillingMonth: "2026-11", billingProfileId: "profile-id"
  });
  assert.equal(result.data, "event-id");
  assert.deepEqual(calls, [{ name: "confirm_student_departure_mvp", args: {
    p_student_id: "student-id", p_notice_date: "2026-10-20", p_final_lesson_date: "2026-10-30",
    p_final_billing_month: "2026-11-01", p_billing_profile_id: "profile-id"
  } }]);
  assert.match(sql, /drop function public\.confirm_student_departure_mvp\(uuid, date, date, uuid\)/);
  assert.doesNotMatch(sql, /insert into public\.communications|resend|queue_student_email/i);
});

test("repeated and concurrent confirmations use the same active event identity", () => {
  assert.match(baseSql, /create unique index student_departure_one_active_confirmation[\s\S]*where voided_at is null/);
  assert.match(sql, /where id = p_student_id for update/);
  assert.match(sql, /return v_event\.id;/);
  assert.match(sql, /v_event\.notice_date = p_notice_date/);
  assert.match(sql, /already confirmed\. Void it before recording a correction/);
  assert.match(baseSql, /Departure confirmation snapshots cannot be changed/);
  assert.match(baseSql, /Void the departure confirmation before changing its status or dates/);
  assert.match(sql, /notice_date is null or final_billing_month/);
});

test("unconfirmed and bulk withdrawn changes cannot create a confirmation", () => {
  assert.match(baseSql, /Use Confirm Departure to set withdrawn status/);
  assert.match(baseSql, /before insert or update on public\.students/);
  assert.match(newPage, /status !== "withdrawn"/);
  assert.match(editPage, /status !== "withdrawn" \|\| form\.status === "withdrawn"/);
});

test("RICO verification and monthly billing remain independent", () => {
  assert.doesNotMatch(sql, /set rico_cancellation_verified_at|set rico_cancellation_verified_by|student_payments|monthly_billing_snapshots/i);
  assert.match(editPage, /RICO cancellation remains a separate verification step/);
  assert.match(sql, /existing RICO trigger clears verification only if the billing end date changes/i);
});

test("state and correction RPCs preserve event history", async () => {
  const calls = [];
  const supabase = { async rpc(name, args) { calls.push({ name, args }); return { data: [{ active_confirmation_id: "event-id" }], error: null }; } };
  const state = await fetchStudentDepartureState(supabase, "student-id");
  assert.equal(state.data.active_confirmation_id, "event-id");
  await voidStudentDepartureConfirmation(supabase, "student-id", "Date corrected");
  assert.deepEqual(calls[1], { name: "void_student_departure_confirmation_mvp", args: {
    p_student_id: "student-id", p_reason: "Date corrected"
  } });
  assert.match(baseSql, /set voided_at = now\(\), voided_by = auth\.uid\(\), void_reason = trim\(p_reason\)/);
  assert.match(baseSql, /Departure confirmation history cannot be deleted/);
});
