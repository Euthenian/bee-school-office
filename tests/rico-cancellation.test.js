import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  attachRicoCancellationAlerts,
  calculateMonthlySnapshotAmounts,
  filterMonthlyBillingRows,
  getFirstUnbillableMonthLabel,
  shouldZeroMonthlyBilling
} from "../lib/monthly-billing.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../supabase/migrations/20261002001000_rico_cancellation_verification.sql");
const snapshotMigration = read("../supabase/migrations/20260917001000_student_monthly_billing_snapshots.sql");
const financePage = read("../app/(app)/finance/page.js");
const shell = read("../components/AdminShell.js");
const styles = read("../app/globals.css");
const data = read("../lib/data.js");
const paymentsPage = read("../app/(app)/finance/monthly-payments/page.js");

const ended = {
  profile_id: "profile-1",
  student_id: "student-1",
  student_first_name: "Aki",
  student_last_name: "Bee",
  student_status: "active",
  school_name: "Ohashi",
  billing_end_date: "2026-10-31"
};
const active = { id: "snapshot-2", student_id: "student-2", student_status: "active", student_first_name: "Mika" };

test("nanase Shingo: October stays billable while RICO needs attention before November", () => {
  const student = {
    ...ended,
    student_first_name: "Shingo",
    student_last_name: "nanase",
    billing_end_date: "2026-10-30",
    monthly_fee_yen: 22500
  };
  const octoberAmount = calculateMonthlySnapshotAmounts(student, "2026-10-01");
  const novemberAmount = calculateMonthlySnapshotAmounts(student, "2026-11-01");
  const octoberRows = attachRicoCancellationAlerts([], [student], "2026-10-01");
  const novemberRows = attachRicoCancellationAlerts([], [student], "2026-11-01");

  assert.deepEqual(octoberAmount, { baseAmount: 22500, finalAmount: 22500 });
  assert.equal(octoberRows[0].final_amount, 22500);
  assert.equal(filterMonthlyBillingRows(octoberRows, { status: "rico-cancellation" }).length, 1);
  assert.equal(getFirstUnbillableMonthLabel(student.billing_end_date), "Nov 2026");
  assert.match(financePage, /Do not charge from \{getFirstUnbillableMonthLabel\(row\.ricoCancellation\.billing_end_date\)\}/);
  assert.match(financePage, /formatBillingAmount\(row\.final_amount, row\.currency\)/);

  assert.deepEqual(novemberAmount, { baseAmount: 0, finalAmount: 0 });
  assert.equal(novemberRows[0].final_amount, 0);
  assert.equal(filterMonthlyBillingRows(novemberRows, { status: "rico-cancellation" }).length, 1);

  const octoberSnapshot = { id: "october", student_id: student.student_id, billing_month: "2026-10-01", final_amount: 22500 };
  const novemberSnapshot = { id: "november", student_id: student.student_id, billing_month: "2026-11-01", final_amount: 0 };
  for (const snapshot of [octoberSnapshot, novemberSnapshot]) {
    const before = attachRicoCancellationAlerts([snapshot], [student], snapshot.billing_month);
    const after = attachRicoCancellationAlerts([snapshot], [], snapshot.billing_month);
    assert.equal(before[0].ricoCancellation.profile_id, student.profile_id);
    assert.equal(after[0].ricoCancellation, null);
    assert.equal(after[0].final_amount, snapshot.final_amount);
  }
});

test("final month is billable and following months remain zero", () => {
  assert.equal(shouldZeroMonthlyBilling(ended.billing_end_date, "2026-10-01"), false);
  assert.deepEqual(calculateMonthlySnapshotAmounts({ billing_end_date: ended.billing_end_date, monthly_fee_yen: 7500 }, "2026-10-01"), { baseAmount: 7500, finalAmount: 7500 });
  assert.deepEqual(calculateMonthlySnapshotAmounts({ billing_end_date: ended.billing_end_date, monthly_fee_yen: 7500 }, "2026-11-01"), { baseAmount: 0, finalAmount: 0 });
  assert.deepEqual(calculateMonthlySnapshotAmounts({ billing_end_date: ended.billing_end_date, monthly_fee_yen: 7500 }, "2027-01-01"), { baseAmount: 0, finalAmount: 0 });
  assert.match(snapshotMigration, /on conflict \(student_id, billing_month\) do nothing/);
});

