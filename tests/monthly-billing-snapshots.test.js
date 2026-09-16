import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildMonthlyBillingSnapshotUpdate,
  calculateMonthlySnapshotAmounts,
  filterMonthlyBillingRows,
  getBillingStopAlertLabel,
  getBillingStopTiming,
  getUpcomingBillingChangeCount,
  shouldZeroMonthlyBilling
} from "../lib/monthly-billing.js";

const migrationSql = readFileSync(
  new URL("../supabase/migrations/20260917001000_student_monthly_billing_snapshots.sql", import.meta.url),
  "utf8"
);
const dataSource = readFileSync(new URL("../lib/data.js", import.meta.url), "utf8");
const financePage = readFileSync(new URL("../app/(app)/finance/page.js", import.meta.url), "utf8");
const studentFinanceSource = readFileSync(new URL("../lib/student-finance.js", import.meta.url), "utf8");
const studentFinanceForm = readFileSync(new URL("../components/StudentFinanceForm.js", import.meta.url), "utf8");
const rolesSource = readFileSync(new URL("../lib/roles.js", import.meta.url), "utf8");

test("monthly billing snapshots copy default fee and freeze historical months", () => {
  assert.deepEqual(
    calculateMonthlySnapshotAmounts({ billing_end_date: "", monthly_fee_yen: 7000 }, "2026-10-01"),
    { baseAmount: 7000, finalAmount: 7000 }
  );
  assert.match(migrationSql, /default_monthly_fee_yen integer/);
  assert.match(migrationSql, /base_amount numeric\(12, 2\) not null default 0/);
  assert.match(migrationSql, /final_amount numeric\(12, 2\) not null default 0/);
  assert.match(migrationSql, /coalesce\(lp\.monthly_fee_yen, 0\)::numeric/);
  assert.doesNotMatch(
    migrationSql.match(/create or replace function public\.update_student_monthly_billing_snapshot_mvp[\s\S]*?\n\$\$;/)?.[0] || "",
    /monthly_fee_yen/
  );
  assert.match(migrationSql, /current_default_monthly_fee_yen integer/);
});

test("later default-fee changes affect future generation without rewriting existing snapshots", () => {
  assert.match(migrationSql, /insert into public\.student_monthly_billing_snapshots/);
  assert.match(migrationSql, /on conflict \(student_id, billing_month\) do nothing/);
  assert.match(migrationSql, /left join latest_profiles lp/);
  assert.match(migrationSql, /smbs\.default_monthly_fee_yen/);
  assert.match(migrationSql, /lp\.monthly_fee_yen/);
});

test("billing end dates zero out months after the final billable month", () => {
  assert.equal(shouldZeroMonthlyBilling("2026-09-30", "2026-09-01"), false);
  assert.equal(shouldZeroMonthlyBilling("2026-09-30", "2026-10-01"), true);
  assert.equal(shouldZeroMonthlyBilling("2026-09-30", "2026-11-01"), true);
  assert.deepEqual(
    calculateMonthlySnapshotAmounts({ billing_end_date: "2026-09-30", monthly_fee_yen: 7600 }, "2026-10-01"),
    { baseAmount: 0, finalAmount: 0 }
  );
  assert.match(migrationSql, /when lp\.billing_end_date is not null and lp\.billing_end_date < v_month_start then 0::numeric/);
});

test("monthly row edits keep payment, comment, refund, and default fee separate", () => {
  const payload = buildMonthlyBillingSnapshotUpdate({
    comment: "  Absent for two weeks - adjusted fee  ",
    finalAmount: "5000",
    overrideReason: "manual adjustment",
    refundAmount: "2000"
  });

  assert.deepEqual(payload, {
    comment: "Absent for two weeks - adjusted fee",
    finalAmount: 5000,
    overrideReason: "manual adjustment",
    refundAmount: 2000
  });
  assert.match(migrationSql, /refund_amount numeric\(12, 2\) not null default 0/);
  assert.match(migrationSql, /comment text/);
  assert.match(migrationSql, /manual_override boolean not null default false/);
  assert.match(migrationSql, /v_final_amount <> base_amount/);
  assert.doesNotMatch(
    migrationSql.match(/create or replace function public\.update_student_monthly_billing_snapshot_mvp[\s\S]*?\n\$\$;/)?.[0] || "",
    /student_billing_profiles|monthly_fee_yen/
  );
});

