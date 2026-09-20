import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createBillingPlanForm, formatLessonPackageOption, validateBillingPlanForm } from "../lib/billing-plans.js";
import { createStudentFinanceForm, normalizeStudentFinance, normalizeStudentFinancePayload } from "../lib/student-finance.js";
import { canEditStudentFinance, getVisibleNavigation } from "../lib/roles.js";

const billingPlansMigration = readFileSync(
  new URL("../supabase/migrations/20260919001000_billing_plans.sql", import.meta.url),
  "utf8"
);
const lessonPackageDetailsMigration = readFileSync(
  new URL("../supabase/migrations/20260920002000_lesson_package_details.sql", import.meta.url),
  "utf8"
);
const monthlySnapshotMigration = readFileSync(
  new URL("../supabase/migrations/20260917001000_student_monthly_billing_snapshots.sql", import.meta.url),
  "utf8"
);
const dataSource = readFileSync(new URL("../lib/data.js", import.meta.url), "utf8");
const studentFinanceForm = readFileSync(new URL("../components/StudentFinanceForm.js", import.meta.url), "utf8");
const studentClassAssignment = readFileSync(new URL("../components/StudentClassAssignment.js", import.meta.url), "utf8");
const studentNewPage = readFileSync(new URL("../app/(app)/students/new/page.js", import.meta.url), "utf8");
const studentEditPage = readFileSync(new URL("../app/(app)/students/edit/page.js", import.meta.url), "utf8");
const studentFinanceEditPage = readFileSync(new URL("../app/(app)/students/finance/edit/page.js", import.meta.url), "utf8");
const settingsPage = readFileSync(new URL("../app/(app)/settings/page.js", import.meta.url), "utf8");
const billingPlansSettingsPage = readFileSync(new URL("../app/(app)/settings/billing-plans/page.js", import.meta.url), "utf8");
const classManagementMigration = readFileSync(
  new URL("../supabase/migrations/20260920003000_class_management_and_student_assignment.sql", import.meta.url),
  "utf8"
);

test("billing_plans migration creates the minimal finance-scoped plan table", () => {
  assert.match(billingPlansMigration, /create table if not exists public\.billing_plans/);
  assert.match(billingPlansMigration, /id uuid primary key default gen_random_uuid\(\)/);
  assert.match(billingPlansMigration, /organization_id uuid not null references public\.organizations \(id\) on delete restrict/);
  assert.match(billingPlansMigration, /school_id uuid references public\.schools \(id\) on delete restrict/);
  assert.match(billingPlansMigration, /name text not null/);
  assert.match(billingPlansMigration, /monthly_fee_yen integer not null/);
  assert.match(billingPlansMigration, /active boolean not null default true/);
  assert.match(billingPlansMigration, /sort_order integer not null default 100/);
  assert.match(billingPlansMigration, /billing_plans_scope_active_sort_idx/);
  assert.match(billingPlansMigration, /billing_plans_set_updated_at/);
  assert.match(billingPlansMigration, /monthly_fee_yen >= 0/);
  assert.doesNotMatch(billingPlansMigration, /\bclasses\b/);
});

test("lesson package details migration extends billing_plans without touching schedules", () => {
  assert.match(lessonPackageDetailsMigration, /alter table public\.billing_plans/);
  assert.match(lessonPackageDetailsMigration, /add column if not exists lesson_type public\.class_lesson_type/);
  assert.match(lessonPackageDetailsMigration, /add column if not exists lesson_duration_minutes integer/);
  assert.match(lessonPackageDetailsMigration, /add column if not exists lessons_per_month integer/);
  assert.match(lessonPackageDetailsMigration, /lesson_duration_minutes is null or lesson_duration_minutes > 0/);
  assert.match(lessonPackageDetailsMigration, /lessons_per_month is null or lessons_per_month > 0/);
  assert.doesNotMatch(lessonPackageDetailsMigration, /student_monthly_billing_snapshots|student_charges|student_payments|student_refunds|student_enrollments|classes/);
});

test("student billing profiles receive an optional Billing Plan reference only", () => {
  assert.match(billingPlansMigration, /alter table public\.student_billing_profiles[\s\S]*add column if not exists billing_plan_id uuid references public\.billing_plans \(id\) on delete restrict/);
  assert.doesNotMatch(billingPlansMigration, /billing_plan_id uuid not null/);
  assert.match(billingPlansMigration, /monthly_fee_yen remains the authoritative copied amount/);
  assert.match(billingPlansMigration, /validate_student_billing_profile_billing_plan/);
  assert.match(billingPlansMigration, /v_plan\.organization_id <> new\.organization_id/);
  assert.match(billingPlansMigration, /Inactive Billing Plans cannot be newly assigned/);
});

