import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createStudentChargeForm, validateStudentChargeForm } from "../lib/billing.js";
import { getMonthlyCollectionBreakdown } from "../lib/monthly-billing.js";

const migration = readFileSync(new URL("../supabase/migrations/20261006001000_monthly_collection_additional_charges.sql", import.meta.url), "utf8");
const financePage = readFileSync(new URL("../app/(app)/finance/page.js", import.meta.url), "utf8");
const dataSource = readFileSync(new URL("../lib/data.js", import.meta.url), "utf8");
const row = { student_id: "student-1", final_amount: 15000 };
const charge = (overrides = {}) => ({
  charge_id: "charge-1", student_id: "student-1", collection_treatment: "additional",
  description: "Materials", balance: 5500, ...overrides
});

test("snapshot alone is the amount to charge", () => {
  assert.equal(getMonthlyCollectionBreakdown(row).amountToCharge, 15000);
});

test("additional charges add remaining balances once each", () => {
  const first = charge();
  const second = charge({ charge_id: "charge-2", balance: 1200 });
  const breakdown = getMonthlyCollectionBreakdown(row, [first, first, second]);
  assert.equal(breakdown.additionalAmount, 6700);
  assert.equal(breakdown.amountToCharge, 21700);
  assert.equal(getMonthlyCollectionBreakdown(row, [first]).amountToCharge, 20500);
});

test("settled and ambiguous legacy charges are excluded", () => {
  const breakdown = getMonthlyCollectionBreakdown(row, [
    charge({ balance: 0 }),
    charge({ charge_id: "old-tuition", collection_treatment: null, balance: 15000 })
  ]);
  assert.equal(breakdown.amountToCharge, 15000);
  assert.equal(breakdown.legacyCharges.length, 1);
});

test("selected-month SQL excludes other months, noncollectible statuses and void payment allocations", () => {
  assert.match(migration, /coalesce\(sc\.due_date, sc\.billing_period_start, sc\.billing_period_end\)\s+between v_month_start and v_month_end/);
  assert.match(migration, /sc\.status in \('open', 'partially_paid'\)/);
  assert.match(migration, /sp\.status <> 'void'/);
  assert.match(migration, /sc\.amount - coalesce\(a\.allocated_amount, 0\)/);
  assert.match(migration, /sc\.collection_treatment = 'additional' or sc\.collection_treatment is null/);
  assert.doesNotMatch(migration, /update public\.student_charges\s+set collection_treatment = 'additional'/);
});

test("new charges require explicit treatment and additional charges require a date", () => {
  const form = createStudentChargeForm("student-1");
  assert.equal(form.collectionTreatment, "separate");
  assert.equal(form.chargeType, "other");
  assert.equal(validateStudentChargeForm({ ...form, collectionTreatment: "additional", description: "Materials", amount: "5500" }),
    "Additional RICO charges need a billing period or due date.");
  assert.equal(validateStudentChargeForm({ ...form, collectionTreatment: "additional", description: "Materials", amount: "5500", dueDate: "2026-11-15" }), "");
  assert.match(dataSource, /create_student_charge_for_collection_mvp/);
});

test("Finance table shows the total and breakdown with legacy warning", () => {
  assert.match(financePage, /<th>Amount to charge<\/th>/);
  assert.match(financePage, /collection\.amountToCharge/);
  assert.match(financePage, /collection\.additionalCharges\.map/);
  assert.match(financePage, /unclassified charge\(s\) excluded/);
  assert.match(financePage, /fetchStudentMonthlyCollectionCharges/);
});
