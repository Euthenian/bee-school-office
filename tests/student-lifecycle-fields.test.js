import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { calculateMonthlySnapshotAmounts, shouldZeroMonthlyBilling } from "../lib/monthly-billing.js";
import { createEmptyStudentForm, createStudentEditState } from "../lib/student-form.js";
import { createStudentFinanceForm } from "../lib/student-finance.js";

const migrationSql = readFileSync(
  new URL("../supabase/migrations/20260930001000_student_last_lesson_date_rico_id.sql", import.meta.url),
  "utf8"
);
const financeLifecycleMigrationSql = readFileSync(
  new URL("../supabase/migrations/20260930002000_student_finance_lifecycle_rico_sync.sql", import.meta.url),
  "utf8"
);
const dataSource = readFileSync(new URL("../lib/data.js", import.meta.url), "utf8");
const studentNewPage = readFileSync(new URL("../app/(app)/students/new/page.js", import.meta.url), "utf8");
const studentEditPage = readFileSync(new URL("../app/(app)/students/edit/page.js", import.meta.url), "utf8");
const studentProfilePage = readFileSync(new URL("../app/(app)/students/profile/page.js", import.meta.url), "utf8");
const studentFinanceEditPage = readFileSync(new URL("../app/(app)/students/finance/edit/page.js", import.meta.url), "utf8");
const studentFinanceForm = readFileSync(new URL("../components/StudentFinanceForm.js", import.meta.url), "utf8");

test("students receive last_lesson_date but no duplicate Rico ID column", () => {
  assert.match(migrationSql, /alter table public\.students[\s\S]*add column if not exists last_lesson_date date/);
  assert.match(financeLifecycleMigrationSql, /alter table public\.students[\s\S]*add column if not exists last_lesson_date date/);
  assert.doesNotMatch(migrationSql, /rico_id/i);
  assert.doesNotMatch(financeLifecycleMigrationSql, /rico_id/i);
  assert.doesNotMatch(dataSource, /rico_id/i);
});

test("student form state loads and clears Last lesson date and exposes Rico ID through legacy_customer_id", () => {
  assert.equal(createEmptyStudentForm().lastLessonDate, "");
  assert.equal(createEmptyStudentForm().legacyCustomerId, "");

  const editState = createStudentEditState({
    legacy_customer_id: "RICO-123",
    last_lesson_date: "2026-10-31",
    school_id: "school-1",
    student_contacts: [],
    student_enrollments: []
  });

  assert.equal(editState.form.lastLessonDate, "2026-10-31");
  assert.equal(editState.form.legacyCustomerId, "RICO-123");
});

test("normal student create and update RPC payloads persist lifecycle and Rico fields", () => {
  assert.match(dataSource, /p_last_lesson_date: emptyToNull\(input\.lastLessonDate\)/);
  assert.match(dataSource, /p_legacy_customer_id: emptyToNull\(input\.legacyCustomerId\)/);
  assert.match(dataSource, /p_legacy_customer_id: payload\.legacyCustomerId \?\? ""/);
  assert.match(migrationSql, /p_last_lesson_date date default null/);
  assert.match(migrationSql, /p_legacy_customer_id text default null/);
  assert.match(migrationSql, /last_lesson_date = p_last_lesson_date/);
  assert.match(migrationSql, /legacy_customer_id = nullif\(trim\(coalesce\(p_legacy_customer_id, ''\)\), ''\)/);
});

test("Last lesson date synchronizes to existing billing profiles and can be cleared", () => {
  assert.match(
    migrationSql,
    /update public\.student_billing_profiles sbp[\s\S]*set billing_end_date = p_last_lesson_date[\s\S]*where sbp\.student_id = v_student_id/
  );
  assert.match(
    migrationSql,
    /update public\.student_billing_profiles sbp[\s\S]*set billing_end_date = p_last_lesson_date[\s\S]*where sbp\.student_id = p_student_id/
  );
  assert.match(financeLifecycleMigrationSql, /set last_lesson_date = p_billing_end_date/);
  assert.match(financeLifecycleMigrationSql, /p_billing_end_date/);
  assert.match(migrationSql, /with latest_billing as/);
  assert.doesNotMatch(migrationSql, /insert into public\.student_billing_profiles[\s\S]*billing_end_date = p_last_lesson_date/);
});

test("Last lesson date keeps its month billable and stops later billing without touching payments or status", () => {
  assert.equal(shouldZeroMonthlyBilling("2026-10-31", "2026-10-01"), false);
  assert.equal(shouldZeroMonthlyBilling("2026-10-31", "2026-11-01"), true);
  assert.deepEqual(
    calculateMonthlySnapshotAmounts({ billing_end_date: "2026-10-31", monthly_fee_yen: 10000 }, "2026-11-01"),
    { baseAmount: 0, finalAmount: 0 }
  );
  assert.doesNotMatch(migrationSql, /student_payments/);
  assert.doesNotMatch(financeLifecycleMigrationSql, /student_payments/);
  assert.doesNotMatch(migrationSql, /status = p_last_lesson_date|p_last_lesson_date[\s\S]*status =/);
  assert.doesNotMatch(financeLifecycleMigrationSql, /status = p_billing_end_date|p_billing_end_date[\s\S]*status =/);
});

test("student UI shows editable Last lesson date and Rico ID, while profile exposes Rico ID", () => {
  assert.match(studentNewPage, /Last lesson date/);
  assert.match(studentNewPage, /updateField\("lastLessonDate"/);
  assert.match(studentNewPage, /Rico ID/);
  assert.match(studentNewPage, /updateField\("legacyCustomerId"/);
  assert.match(studentEditPage, /Last lesson date/);
  assert.match(studentEditPage, /updateField\("lastLessonDate"/);
  assert.match(studentEditPage, /Rico ID/);
  assert.match(studentEditPage, /updateField\("legacyCustomerId"/);
  assert.match(studentProfilePage, /<dt>Last lesson date<\/dt>/);
  assert.match(studentProfilePage, /<dt>Rico ID<\/dt>/);
  assert.match(studentProfilePage, /student\.legacy_customer_id/);
});

test("Finance Edit edits the shared Last lesson date through Billing end date and exposes Rico ID", () => {
  const form = createStudentFinanceForm({ billing_end_date: "2026-09-30" }, {}, { last_lesson_date: "2026-10-31" });

  assert.equal(form.billingEndDate, "2026-10-31");
  assert.match(studentFinanceForm, /Billing end date/);
  assert.match(studentFinanceForm, /updateField\("billingEndDate"/);
  assert.match(studentFinanceForm, /type="date"[\s\S]*value=\{form\.billingEndDate\}/);
  assert.match(studentFinanceForm, /Rico ID/);
  assert.match(studentFinanceForm, /updateField\("legacyCustomerId"/);
  assert.match(studentFinanceEditPage, /createStudentFinanceForm\(state\.finance \|\| \{\}, state\.bankDetails \|\| \{\}, state\.student \|\| \{\}\)/);
  assert.doesNotMatch(studentFinanceEditPage, /billingEndDate: hasFinance/);
  assert.match(financeLifecycleMigrationSql, /legacy_customer_id = case[\s\S]*p_legacy_customer_id/);
});