test("month creation is idempotent and uses one row per student-month", () => {
  assert.match(migrationSql, /unique \(student_id, billing_month\)/);
  assert.match(migrationSql, /on conflict \(student_id, billing_month\) do nothing/);
  assert.match(migrationSql, /existing_count integer/);
  assert.match(dataSource, /create_student_monthly_billing_snapshots_mvp/);
});

test("stopping-student alerts cover this month, next month, and global count", () => {
  assert.equal(getBillingStopTiming("2026-09-30", "2026-09-01"), "this_month");
  assert.equal(getBillingStopTiming("2026-10-15", "2026-09-01"), "next_month");
  assert.equal(getBillingStopAlertLabel("this_month"), "\u2605 Stops this month \u00b7 Next month \u00a50");
  assert.equal(getBillingStopAlertLabel("next_month"), "\u2605 Stops next month \u00b7 Payment will become \u00a50");
  assert.equal(
    getUpcomingBillingChangeCount([
      { billing_change_timing: "this_month" },
      { billing_change_timing: "next_month" },
      { billing_change_timing: "" }
    ]),
    2
  );
  assert.match(financePage, /upcoming-trial-lesson-indicator/);
  assert.match(financePage, /upcoming-trial-lesson-pill/);
  assert.match(financePage, /upcomingBillingChangeCount/);
  assert.match(financePage, /updateMonthlyFilter\("status", "upcoming_change"\)/);
});

test("monthly Finance UI uses month selectors and distinguishes default fee from this month's payment", () => {
  assert.match(financePage, /Student billing snapshots/);
  assert.match(financePage, /Create \$\{selectedMonthLabel\} billing/);
  assert.match(financePage, /Default fee/);
  assert.match(financePage, /\{selectedMonthLabel\} payment/);
  assert.match(financePage, /Comment/);
  assert.match(financePage, /Refund/);
  assert.match(financePage, /monthOptions/);
  assert.doesNotMatch(financePage, /October payment[\s\S]*November payment[\s\S]*December payment/);
});

test("monthly billing filters isolate active, inactive, search, and upcoming changes", () => {
  const rows = [
    { billing_change_timing: "this_month", comment: "Final month", school_name: "Ohashi", student_first_name: "Aki", student_last_name: "Bee", student_status: "active" },
    { billing_change_timing: "", comment: "", school_name: "Ohashi", student_first_name: "Mika", student_last_name: "Cat", student_status: "withdrawn" }
  ];

  assert.equal(filterMonthlyBillingRows(rows, { status: "active" }).length, 1);
  assert.equal(filterMonthlyBillingRows(rows, { status: "inactive" }).length, 1);
  assert.equal(filterMonthlyBillingRows(rows, { status: "upcoming_change" }).length, 1);
  assert.equal(filterMonthlyBillingRows(rows, { search: "final", status: "all" }).length, 1);
});

test("billing profile reuses existing student_billing_profiles and adds start/end dates", () => {
  assert.match(migrationSql, /alter table public\.student_billing_profiles[\s\S]*add column if not exists billing_start_date date/);
  assert.match(migrationSql, /add column if not exists billing_end_date date/);
  assert.match(studentFinanceSource, /billing_start_date/);
  assert.match(studentFinanceSource, /billing_end_date/);
  assert.match(studentFinanceForm, /Billing start date/);
  assert.match(studentFinanceForm, /Billing end date/);
  assert.match(dataSource, /p_billing_start_date/);
  assert.match(dataSource, /p_billing_end_date/);
});

test("monthly billing authorization uses existing billing/finance restrictions and does not weaken RLS", () => {
  assert.match(migrationSql, /alter table public\.student_monthly_billing_snapshots enable row level security/);
  assert.match(migrationSql, /revoke all on public\.student_monthly_billing_snapshots from anon, authenticated/);
  assert.match(migrationSql, /using \(public\.can_manage_student_billing_org\(organization_id\)\)/);
  assert.match(migrationSql, /with check \(public\.can_manage_student_billing_org\(organization_id\)\)/);
  assert.match(migrationSql, /revoke all on function public\.create_student_monthly_billing_snapshots_mvp\(uuid, uuid, date\) from public, anon/);
  assert.match(migrationSql, /revoke all on function public\.update_student_monthly_billing_snapshot_mvp\(uuid, numeric, text, numeric, text\) from public, anon/);
  assert.match(rolesSource, /export function canManageFinance\(profile\)[\s\S]*super_admin/);
});