test("Billing Plan RLS uses student finance roles and excludes teachers", () => {
  assert.match(billingPlansMigration, /create policy "billing_plans_finance_access"/);
  assert.match(billingPlansMigration, /can_manage_student_finance_org\(organization_id, school_id\)/);
  assert.match(billingPlansMigration, /array\['franchise_owner', 'office_staff'\]::public\.membership_role\[\]/);
  assert.doesNotMatch(billingPlansMigration, /teacher/);
  assert.equal(canEditStudentFinance({ school_memberships: [{ role: "teacher" }] }), false);
  assert.equal(getVisibleNavigation({ school_memberships: [{ role: "teacher" }] }).some((item) => item.href === "/settings/"), false);
});

test("student Billing Plan options include active scoped plans and the current inactive plan", () => {
  const optionsFunction = billingPlansMigration.match(/create or replace function public\.get_student_billing_plan_options_mvp[\s\S]*?grant execute on function public\.get_student_billing_plan_options_mvp\(uuid\) to authenticated;/)?.[0] || "";

  assert.match(optionsFunction, /bp\.active = true/);
  assert.match(optionsFunction, /bp\.school_id is null or bp\.school_id = v_student\.school_id/);
  assert.match(optionsFunction, /or bp\.id = v_current_billing_plan_id/);
  assert.match(lessonPackageDetailsMigration, /lesson_type public\.class_lesson_type/);
  assert.match(lessonPackageDetailsMigration, /bp\.lesson_duration_minutes/);
  assert.match(lessonPackageDetailsMigration, /bp\.lessons_per_month/);
  assert.match(optionsFunction, /order by bp\.sort_order, bp\.name/);
  assert.match(dataSource, /fetchStudentBillingPlanOptions/);
  assert.match(studentFinanceEditPage, /fetchStudentBillingPlanOptions\(supabase, studentId\)/);
});

