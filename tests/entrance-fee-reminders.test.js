import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fetchStudentQuestions } from "../lib/data.js";
import { isSystemStudentQuestion } from "../lib/student-questions.js";

const migration = readFileSync(
  new URL("../supabase/migrations/20261008001000_entrance_fee_question_reminders.sql", import.meta.url),
  "utf8"
);
const profile = readFileSync(new URL("../app/(app)/students/profile/page.js", import.meta.url), "utf8");
const questions = readFileSync(new URL("../app/(app)/questions/page.js", import.meta.url), "utf8");
const data = readFileSync(new URL("../lib/data.js", import.meta.url), "utf8");

test("the source key keeps manual questions separate and permits only one system row per student", () => {
  assert.equal(isSystemStudentQuestion({ source_type: null, question: "Registration fee unpaid" }), false);
  assert.equal(isSystemStudentQuestion({ source_type: "entrance_fee_unpaid" }), true);
  assert.match(migration, /create unique index student_questions_student_source_uidx\s+on public\.student_questions \(student_id, source_type\)\s+where source_type is not null/);
  assert.match(migration, /source_type is null\s+and public\.can_access_org/);
  assert.match(migration, /using \(source_type is null and public\.can_manage_school\(school_id\)\)/);
  assert.match(migration, /on conflict \(student_id, source_type\) where source_type is not null/);
  assert.match(data, /export const studentQuestionSelect = `[\s\S]*?\bsource_type,/);
});

test("remaining entrance-fee debt uses collectible charges and valid allocations", () => {
  assert.match(migration, /sum\(greatest\(sc\.amount - coalesce\(allocations\.amount, 0\), 0\)\)/);
  assert.match(migration, /sc\.charge_type = 'entrance_fee'/);
  assert.match(migration, /sc\.status in \('open', 'partially_paid', 'paid'\)/);
  assert.match(migration, /sc\.amount > 0/);
  assert.match(migration, /spa\.student_charge_id = sc\.id\s+and sp\.status <> 'void'/);
  assert.doesNotMatch(migration, /entrance_package_paid/);
});

test("unpaid or partially paid charges open one due-today reminder and full settlement marks it done", () => {
  assert.match(migration, /if v_remaining > 0 then[\s\S]*?'Registration fee unpaid', current_date, 'open'/);
  assert.match(migration, /when student_questions\.status = 'done' then current_date/);
  assert.match(migration, /status = 'done', completed_at = now\(\)/);
  assert.match(migration, /where student_id = p_student_id\s+and source_type = 'entrance_fee_unpaid'\s+and status = 'open'/);
  assert.match(migration, /for v_student_id in\s+select distinct student_id[\s\S]*?charge_type = 'entrance_fee'/);
});

test("charge, allocation, and payment changes all resynchronize the same student", () => {
  for (const table of ["student_charges", "student_payments", "student_payment_allocations"]) {
    assert.match(migration, new RegExp(`after insert or update or delete on public\\.${table}`));
  }
  assert.match(migration, /tg_op = 'DELETE'[\s\S]*?sync_entrance_fee_question\(old\.student_id\)/);
  assert.match(migration, /new\.student_id is distinct from old\.student_id/);
  assert.match(migration, /from public\.students\s+where id = p_student_id\s+for update/);
});

test("system reminders are displayed without manual dismissal or date-change actions", () => {
  for (const page of [profile, questions]) {
    assert.match(page, /isSystemStudentQuestion\(question\) \? \(/);
    assert.match(page, /Resolve the entrance-fee balance in Billing \/ Payments\./);
    assert.match(page, /Automatic billing reminder/);
  }
  assert.match(migration, /for delete to authenticated\s+using \(source_type is null/);
});

test("the actionable list fetches all open questions beyond the former 200-row cap", async () => {
  const ranges = [];
  const rows = Array.from({ length: 501 }, (_, index) => ({ id: String(index) }));
  const query = {
    select() { return this; },
    order() { return this; },
    eq() { return this; },
    range(first, last) {
      ranges.push([first, last]);
      return Promise.resolve({ data: rows.slice(first, last + 1), error: null });
    }
  };
  const supabase = { from() { return query; } };
  const result = await fetchStudentQuestions(supabase, { status: "open" });
  assert.equal(result.data.length, 501);
  assert.deepEqual(ranges, [[0, 499], [500, 999]]);
});
