import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dataSource = readFileSync(new URL("../lib/data.js", import.meta.url), "utf8");
const financePage = readFileSync(new URL("../app/(app)/finance/page.js", import.meta.url), "utf8");
const reportPage = readFileSync(new URL("../app/(app)/finance/monthly-payments/page.js", import.meta.url), "utf8");

test("monthly payments report reads actual payment transactions", () => {
  assert.match(dataSource, /export async function fetchMonthlyStudentPayments/);
  assert.match(dataSource, /\.from\("student_payments"\)/);
  assert.match(dataSource, /\.gte\("payment_date", billingMonth\)/);
  assert.match(dataSource, /\.lte\("payment_date", monthEnd\)/);
  assert.match(dataSource, /\.neq\("status", "void"\)/);

  const helperSource = dataSource.match(/export async function fetchMonthlyStudentPayments[\s\S]*?\n}/)?.[0] || "";
  assert.doesNotMatch(helperSource, /student_billing_profiles|monthly_fee_yen|student_monthly_billing_snapshots/);
});

test("monthly payments report exposes month-year selectors and aggregated totals", () => {
  assert.match(reportPage, /Monthly Payments Report/);
  assert.match(reportPage, /fetchMonthlyStudentPayments/);
  assert.match(reportPage, /Month/);
  assert.match(reportPage, /Year/);
  assert.match(reportPage, /Total: \{formatBillingAmount\(total, currency\)\}/);
  assert.match(reportPage, /buildStudentPaymentRows/);
  assert.match(financePage, /href="\/finance\/monthly-payments\/"/);
});