test("unresolved student remains visible, receives warning, and filters correctly", () => {
  const snapshots = [{ id: "snapshot-1", student_id: "student-1", student_status: "active", student_first_name: "Aki" }, active];
  const rows = attachRicoCancellationAlerts(snapshots, [ended], "2026-11-01");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].ricoCancellation.profile_id, ended.profile_id);
  assert.equal(rows[1].ricoCancellation, null);
  assert.deepEqual(filterMonthlyBillingRows(rows, { status: "rico-cancellation" }).map((row) => row.student_id), [ended.student_id]);
  assert.match(financePage, /row\.ricoCancellation \? "monthly-billing-rico-warning"/);
  assert.match(financePage, /RICO cancellation to verify/);
  assert.match(styles, /\.monthly-billing-rico-warning > td[\s\S]*background: #fff0f0/);
});

test("unresolved alert is still visible before a monthly snapshot exists", () => {
  const rows = attachRicoCancellationAlerts([active], [ended], "2026-11-01");
  assert.equal(rows.length, 2);
  assert.equal(rows[1].id, null);
  assert.equal(rows[1].base_amount, 0);
  assert.equal(rows[1].final_amount, 0);
  assert.equal(filterMonthlyBillingRows(rows, { status: "rico-cancellation" }).length, 1);
});

test("verification removes the warning and filter match without altering the snapshot", () => {
  const snapshot = { id: "snapshot-1", student_id: "student-1", billing_end_date: ended.billing_end_date, final_amount: 0 };
  const before = attachRicoCancellationAlerts([snapshot], [ended], "2026-11-01");
  const after = attachRicoCancellationAlerts([snapshot], [], "2026-11-01");
  assert.equal(before[0].ricoCancellation.profile_id, ended.profile_id);
  assert.equal(after[0].ricoCancellation, null);
  assert.equal(filterMonthlyBillingRows(after, { status: "rico-cancellation" }).length, 0);
  assert.equal(after[0].billing_end_date, ended.billing_end_date);
  assert.equal(after[0].final_amount, 0);
  assert.match(migration, /set rico_cancellation_verified_at = now\(\),\s*rico_cancellation_verified_by = auth\.uid\(\)/);
});

test("badge derives one latest profile per student from the same alert RPC", () => {
  assert.match(migration, /select distinct on \(sbp\.student_id\) sbp\.\*/);
  assert.match(migration, /lp\.billing_end_date < v_next_month_start\s+and lp\.rico_cancellation_verified_at is null/);
  assert.match(migration, /v_next_month_start date := \(date_trunc\('month', coalesce\(p_billing_month, \(now\(\) at time zone 'Asia\/Tokyo'\)::date\)\) \+ interval '1 month'\)::date/);
  assert.match(data, /get_unverified_rico_cancellations_mvp/);
  assert.match(data, /count: data\?\.length \|\| 0/);
  assert.match(shell, /fetchUnverifiedRicoCancellations\(supabase\)/);
  assert.match(shell, /formatCountBadgeValue\(ricoCancellationCount\)/);
  assert.match(shell, /finance\/\?filter=rico-cancellation#monthly-billing/);
});

test("server enforces authorization, actionable date, and current lifecycle", () => {
  assert.match(migration, /references public\.profiles \(id\) on delete set null/);
  assert.match(migration, /if not public\.is_super_admin\(\) or auth\.uid\(\) is null then/);
  assert.match(migration, /v_profile\.billing_end_date >= \(date_trunc\('month', p_billing_month\) \+ interval '1 month'\)::date/);
  assert.match(migration, /v_profile\.rico_cancellation_verified_at is not null/);
  assert.match(migration, /for update/);
  assert.match(migration, /revoke all on function public\.verify_rico_cancellation_mvp\(uuid, date\) from public, anon/);
  assert.match(financePage, /window\.confirm\(`Confirm that RICO direct debit cancellation has been checked/);
});

test("new end date resets verification; unrelated edits do not", () => {
  assert.match(migration, /if new\.billing_end_date is distinct from old\.billing_end_date then\s+new\.rico_cancellation_verified_at = null;\s+new\.rico_cancellation_verified_by = null/);
  assert.match(migration, /elsif new\.rico_cancellation_verified_at is distinct from old\.rico_cancellation_verified_at/);
  assert.match(migration, /create trigger student_billing_profiles_rico_verification\s+before insert or update on public\.student_billing_profiles/);
  assert.match(migration, /if tg_op = 'INSERT' then[\s\S]*and not public\.is_super_admin\(\)/);
});

test("verification SQL leaves student and payment history untouched", () => {
  assert.doesNotMatch(migration, /\b(?:insert|update|delete|truncate)\s+(?:into\s+|from\s+)?public\.(?:students|student_payments|student_monthly_billing_snapshots)\b/i);
  assert.match(paymentsPage, /fetchMonthlyStudentPayments/);
  assert.doesNotMatch(paymentsPage, /fetchStudentMonthlyBillingSnapshots|get_unverified_rico_cancellations_mvp/);
});
