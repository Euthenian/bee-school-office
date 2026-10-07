import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canEditStudentCharge, createStudentChargeEditForm, validateStudentChargeForm } from "../lib/billing.js";
import { updateStudentCharge } from "../lib/data.js";
import { getMonthlyCollectionBreakdown } from "../lib/monthly-billing.js";

const migration = readFileSync(new URL("../supabase/migrations/20261007001000_edit_open_student_charges.sql", import.meta.url), "utf8");
const collectionMigration = readFileSync(new URL("../supabase/migrations/20261006001000_monthly_collection_additional_charges.sql", import.meta.url), "utf8");
const profile = readFileSync(new URL("../app/(app)/students/profile/page.js", import.meta.url), "utf8");
const editPage = readFileSync(new URL("../app/(app)/billing/charges/edit/page.js", import.meta.url), "utf8");
const data = readFileSync(new URL("../lib/data.js", import.meta.url), "utf8");
const charge = {
  id: "charge-1", student_id: "student-1", status: "open", amount: "20500",
  description: "Extra lessons", due_date: "2026-11-04", charge_type: "other",
  collection_treatment: "additional", currency: "JPY", billing_period_start: null,
  billing_period_end: null, notes: "", student_payment_allocations: []
};

test("only open charges without any allocation show Edit", () => {
  assert.equal(canEditStudentCharge(charge), true);
  assert.equal(canEditStudentCharge({ ...charge, due_date: "2020-01-01" }), true);
  for (const status of ["paid", "partially_paid", "void", "cancelled", "draft"]) {
    assert.equal(canEditStudentCharge({ ...charge, status }), false, status);
  }
  assert.equal(canEditStudentCharge({ ...charge, student_payment_allocations: [{ id: "allocation-1", amount: 1 }] }), false);
  assert.match(profile, /canEditStudentCharge\(charge\)/);
  assert.match(profile, /billing\/charges\/edit\/\?studentId=/);
});

test("edit form starts with current amount, due date, description, type and treatment", () => {
  const form = createStudentChargeEditForm(charge);
  assert.equal(form.amount, "20500");
  assert.equal(form.dueDate, "2026-11-04");
  assert.equal(form.description, "Extra lessons");
  assert.equal(form.chargeType, "other");
  assert.equal(form.collectionTreatment, "additional");
  assert.equal(validateStudentChargeForm({ ...form, amount: "18500", dueDate: "2026-12-04", description: "Revised lessons", collectionTreatment: "separate" }), "");
  assert.equal(createStudentChargeEditForm({ ...charge, collection_treatment: null }).collectionTreatment, "");
});

test("edit helper submits corrected values to the guarded RPC", async () => {
  let request;
  const supabase = { rpc: async (name, payload) => {
    request = { name, payload };
    return { data: "charge-1", error: null };
  } };
  const form = { ...createStudentChargeEditForm(charge), amount: "18500", description: "Revised lessons", dueDate: "2026-12-04", collectionTreatment: "separate" };
  assert.equal((await updateStudentCharge(supabase, charge.id, form)).error, null);
  assert.equal(request.name, "update_open_student_charge_mvp");
  assert.equal(request.payload.p_charge_id, "charge-1");
  assert.equal(request.payload.p_amount, "18500");
  assert.equal(request.payload.p_description, "Revised lessons");
  assert.equal(request.payload.p_due_date, "2026-12-04");
  assert.equal(request.payload.p_collection_treatment, "separate");
  assert.equal(request.payload.p_charge_type, "other");
  assert.equal("p_status" in request.payload, false);
});

test("server locks and rechecks charge before updating only mutable fields", () => {
  assert.match(migration, /where sc\.id = p_charge_id\s+for update/);
  assert.match(migration, /v_charge\.status <> 'open' or exists \([\s\S]*?student_payment_allocations/);
  for (const field of ["amount", "due_date", "charge_type", "collection_treatment", "billing_period_start", "billing_period_end"]) {
    assert.match(migration, new RegExp(`${field} = p_${field}`));
  }
  assert.match(migration, /description = trim\(p_description\)/);
  assert.match(migration, /notes = nullif\(trim\(coalesce\(p_notes/);
  assert.doesNotMatch(migration.match(/update public\.student_charges sc[\s\S]*?where sc\.id = p_charge_id;/)?.[0] || "", /student_id =|organization_id =|school_id =|status =|currency =|created_at =/);
  assert.match(migration, /old\.status <> 'open' or new\.status <> 'open' or v_has_allocation/);
  assert.match(data, /rpc\("update_open_student_charge_mvp"/);
  assert.match(editPage, /router\.push\(cancelHref\)/);
});

test("changed additional amount appears in next payment and due month controls collection", () => {
  const snapshot = { student_id: "student-1", final_amount: 9950 };
  const before = getMonthlyCollectionBreakdown(snapshot, [{ student_id: "student-1", charge_id: "charge-1", collection_treatment: "additional", balance: 20500 }]);
  const after = getMonthlyCollectionBreakdown(snapshot, [{ student_id: "student-1", charge_id: "charge-1", collection_treatment: "additional", balance: 18500 }]);
  assert.equal(before.amountToCharge, 30450);
  assert.equal(after.amountToCharge, 28450);
  assert.match(collectionMigration, /coalesce\(sc\.due_date, sc\.billing_period_start, sc\.billing_period_end\)\s+between v_month_start and v_month_end/);
  assert.match(migration, /due_date = p_due_date/);
});