test("finance RPC returns and saves Billing Plan IDs without dynamic fee derivation", () => {
  const getFunction = billingPlansMigration.match(/create or replace function public\.get_student_finance_mvp[\s\S]*?grant execute on function public\.get_student_finance_mvp\(uuid\) to authenticated;/)?.[0] || "";
  const updateFunction = billingPlansMigration.match(/create or replace function public\.update_student_finance_mvp\(\s*p_student_id uuid,\s*p_billing_plan_id uuid[\s\S]*?grant execute on function public\.update_student_finance_mvp\(uuid, uuid, integer, text, boolean, text, text, text, text, text, text, text, text, date, date\) to authenticated;/)?.[0] || "";

  assert.match(getFunction, /billing_plan_id uuid/);
  assert.match(getFunction, /v_billing\.billing_plan_id/);
  assert.match(updateFunction, /v_plan\.organization_id <> v_student\.organization_id/);
  assert.match(updateFunction, /v_plan\.school_id is not null and v_plan\.school_id <> v_student\.school_id/);
  assert.match(updateFunction, /Inactive Billing Plans cannot be newly assigned/);
  assert.match(updateFunction, /v_current_billing_plan_id is distinct from p_billing_plan_id/);
  assert.match(updateFunction, /v_monthly_fee_yen = coalesce\(p_monthly_fee_yen/);
  assert.match(updateFunction, /perform public\.update_student_finance_mvp\([\s\S]*v_monthly_fee_yen/);
  assert.match(updateFunction, /set billing_plan_id = p_billing_plan_id/);
  assert.match(dataSource, /p_billing_plan_id: payload\.billingPlanId/);
});

test("student finance custom-fee profiles load and save without losing existing fees", () => {
  const finance = normalizeStudentFinance({ billing_plan_id: null, monthly_fee_yen: 15800 });
  const form = createStudentFinanceForm(finance, {});
  const payload = normalizeStudentFinancePayload(form, { canEditBankDetails: false });

  assert.equal(form.billingPlanId, "");
  assert.equal(form.monthlyFeeYen, "15800");
  assert.equal(payload.billingPlanId, null);
  assert.equal(payload.monthlyFeeYen, 15800);
  assert.match(studentFinanceForm, /<option value=\{customFeeValue\}>Custom fee<\/option>/);
  assert.match(studentFinanceForm, /Lesson package/);
});

test("selecting a Lesson Package copies its fee while stored student fees remain snapshots", () => {
  assert.match(studentFinanceForm, /updateBillingPlan/);
  assert.match(studentFinanceForm, /String\(selectedPlan\.monthly_fee_yen\)/);
  assert.match(studentFinanceForm, /readOnly=\{hasSelectedPlan\}/);
  assert.match(studentFinanceForm, /value=\{form\.monthlyFeeYen\}/);
  assert.doesNotMatch(monthlySnapshotMigration, /billing_plans/);
  assert.match(monthlySnapshotMigration, /coalesce\(lp\.monthly_fee_yen, 0\)::numeric/);
  assert.match(monthlySnapshotMigration, /default_monthly_fee_yen/);
});

test("Student create and edit forms collect Lesson Package separately from Class assignment", () => {
  assert.match(studentClassAssignment, /Lesson package/);
  assert.match(studentClassAssignment, /formatLessonPackageOption/);
  assert.match(studentClassAssignment, /Custom fee/);
  assert.match(studentClassAssignment, /Monthly fee/);
  assert.match(studentClassAssignment, /readOnly=\{Boolean\(selectedBillingPlan\)\}/);
  assert.match(studentClassAssignment, /packageLocksLessonType/);
  assert.match(studentClassAssignment, /Lesson type comes from the selected package/);
  assert.match(studentClassAssignment, /Class/);
  assert.match(studentNewPage, /fetchBillingPlans/);
  assert.match(studentEditPage, /fetchStudentBillingPlanOptions/);
  assert.match(studentEditPage, /fetchStudentFinance/);
  assert.match(studentNewPage + studentEditPage, /<h2>Class Details<\/h2>/);
  assert.match(studentNewPage + studentEditPage, /getPackageClassCompatibilityError/);
  assert.match(studentNewPage + studentEditPage, /Choose a class with the same lesson type as the selected Lesson package/);
  assert.match(dataSource, /p_billing_plan_id: emptyToNull\(input\.billingPlanId\)/);
  assert.match(dataSource, /p_monthly_fee_yen: normalizeOptionalInteger\(input\.monthlyFeeYen\)/);
});

test("Student Class Details persistence updates billing profiles without mutating schedules", () => {
  assert.match(classManagementMigration, /update_student_class_assignment_billing_mvp/);
  assert.match(classManagementMigration, /from public\.student_billing_profiles/);
  assert.match(classManagementMigration, /set billing_plan_id = p_billing_plan_id/);
  assert.match(classManagementMigration, /monthly_fee_yen = v_monthly_fee_yen/);
  assert.match(classManagementMigration, /Inactive Lesson Packages cannot be newly assigned/);
  assert.match(classManagementMigration, /Selected class lesson type does not match the selected Lesson Package/);
  assert.match(classManagementMigration, /New class lesson type must match the selected Lesson Package/);
  assert.match(classManagementMigration, /perform public\.update_student_class_assignment_billing_mvp/);
  assert.doesNotMatch(classManagementMigration, /postal_address = null|delete from public\.student_addresses/);
  assert.doesNotMatch(studentClassAssignment.match(/function updateBillingPlan[\s\S]*?}\n  }\n/)?.[0] || "", /classId|assignedTeacherProfileId|lessonDay|lessonTime|classLevelId/);
});

test("Lesson Package helpers validate CRUD-style Settings payloads and display package details", () => {
  const form = createBillingPlanForm(
    {
      name: "Private 30 min x 4",
      lesson_type: "private",
      lesson_duration_minutes: 30,
      lessons_per_month: 4,
      monthly_fee_yen: 15800,
      sort_order: 10
    },
    { organizationId: "org-1" }
  );

  assert.equal(form.organizationId, "org-1");
  assert.equal(form.lessonType, "private");
  assert.equal(form.lessonDurationMinutes, "30");
  assert.equal(form.lessonsPerMonth, "4");
  assert.equal(form.monthlyFeeYen, "15800");
  assert.equal(validateBillingPlanForm(form), "");
  assert.equal(validateBillingPlanForm({ ...form, monthlyFeeYen: "15,800" }), "Monthly fee must be a whole yen amount.");
  assert.equal(validateBillingPlanForm({ ...form, lessonDurationMinutes: "0" }), "Lesson duration must be a positive whole number of minutes.");
  assert.equal(validateBillingPlanForm({ ...form, lessonsPerMonth: "0" }), "Lessons per month must be a positive whole number.");
  assert.equal(formatLessonPackageOption({
    name: "Private 30 min x 4",
    lesson_type: "private",
    lesson_duration_minutes: 30,
    lessons_per_month: 4,
    monthly_fee_yen: 15800,
    active: true
  }), "Private 30 min x 4 - \u00a515,800");
  assert.equal(formatLessonPackageOption({
    name: "Standard",
    lesson_type: "private",
    lesson_duration_minutes: 30,
    lessons_per_month: 4,
    monthly_fee_yen: 15800,
    active: true
  }), "Standard / Private / 30 min / 4/month - \u00a515,800");
});

test("Settings > Lesson Packages supports create, edit, deactivate, and no hard delete", () => {
  assert.match(settingsPage, /href="\/settings\/billing-plans\/"/);
  assert.match(settingsPage, /Lesson Packages/);
  assert.match(billingPlansSettingsPage, /Create Lesson Package/);
  assert.match(billingPlansSettingsPage, /Lesson Package Details/);
  assert.match(billingPlansSettingsPage, /Lesson type/);
  assert.match(billingPlansSettingsPage, /Lesson duration/);
  assert.match(billingPlansSettingsPage, /Lessons per month/);
  assert.match(billingPlansSettingsPage, /Scope/);
  assert.match(billingPlansSettingsPage, /All schools/);
  assert.match(billingPlansSettingsPage, /Deactivate/);
  assert.match(billingPlansSettingsPage, /Activate/);
  assert.match(dataSource, /createBillingPlan/);
  assert.match(dataSource, /updateBillingPlan/);
  assert.match(dataSource, /setBillingPlanActive/);
  assert.doesNotMatch(billingPlansSettingsPage, /deleteBillingPlan|\.delete\(/);
});
