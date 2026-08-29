import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createStudentChargeForm,
  createStudentPaymentAllocationForm,
  createStudentPaymentForm,
  createStudentRefundForm,
  formatBillingAmount,
  getChargeAllocatedTotal,
  getChargeBalance,
  getPaymentAllocatedTotal,
  getPaymentRefundTotal,
  getPaymentUnallocatedBalance,
  getPrimaryBillingSummary,
  studentChargeTypes,
  studentPaymentMethods,
  validateStudentChargeForm,
  validateStudentPaymentAllocationForm,
  validateStudentPaymentForm,
  validateStudentRefundForm
} from "../lib/billing.js";
import { formatClassSummary, formatLessonTime, lessonDays, lessonTypes } from "../lib/class-details.js";
import {
  addContactRow,
  createContactRowsFromStudentContacts,
  createInitialContactRows,
  markPrimaryContact,
  removeContactRow,
  serializeContactRows,
  updateContactRow
} from "../lib/contacts.js";
import {
  getGmailTrialBookingCronHealthStatus,
  shouldShowGmailTrialBookingCronHealthAlert
} from "../lib/cron-health.js";
import {
  buildProspectCandidateMatch,
  buildPendingTrialBookingReviewPatch,
  fetchFinanceDashboardSummary,
  fetchGmailTrialBookingCronHealth,
  normalizeImportedLessonType,
  compensationTermSelect,
  billingStudentSummarySelect,
  expenseCategorySelect,
  expenseSelect,
  pendingTrialBookingImportSelect,
  pendingTrialBookingReviewEditableColumns,
  payrollEntrySelect,
  payrollPaymentSelect,
  payrollPeriodSelect,
  recentStudentsSelect,
  studentChargeSelect,
  studentListSelect,
  studentPaymentAllocationForChargeSelect,
  studentPaymentAllocationForPaymentSelect,
  studentPaymentSelect,
  studentProfileSelect,
  studentRefundSelect,
  trialLessonSelect
} from "../lib/data.js";
import {
  createExpenseForm,
  expensePaymentMethods,
  expenseStatuses,
  formatExpenseAmount,
  getPrimaryExpenseSummary,
  isExpenseCategoryAvailableForSchool,
  validateExpenseForm
} from "../lib/expenses.js";
import {
  financeDateRangePresets,
  formatFinanceAmount,
  getFinanceDateRange,
  getFinanceOrganizationOptions,
  getFinanceResultTone,
  getFinanceSchoolOptions,
  getPrimaryFinanceSummary,
  normalizeFinanceSummary
} from "../lib/finance.js";
import { formatAgeFromDate, formatStudentAge } from "../lib/format.js";
import { formatCountBadgeValue } from "../lib/navigation-badges.js";
import {
  canCreateStudents,
  canManageBilling,
  canManageExpenses,
  canManageFinance,
  canManagePayroll,
  canManageStaff,
  getHighestRole,
  getRoleSet,
  getVisibleNavigation
} from "../lib/roles.js";
import {
  compensationTypes,
  createCompensationTermForm,
  createPayrollEntryForm,
  createPayrollPaymentForm,
  createPayrollPeriodForm,
  defaultUnitForCompensationType,
  formatPayrollAmount,
  getPayrollEntryPaidTotal,
  getPayrollEntryPaymentStatus,
  validateCompensationTermForm,
  validatePayrollEntryForm,
  validatePayrollPaymentForm,
  validatePayrollPeriodForm
} from "../lib/payroll.js";
import {
  buildStaffAssignmentRows,
  formatStaffAssignmentSummary,
  formatStaffName,
  hasTeachingAssignment,
  serializeStaffAssignments,
  validateStaffForm
} from "../lib/staff.js";
import {
  createStudentEditState,
  serializeGuardianRows,
  serializeNoteRows,
  validateGuardianRows
} from "../lib/student-form.js";
import { serializeParticipants, trialLessonStatuses } from "../lib/trial-lessons.js";

const trialLessonFoundationSql = readFileSync(
  new URL("../supabase/migrations/20260826002000_trial_lessons_foundation.sql", import.meta.url),
  "utf8"
);
const updateStudentSql = readFileSync(
  new URL("../supabase/migrations/20260826005000_update_student_mvp_rpc.sql", import.meta.url),
  "utf8"
);
const pendingTrialBookingConversionSql = readFileSync(
  new URL("../supabase/migrations/20260826008000_pending_trial_booking_conversion.sql", import.meta.url),
  "utf8"
);
const gmailTrialBookingCronHealthSql = readFileSync(
  new URL("../supabase/migrations/20260828001000_gmail_trial_booking_cron_health.sql", import.meta.url),
  "utf8"
);
const staffTeachersSql = readFileSync(
  new URL("../supabase/migrations/20260828002000_staff_teachers_phase1.sql", import.meta.url),
  "utf8"
);
const payrollSql = readFileSync(
  new URL("../supabase/migrations/20260828003000_payroll_foundation.sql", import.meta.url),
  "utf8"
);
const payrollHelperGrantSql = readFileSync(
  new URL("../supabase/migrations/20260828003100_payroll_validate_helper_execute.sql", import.meta.url),
  "utf8"
);
const studentBillingSql = readFileSync(
  new URL("../supabase/migrations/20260828004000_student_billing_foundation.sql", import.meta.url),
  "utf8"
);
const expenseManagementSql = readFileSync(
  new URL("../supabase/migrations/20260828005000_expense_management_foundation.sql", import.meta.url),
  "utf8"
);
const financeDashboardSql = readFileSync(
  new URL("../supabase/migrations/20260828007000_finance_dashboard_foundation.sql", import.meta.url),
  "utf8"
);
const payrollFoundationDoc = readFileSync(new URL("../docs/payroll-foundation.md", import.meta.url), "utf8");
const studentBillingFoundationDoc = readFileSync(new URL("../docs/student-billing-foundation.md", import.meta.url), "utf8");
const expenseManagementDoc = readFileSync(new URL("../docs/expense-management-foundation.md", import.meta.url), "utf8");
const dashboardPage = readFileSync(new URL("../app/(app)/dashboard/page.js", import.meta.url), "utf8");
const financePage = readFileSync(new URL("../app/(app)/finance/page.js", import.meta.url), "utf8");
const studentProfilePage = readFileSync(new URL("../app/(app)/students/profile/page.js", import.meta.url), "utf8");
const studentEditPage = readFileSync(new URL("../app/(app)/students/edit/page.js", import.meta.url), "utf8");
const billingPage = readFileSync(new URL("../app/(app)/billing/page.js", import.meta.url), "utf8");
const billingChargeNewPage = readFileSync(new URL("../app/(app)/billing/charges/new/page.js", import.meta.url), "utf8");
const billingPaymentNewPage = readFileSync(new URL("../app/(app)/billing/payments/new/page.js", import.meta.url), "utf8");
const billingAllocationNewPage = readFileSync(new URL("../app/(app)/billing/allocations/new/page.js", import.meta.url), "utf8");
const billingRefundNewPage = readFileSync(new URL("../app/(app)/billing/refunds/new/page.js", import.meta.url), "utf8");
const expensesPage = readFileSync(new URL("../app/(app)/expenses/page.js", import.meta.url), "utf8");
const expenseNewPage = readFileSync(new URL("../app/(app)/expenses/new/page.js", import.meta.url), "utf8");
const expenseDetailPage = readFileSync(new URL("../app/(app)/expenses/detail/page.js", import.meta.url), "utf8");
const expenseFormComponent = readFileSync(new URL("../components/ExpenseForm.js", import.meta.url), "utf8");
const trialLessonsPage = readFileSync(new URL("../app/(app)/trial-lessons/page.js", import.meta.url), "utf8");
const adminShell = readFileSync(new URL("../components/AdminShell.js", import.meta.url), "utf8");
const staffPage = readFileSync(new URL("../app/(app)/staff/page.js", import.meta.url), "utf8");
const staffNewPage = readFileSync(new URL("../app/(app)/staff/new/page.js", import.meta.url), "utf8");
const staffEditPage = readFileSync(new URL("../app/(app)/staff/edit/page.js", import.meta.url), "utf8");
const staffProfilePage = readFileSync(new URL("../app/(app)/staff/profile/page.js", import.meta.url), "utf8");
const payrollPage = readFileSync(new URL("../app/(app)/payroll/page.js", import.meta.url), "utf8");
const payrollPeriodNewPage = readFileSync(new URL("../app/(app)/payroll/periods/new/page.js", import.meta.url), "utf8");
const payrollPeriodDetailPage = readFileSync(new URL("../app/(app)/payroll/periods/detail/page.js", import.meta.url), "utf8");
const payrollEntryNewPage = readFileSync(new URL("../app/(app)/payroll/entries/new/page.js", import.meta.url), "utf8");
const payrollEntryEditPage = readFileSync(new URL("../app/(app)/payroll/entries/edit/page.js", import.meta.url), "utf8");
const payrollPaymentNewPage = readFileSync(new URL("../app/(app)/payroll/payments/new/page.js", import.meta.url), "utf8");
const pendingTrialBookingsPage = readFileSync(new URL("../app/(app)/trial-lessons/imports/page.js", import.meta.url), "utf8");
const pendingTrialBookingReviewPage = readFileSync(
  new URL("../app/(app)/trial-lessons/imports/review/page.js", import.meta.url),
  "utf8"
);

test("getRoleSet reads organization and school memberships", () => {
  const roleSet = getRoleSet({
    organization_memberships: [{ role: "franchise_owner" }],
    school_memberships: [{ role: "teacher" }]
  });

  assert.equal(roleSet.has("franchise_owner"), true);
  assert.equal(roleSet.has("teacher"), true);
});

test("getHighestRole returns the highest privilege role", () => {
  const role = getHighestRole({
    organization_memberships: [{ role: "office_staff" }],
    school_memberships: [{ role: "school_manager" }]
  });

  assert.equal(role, "school_manager");
});

test("teacher navigation excludes administrative foundation pages", () => {
  const navigation = getVisibleNavigation({
    school_memberships: [{ role: "teacher" }]
  }).map((item) => item.href);

  assert.deepEqual(navigation, ["/dashboard/", "/students/", "/trial-lessons/"]);
});

test("teacher cannot create students through UI permissions", () => {
  assert.equal(canCreateStudents({ school_memberships: [{ role: "teacher" }] }), false);
  assert.equal(canCreateStudents({ organization_memberships: [{ role: "super_admin" }] }), true);
});

test("staff navigation is limited to administrative and school management roles", () => {
  const managerNavigation = getVisibleNavigation({
    school_memberships: [{ role: "school_manager" }]
  }).map((item) => item.href);
  const teacherNavigation = getVisibleNavigation({
    school_memberships: [{ role: "teacher" }]
  }).map((item) => item.href);

  assert.equal(managerNavigation.includes("/staff/"), true);
  assert.equal(teacherNavigation.includes("/staff/"), false);
  assert.equal(canManageStaff({ school_memberships: [{ role: "school_manager" }] }), true);
  assert.equal(canManageStaff({ school_memberships: [{ role: "teacher" }] }), false);
});

test("payroll navigation and UI permission are super-admin only", () => {
  const superAdminNavigation = getVisibleNavigation({
    organization_memberships: [{ role: "super_admin" }]
  }).map((item) => item.href);
  const managerNavigation = getVisibleNavigation({
    school_memberships: [{ role: "school_manager" }]
  }).map((item) => item.href);
  const teacherNavigation = getVisibleNavigation({
    school_memberships: [{ role: "teacher" }]
  }).map((item) => item.href);

  assert.equal(superAdminNavigation.includes("/payroll/"), true);
  assert.equal(managerNavigation.includes("/payroll/"), false);
  assert.equal(teacherNavigation.includes("/payroll/"), false);
  assert.equal(canManagePayroll({ organization_memberships: [{ role: "super_admin" }] }), true);
  assert.equal(canManagePayroll({ school_memberships: [{ role: "school_manager" }] }), false);
  assert.equal(canManagePayroll({ school_memberships: [{ role: "teacher" }] }), false);
});

test("billing navigation and UI permission are super-admin only", () => {
  const superAdminNavigation = getVisibleNavigation({
    organization_memberships: [{ role: "super_admin" }]
  }).map((item) => item.href);
  const managerNavigation = getVisibleNavigation({
    school_memberships: [{ role: "school_manager" }]
  }).map((item) => item.href);
  const teacherNavigation = getVisibleNavigation({
    school_memberships: [{ role: "teacher" }]
  }).map((item) => item.href);

  assert.equal(superAdminNavigation.includes("/billing/"), true);
  assert.equal(managerNavigation.includes("/billing/"), false);
  assert.equal(teacherNavigation.includes("/billing/"), false);
  assert.equal(canManageBilling({ organization_memberships: [{ role: "super_admin" }] }), true);
  assert.equal(canManageBilling({ school_memberships: [{ role: "school_manager" }] }), false);
  assert.equal(canManageBilling({ school_memberships: [{ role: "teacher" }] }), false);
});

test("expenses navigation and UI permission are super-admin only", () => {
  const superAdminNavigation = getVisibleNavigation({
    organization_memberships: [{ role: "super_admin" }]
  }).map((item) => item.href);
  const managerNavigation = getVisibleNavigation({
    school_memberships: [{ role: "school_manager" }]
  }).map((item) => item.href);
  const teacherNavigation = getVisibleNavigation({
    school_memberships: [{ role: "teacher" }]
  }).map((item) => item.href);

  assert.equal(superAdminNavigation.includes("/expenses/"), true);
  assert.equal(managerNavigation.includes("/expenses/"), false);
  assert.equal(teacherNavigation.includes("/expenses/"), false);
  assert.equal(canManageExpenses({ organization_memberships: [{ role: "super_admin" }] }), true);
  assert.equal(canManageExpenses({ school_memberships: [{ role: "school_manager" }] }), false);
  assert.equal(canManageExpenses({ school_memberships: [{ role: "teacher" }] }), false);
});

test("finance navigation and UI permission are super-admin only", () => {
  const superAdminNavigation = getVisibleNavigation({
    organization_memberships: [{ role: "super_admin" }]
  }).map((item) => item.href);
  const managerNavigation = getVisibleNavigation({
    school_memberships: [{ role: "school_manager" }]
  }).map((item) => item.href);
  const teacherNavigation = getVisibleNavigation({
    school_memberships: [{ role: "teacher" }]
  }).map((item) => item.href);

  assert.equal(superAdminNavigation.includes("/finance/"), true);
  assert.equal(managerNavigation.includes("/finance/"), false);
  assert.equal(teacherNavigation.includes("/finance/"), false);
  assert.equal(canManageFinance({ organization_memberships: [{ role: "super_admin" }] }), true);
  assert.equal(canManageFinance({ school_memberships: [{ role: "school_manager" }] }), false);
  assert.equal(canManageFinance({ school_memberships: [{ role: "teacher" }] }), false);
});

test("student selects pin ambiguous PostgREST relationships", () => {
  assert.match(studentListSelect, /schools:schools!students_school_id_organization_id_fkey/);
  assert.match(studentProfileSelect, /schools:schools!students_school_id_organization_id_fkey/);
  assert.match(recentStudentsSelect, /schools:schools!students_school_id_organization_id_fkey/);
  assert.match(studentListSelect, /student_enrollments:student_enrollments!student_enrollments_student_id_organization_id_school_id_fkey/);
  assert.match(studentListSelect, /classes:classes!student_enrollments_class_id_organization_id_school_id_fkey/);
  assert.match(studentProfileSelect, /assigned_teacher:profiles!classes_assigned_teacher_profile_id_fkey/);
  assert.match(studentProfileSelect, /student_notes:student_notes!student_notes_student_id_organization_id_school_id_fkey/);
});

test("class details use controlled shared values and compact formatting", () => {
  assert.deepEqual(
    lessonTypes.map((type) => type.value),
    ["group", "private"]
  );
  assert.deepEqual(
    lessonDays.map((day) => day.value),
    ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
  );
  assert.equal(formatLessonTime("16:30:00"), "16:30");
  assert.equal(
    formatClassSummary({
      classes: {
        lesson_type: "group",
        lesson_day: "monday",
        lesson_time: "16:30:00",
        class_levels: { label: "Elementary" }
      }
    }),
    "Elementary / Group / Monday 16:30"
  );
});

test("staff teacher migration separates HR identity from authorization roles", () => {
  const staffTable = staffTeachersSql.match(/create table if not exists public\.staff \([\s\S]*?\n\);/)?.[0] || "";
  const assignmentTable =
    staffTeachersSql.match(/create table if not exists public\.staff_school_assignments \([\s\S]*?\n\);/)?.[0] || "";
  const teacherOptions =
    staffTeachersSql.match(/create or replace function public\.school_teacher_options[\s\S]*?revoke all on function public\.school_teacher_options/)?.[0] ||
    "";

  assert.match(staffTable, /\bid uuid primary key/);
  assert.match(staffTable, /\borganization_id uuid not null/);
  assert.match(staffTable, /\bprofile_id uuid/);
  assert.match(staffTable, /\blegal_name text not null/);
  assert.match(staffTable, /\bdisplay_name text/);
  assert.match(staffTable, /\baddress text/);
  assert.match(staffTable, /\bphone text/);
  assert.match(staffTable, /\bemail citext/);
  assert.match(staffTable, /\bemployment_type text not null/);
  assert.match(staffTable, /\bemployment_start_date date/);
  assert.match(staffTable, /\bemployment_end_date date/);
  assert.match(staffTable, /\bstatus text not null/);
  assert.match(staffTable, /\bnotes text/);
  assert.doesNotMatch(staffTable, /my_number|payroll|billing/i);

  assert.match(assignmentTable, /\bstaff_id uuid not null/);
  assert.match(assignmentTable, /\bschool_id uuid not null/);
  assert.match(assignmentTable, /\bcan_teach boolean not null default false/);
  assert.match(assignmentTable, /unique \(staff_id, school_id\)/);
  assert.match(staffTeachersSql, /create unique index if not exists staff_organization_profile_id_uidx/);
  assert.match(staffTeachersSql, /create or replace function public\.can_manage_staff_org/);
  assert.match(staffTeachersSql, /create or replace function public\.has_active_staff_teacher_assignment/);
  assert.match(teacherOptions, /from public\.staff_school_assignments ssa/);
  assert.match(teacherOptions, /ssa\.can_teach = true/);
  assert.match(teacherOptions, /join public\.school_memberships sm/);
  assert.doesNotMatch(teacherOptions, /sm\.role = 'teacher'/);
  assert.match(staffTeachersSql, /public\.has_active_staff_teacher_assignment\(new\.school_id, new\.assigned_teacher_profile_id\)/);
  assert.match(staffTeachersSql, /notify pgrst, 'reload schema'/);
});

test("payroll foundation keeps compensation separate from staff and enables RLS", () => {
  for (const tableName of [
    "staff_compensation_terms",
    "payroll_periods",
    "payroll_entries",
    "payroll_payments"
  ]) {
    assert.match(payrollSql, new RegExp(`create table if not exists public\\.${tableName}`));
    assert.match(payrollSql, new RegExp(`alter table public\\.${tableName} enable row level security`));
    assert.match(payrollSql, new RegExp(`revoke all on public\\.${tableName} from anon, authenticated`));
  }

  assert.match(payrollSql, /\bstaff_id uuid not null/);
  assert.match(payrollSql, /\bcompensation_type text not null/);
  assert.match(payrollSql, /compensation_type in \('monthly_salary', 'per_lesson', 'hourly', 'manual', 'custom'\)/);
  assert.match(payrollSql, /\beffective_from date not null/);
  assert.match(payrollSql, /\beffective_to date/);
  assert.match(payrollSql, /\bpayroll_period_id uuid not null/);
  assert.match(payrollSql, /\bcompensation_term_id uuid/);
  assert.match(payrollSql, /\bbase_amount numeric\(12, 2\) not null default 0/);
  assert.match(payrollSql, /\badjustments_amount numeric\(12, 2\) not null default 0/);
  assert.match(payrollSql, /\bgross_amount numeric\(12, 2\) not null default 0/);
  assert.match(payrollSql, /\bdeductions_amount numeric\(12, 2\) not null default 0/);
  assert.match(payrollSql, /\bnet_payable numeric\(12, 2\) not null default 0/);
  assert.match(payrollSql, /Historical payroll calculation snapshots/);
  assert.match(payrollSql, /\bpayment_date date not null/);
  assert.match(payrollSql, /\bpayment_method text not null default 'bank_transfer'/);
  assert.match(payrollSql, /create or replace function public\.can_manage_payroll_org/);
  assert.match(payrollSql, /select public\.is_super_admin\(\)/);
  assert.match(payrollHelperGrantSql, /grant execute on function public\.validate_payroll_entry_scope\(public\.payroll_periods, public\.staff\) to authenticated/);
  assert.doesNotMatch(payrollHelperGrantSql, /to anon/);
  assert.match(payrollFoundationDoc, /separate restricted tax identity model/);
  assert.match(payrollFoundationDoc, /not as fields on profiles, staff, compensation terms, payroll periods, payroll entries, payroll payments/);
  assert.doesNotMatch(payrollSql, /my_number/i);
  assert.doesNotMatch(staffTeachersSql, /staff_compensation_terms|payroll_entries|payroll_payments/);
});

test("payroll data helpers pin relationships and use payroll RPCs", () => {
  const dataSource = readFileSync(new URL("../lib/data.js", import.meta.url), "utf8");

  assert.match(compensationTermSelect, /schools:schools!staff_compensation_terms_school_id_organization_id_fkey/);
  assert.match(compensationTermSelect, /staff:staff!staff_compensation_terms_staff_id_organization_id_fkey/);
  assert.match(payrollPeriodSelect, /organizations:organizations!payroll_periods_organization_id_fkey/);
  assert.match(payrollPeriodSelect, /schools:schools!payroll_periods_school_id_organization_id_fkey/);
  assert.match(payrollPeriodSelect, /payroll_entries:payroll_entries!payroll_entries_payroll_period_id_organization_id_fkey/);
  assert.match(payrollEntrySelect, /staff:staff!payroll_entries_staff_id_organization_id_fkey/);
  assert.match(payrollEntrySelect, /staff_compensation_terms:staff_compensation_terms!payroll_entries_compensation_term_id_organization_id_fkey/);
  assert.match(payrollEntrySelect, /payroll_payments:payroll_payments!payroll_payments_payroll_entry_id_organization_id_fkey/);
  assert.match(payrollPaymentSelect, /\bpayment_date\b/);

  for (const rpcName of [
    "create_staff_compensation_term_mvp",
    "create_payroll_period_mvp",
    "update_payroll_period_mvp",
    "create_payroll_entry_mvp",
    "update_payroll_entry_mvp",
    "record_payroll_payment_mvp"
  ]) {
    assert.match(dataSource, new RegExp(`rpc\\("${rpcName}"`));
  }
});

test("student billing foundation separates charges, payments, allocations, and refunds", () => {
  for (const tableName of [
    "student_charges",
    "student_payments",
    "student_payment_allocations",
    "student_refunds"
  ]) {
    assert.match(studentBillingSql, new RegExp(`create table if not exists public\\.${tableName}`));
    assert.match(studentBillingSql, new RegExp(`alter table public\\.${tableName} enable row level security`));
    assert.match(studentBillingSql, new RegExp(`revoke all on public\\.${tableName} from anon, authenticated`));
  }

  assert.match(studentBillingSql, /\bcharge_type text not null/);
  assert.match(studentBillingSql, /charge_type in \('tuition', 'entrance_fee', 'materials', 'trial_lesson', 'private_lesson', 'deposit', 'adjustment', 'other'\)/);
  assert.match(studentBillingSql, /\bpayment_method text not null default 'bank_transfer'/);
  assert.match(studentBillingSql, /payment_method in \('bank_transfer', 'bank_debit', 'cash', 'card', 'other'\)/);
  assert.match(studentBillingSql, /student_allocations_payment_scope_fkey/);
  assert.match(studentBillingSql, /student_allocations_charge_scope_fkey/);
  assert.match(studentBillingSql, /Allocation exceeds available payment balance/);
  assert.match(studentBillingSql, /Allocation exceeds remaining charge balance/);
  assert.match(studentBillingSql, /create or replace function public\.get_student_billing_summary_mvp/);
  assert.match(studentBillingSql, /\boutstanding_balance numeric/);
  assert.match(studentBillingSql, /\boverdue_balance numeric/);
  assert.match(studentBillingSql, /\bunallocated_payments numeric/);
  assert.match(studentBillingSql, /create or replace function public\.record_student_refund_mvp/);
  assert.match(studentBillingSql, /create or replace function public\.void_student_charge_mvp/);
  assert.match(studentBillingSql, /create or replace function public\.void_student_payment_mvp/);
  assert.match(studentBillingSql, /select public\.is_super_admin\(\)/);
  assert.match(studentBillingFoundationDoc, /Charges represent money owed/);
  assert.match(studentBillingFoundationDoc, /Payments represent actual money received/);
  assert.match(studentBillingFoundationDoc, /does not define Bee School pricing/);
  assert.match(studentBillingFoundationDoc, /Deposits are represented as ordinary student charges/);
  assert.doesNotMatch(studentBillingSql, /create table if not exists public\.payroll|staff_compensation_terms/);
});

test("student billing data helpers pin allocation relationships and use billing RPCs", () => {
  const dataSource = readFileSync(new URL("../lib/data.js", import.meta.url), "utf8");

  assert.match(billingStudentSummarySelect, /schools:schools!students_school_id_organization_id_fkey/);
  assert.match(studentChargeSelect, /students:students!student_charges_student_fkey/);
  assert.match(studentChargeSelect, /student_payment_allocations:student_payment_allocations!student_allocations_charge_scope_fkey/);
  assert.match(studentPaymentSelect, /students:students!student_payments_student_fkey/);
  assert.match(studentPaymentSelect, /student_payment_allocations:student_payment_allocations!student_allocations_payment_scope_fkey/);
  assert.match(studentPaymentSelect, /student_refunds:student_refunds!student_refunds_payment_scope_fkey/);
  assert.match(studentPaymentAllocationForChargeSelect, /student_payments:student_payments!student_allocations_payment_scope_fkey/);
  assert.match(studentPaymentAllocationForPaymentSelect, /student_charges:student_charges!student_allocations_charge_scope_fkey/);
  assert.match(studentRefundSelect, /student_payments:student_payments!student_refunds_payment_scope_fkey/);

  for (const rpcName of [
    "get_student_billing_summary_mvp",
    "create_student_charge_mvp",
    "record_student_payment_mvp",
    "allocate_student_payment_mvp",
    "record_student_refund_mvp"
  ]) {
    assert.match(dataSource, new RegExp(`rpc\\("${rpcName}"`));
  }
});

test("expense management foundation keeps operating expenses separate and enables RLS", () => {
  for (const tableName of ["expense_categories", "expenses"]) {
    assert.match(expenseManagementSql, new RegExp(`create table if not exists public\\.${tableName}`));
    assert.match(expenseManagementSql, new RegExp(`alter table public\\.${tableName} enable row level security`));
    assert.match(expenseManagementSql, new RegExp(`revoke all on public\\.${tableName} from anon, authenticated`));
  }

  for (const categoryCode of [
    "rent",
    "utilities",
    "internet_communications",
    "teaching_materials",
    "office_supplies",
    "furniture_equipment",
    "cleaning",
    "repairs_maintenance",
    "advertising_marketing",
    "software_subscriptions",
    "professional_fees",
    "bank_payment_fees",
    "transportation",
    "taxes_fees",
    "other"
  ]) {
    assert.match(expenseManagementSql, new RegExp(`'${categoryCode}'`));
  }

  assert.match(expenseManagementSql, /\bexpense_date date not null/);
  assert.match(expenseManagementSql, /\bcategory_id uuid not null/);
  assert.match(expenseManagementSql, /\bvendor text/);
  assert.match(expenseManagementSql, /\bamount numeric\(12, 2\) not null/);
  assert.match(expenseManagementSql, /\btax_amount numeric\(12, 2\)/);
  assert.match(expenseManagementSql, /\bpayment_method text not null default 'cash'/);
  assert.match(expenseManagementSql, /payment_method in \('cash', 'bank_transfer', 'bank_debit', 'card', 'other'\)/);
  assert.match(expenseManagementSql, /\breceipt_reference text/);
  assert.match(expenseManagementSql, /\breceipt_file_path text/);
  assert.match(expenseManagementSql, /\breceipt_original_name text/);
  assert.match(expenseManagementSql, /\bcreated_by uuid/);
  assert.match(expenseManagementSql, /\bvoided_by uuid/);
  assert.match(expenseManagementSql, /\bvoided_at timestamptz/);
  assert.match(expenseManagementSql, /\bvoid_reason text/);
  assert.match(expenseManagementSql, /status in \('active', 'void'\)/);
  assert.match(expenseManagementSql, /create or replace function public\.can_manage_expenses_org/);
  assert.match(expenseManagementSql, /select public\.is_super_admin\(\)/);
  assert.match(expenseManagementSql, /create or replace function public\.get_expense_summary_mvp/);
  assert.match(expenseManagementSql, /category_totals jsonb/);
  assert.match(expenseManagementSql, /school_totals jsonb/);
  assert.match(expenseManagementDoc, /Receipt upload is deferred/);
  assert.match(expenseManagementDoc, /does not store receipt blobs or arbitrary base64 data/);
  assert.doesNotMatch(expenseManagementSql, /bytea|base64|storage\.objects/);
  assert.doesNotMatch(expenseManagementSql, /create table if not exists public\.payroll|create table if not exists public\.student_charges/);
});

test("finance dashboard aggregation uses canonical financial sources only", () => {
  assert.match(financeDashboardSql, /create or replace function public\.can_manage_finance_org/);
  assert.match(financeDashboardSql, /om\.organization_id = p_organization_id/);
  assert.match(financeDashboardSql, /om\.role = 'super_admin'/);
  assert.match(financeDashboardSql, /create or replace function public\.get_finance_dashboard_mvp/);
  assert.match(financeDashboardSql, /\bp_organization_id uuid/);
  assert.match(financeDashboardSql, /\bp_school_id uuid default null/);

  for (const sourceTable of [
    "student_charges",
    "student_payments",
    "student_payment_allocations",
    "student_refunds",
    "payroll_periods",
    "payroll_entries",
    "payroll_payments",
    "expenses",
    "expense_categories"
  ]) {
    assert.match(financeDashboardSql, new RegExp(`public\\.${sourceTable}`));
  }

  assert.match(financeDashboardSql, /\bstudent_cash_received numeric/);
  assert.match(financeDashboardSql, /\bstudent_refunds numeric/);
  assert.match(financeDashboardSql, /\bnet_student_cash_revenue numeric/);
  assert.match(financeDashboardSql, /\boutstanding_receivables numeric/);
  assert.match(financeDashboardSql, /\boverdue_receivables numeric/);
  assert.match(financeDashboardSql, /\bunallocated_student_payments numeric/);
  assert.match(financeDashboardSql, /\bpayroll_accrued_net_payable numeric/);
  assert.match(financeDashboardSql, /\bpayroll_paid numeric/);
  assert.match(financeDashboardSql, /\boperating_expenses numeric/);
  assert.match(financeDashboardSql, /\bcash_operating_result numeric/);
  assert.match(financeDashboardSql, /\baccrual_operating_result numeric/);
  assert.match(financeDashboardSql, /sp\.status <> 'void'/);
  assert.match(financeDashboardSql, /sr\.status <> 'void'/);
  assert.match(financeDashboardSql, /sc\.status not in \('void', 'cancelled'\)/);
  assert.match(financeDashboardSql, /pe\.status <> 'void'/);
  assert.match(financeDashboardSql, /e\.status = 'active'/);
  assert.match(financeDashboardSql, /mr\.student_cash_received - mr\.student_refunds - mr\.payroll_paid - mr\.operating_expenses/);
  assert.match(financeDashboardSql, /mr\.student_service_period_charges - mr\.payroll_accrued_net_payable - mr\.operating_expenses/);
  assert.match(
    financeDashboardSql,
    /revoke all on function public\.get_finance_dashboard_mvp\(uuid, date, date, uuid, date\) from public, anon, authenticated/
  );
  assert.match(financeDashboardSql, /grant execute on function public\.get_finance_dashboard_mvp\(uuid, date, date, uuid, date\) to authenticated/);
  assert.match(financeDashboardSql, /notify pgrst, 'reload schema'/);
  assert.doesNotMatch(financeDashboardSql, /create table if not exists public\.(finance|ledger|general_ledger)/);
  assert.doesNotMatch(financeDashboardSql, /GMAIL|SECRET|Authorization|my_number/i);
});

test("expense data helpers pin relationships and use expense RPCs", () => {
  const dataSource = readFileSync(new URL("../lib/data.js", import.meta.url), "utf8");

  assert.match(expenseCategorySelect, /schools:schools!expense_categories_school_id_organization_id_fkey/);
  assert.match(expenseSelect, /schools:schools!expenses_school_id_organization_id_fkey/);
  assert.match(expenseSelect, /expense_categories:expense_categories!expenses_category_id_organization_id_fkey/);
  assert.match(expenseSelect, /created_by_profile:profiles!expenses_created_by_fkey/);
  assert.match(expenseSelect, /voided_by_profile:profiles!expenses_voided_by_fkey/);

  for (const rpcName of [
    "get_expense_summary_mvp",
    "create_expense_mvp",
    "update_expense_mvp",
    "void_expense_mvp"
  ]) {
    assert.match(dataSource, new RegExp(`rpc\\("${rpcName}"`));
  }
});

test("finance data helper uses the aggregate RPC only", () => {
  const dataSource = readFileSync(new URL("../lib/data.js", import.meta.url), "utf8");

  assert.equal(typeof fetchFinanceDashboardSummary, "function");
  assert.match(dataSource, /fetchFinanceDashboardSummary/);
  assert.match(dataSource, /rpc\("get_finance_dashboard_mvp"/);
  assert.match(dataSource, /p_organization_id: emptyToNull\(filters\.organizationId\)/);
  assert.match(dataSource, /p_date_from: emptyToNull\(filters\.dateFrom\)/);
  assert.match(dataSource, /p_date_to: emptyToNull\(filters\.dateTo\)/);
  assert.match(dataSource, /p_school_id: emptyToNull\(filters\.schoolId\)/);
});

test("staff helpers serialize school assignments without duplicating staff records", () => {
  const rows = buildStaffAssignmentRows(
    [
      { id: "school-1", name: "Ohashi", organization_id: "org-1", organizations: { name: "Bee School HQ" } },
      { id: "school-2", name: "Other", organization_id: "org-2", organizations: { name: "Other Org" } }
    ],
    {
      legal_name: "Pierre Malaval",
      staff_school_assignments: [
        {
          school_id: "school-1",
          can_teach: true,
          status: "active",
          start_date: "2026-08-28",
          end_date: null,
          schools: { name: "Ohashi" }
        }
      ]
    },
    "org-1"
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].assigned, true);
  assert.equal(rows[0].canTeach, true);
  assert.deepEqual(serializeStaffAssignments(rows), [
    {
      school_id: "school-1",
      can_teach: true,
      status: "active",
      start_date: "2026-08-28",
      end_date: null
    }
  ]);
  assert.equal(formatStaffName({ legal_name: "Pierre Malaval" }), "Pierre Malaval");
  assert.equal(formatStaffAssignmentSummary({ staff_school_assignments: rows.map((row) => ({ ...row, can_teach: row.canTeach, schools: { name: row.schoolName } })) }), "Ohashi (Teacher)");
  assert.equal(hasTeachingAssignment({ staff_school_assignments: [{ can_teach: true, status: "active" }] }), true);
  assert.equal(validateStaffForm({ organizationId: "org-1", legalName: "Pierre Malaval" }, rows), "");
});

test("payroll helpers validate terms, periods, entries, and payments", () => {
  assert.deepEqual(
    compensationTypes.map((type) => type.value),
    ["monthly_salary", "per_lesson", "hourly", "manual", "custom"]
  );
  assert.equal(defaultUnitForCompensationType("monthly_salary"), "month");
  assert.equal(defaultUnitForCompensationType("per_lesson"), "lesson");
  assert.equal(defaultUnitForCompensationType("hourly"), "hour");
  assert.equal(defaultUnitForCompensationType("custom"), "custom");

  const termForm = createCompensationTermForm(null, "staff-1");
  assert.equal(termForm.staffId, "staff-1");
  assert.equal(validateCompensationTermForm({ ...termForm, amount: "3000", effectiveFrom: "2026-04-01" }), "");
  assert.equal(validateCompensationTermForm({ ...termForm, amount: "-1", effectiveFrom: "2026-04-01" }), "Compensation amount must be zero or greater.");

  const periodForm = createPayrollPeriodForm(null, "org-1");
  assert.equal(periodForm.organizationId, "org-1");
  assert.equal(validatePayrollPeriodForm({ ...periodForm, periodStart: "2026-04-01", periodEnd: "2026-04-30" }), "");
  assert.equal(
    validatePayrollPeriodForm({ ...periodForm, scope: "school", schoolId: "", periodStart: "2026-04-01", periodEnd: "2026-04-30" }),
    "School payroll periods require a school."
  );

  const entryForm = createPayrollEntryForm(null, "period-1");
  assert.equal(entryForm.payrollPeriodId, "period-1");
  assert.equal(
    validatePayrollEntryForm({
      ...entryForm,
      staffId: "staff-1",
      baseAmount: "12000",
      adjustmentsAmount: "-500",
      grossAmount: "11500",
      deductionsAmount: "1000",
      netPayable: "10500"
    }),
    ""
  );

  const paymentForm = createPayrollPaymentForm({ id: "entry-1", net_payable: "10500" });
  assert.equal(paymentForm.payrollEntryId, "entry-1");
  assert.equal(validatePayrollPaymentForm({ ...paymentForm, amount: "10500" }), "");
  assert.equal(formatPayrollAmount("10500", "JPY"), "¥10,500");
  assert.equal(getPayrollEntryPaidTotal({ payroll_payments: [{ amount: "5000" }, { amount: "5500" }] }), 10500);
  assert.equal(getPayrollEntryPaymentStatus({ net_payable: "10500", status: "finalized", payroll_payments: [] }), "unpaid");
  assert.equal(
    getPayrollEntryPaymentStatus({ net_payable: "10500", status: "finalized", payroll_payments: [{ amount: "5000" }] }),
    "partial"
  );
  assert.equal(
    getPayrollEntryPaymentStatus({ net_payable: "10500", status: "paid", payroll_payments: [{ amount: "10500" }] }),
    "paid"
  );
});

test("student billing helpers validate forms and calculate balances", () => {
  assert.deepEqual(
    studentChargeTypes.map((type) => type.value),
    ["tuition", "entrance_fee", "materials", "trial_lesson", "private_lesson", "deposit", "adjustment", "other"]
  );
  assert.deepEqual(
    studentPaymentMethods.map((method) => method.value),
    ["bank_transfer", "bank_debit", "cash", "card", "other"]
  );

  const chargeForm = createStudentChargeForm("student-1");
  assert.equal(validateStudentChargeForm({ ...chargeForm, description: "September tuition", amount: "7000" }), "");
  assert.equal(
    validateStudentChargeForm({ ...chargeForm, chargeType: "tuition", description: "Credit", amount: "-1000" }),
    "Only adjustment charges may use negative amounts."
  );
  assert.equal(validateStudentChargeForm({ ...chargeForm, chargeType: "adjustment", description: "Credit", amount: "-1000" }), "");

  const paymentForm = createStudentPaymentForm("student-1");
  assert.equal(validateStudentPaymentForm({ ...paymentForm, amount: "3000" }), "");
  assert.equal(validateStudentPaymentForm({ ...paymentForm, amount: "0" }), "Payment amount must be greater than zero.");

  const allocationForm = createStudentPaymentAllocationForm("student-1", "payment-1", "charge-1");
  assert.equal(validateStudentPaymentAllocationForm({ ...allocationForm, amount: "3000" }), "");

  const refundForm = createStudentRefundForm("student-1", "payment-1");
  assert.equal(validateStudentRefundForm({ ...refundForm, amount: "500" }), "");
  assert.equal(formatBillingAmount("7000", "JPY"), "¥7,000");

  const partialCharge = {
    amount: "7000",
    student_payment_allocations: [{ amount: "3000" }]
  };
  assert.equal(getChargeAllocatedTotal(partialCharge), 3000);
  assert.equal(getChargeBalance(partialCharge), 4000);

  const paidCharge = {
    amount: "7000",
    student_payment_allocations: [{ amount: "3000" }, { amount: "4000" }]
  };
  assert.equal(getChargeBalance(paidCharge), 0);

  const splitPayment = {
    amount: "9000",
    student_payment_allocations: [{ amount: "4000" }, { amount: "3000" }],
    student_refunds: [{ amount: "500", status: "recorded" }]
  };
  assert.equal(getPaymentAllocatedTotal(splitPayment), 7000);
  assert.equal(getPaymentRefundTotal(splitPayment), 500);
  assert.equal(getPaymentUnallocatedBalance(splitPayment), 1500);

  const summary = getPrimaryBillingSummary([
    {
      currency: "JPY",
      outstanding_balance: "4000",
      overdue_balance: "4000",
      total_payments_allocated: "3000",
      unallocated_payments: "0"
    }
  ]);
  assert.equal(summary.outstanding_balance, "4000");
});

test("expense helpers validate forms and format summary totals", () => {
  assert.deepEqual(
    expensePaymentMethods.map((method) => method.value),
    ["cash", "bank_transfer", "bank_debit", "card", "other"]
  );
  assert.deepEqual(
    expenseStatuses.map((status) => status.value),
    ["active", "void"]
  );

  const form = createExpenseForm({ schoolId: "school-1", categoryId: "rent" });
  assert.equal(validateExpenseForm({ ...form, description: "Rent", amount: "100000", taxAmount: "10000" }), "");
  assert.equal(validateExpenseForm({ ...form, description: "Rent", amount: "0" }), "Expense amount must be greater than zero.");
  assert.equal(
    validateExpenseForm({ ...form, description: "Rent", amount: "1000", taxAmount: "2000" }),
    "Tax amount cannot exceed the expense amount."
  );
  assert.match(formatExpenseAmount("133000", "JPY"), /133,000/);

  const summary = getPrimaryExpenseSummary([
    {
      category_totals: [{ category_name: "Rent", amount: "100000" }],
      currency: "JPY",
      expense_count: 4,
      school_totals: [{ school_name: "Ohashi", amount: "133000" }],
      total_expenses: "133000",
      total_tax: "12100"
    }
  ]);
  assert.equal(summary.total_expenses, "133000");
  assert.equal(summary.category_totals[0].category_name, "Rent");
  assert.equal(isExpenseCategoryAvailableForSchool({ school_id: null, status: "active" }, "school-1"), true);
  assert.equal(isExpenseCategoryAvailableForSchool({ school_id: "school-2", status: "active" }, "school-1"), false);
  assert.equal(isExpenseCategoryAvailableForSchool({ school_id: null, status: "inactive" }, "school-1"), false);
});

test("finance helpers calculate date ranges, scope options, and result tone", () => {
  assert.deepEqual(
    financeDateRangePresets.map((preset) => preset.value),
    ["current_month", "previous_month", "current_year", "custom"]
  );
  assert.deepEqual(getFinanceDateRange("current_month", new Date(2026, 7, 28)), {
    dateFrom: "2026-08-01",
    dateTo: "2026-08-31"
  });
  assert.deepEqual(getFinanceDateRange("previous_month", new Date(2026, 0, 10)), {
    dateFrom: "2025-12-01",
    dateTo: "2025-12-31"
  });
  assert.deepEqual(getFinanceDateRange("current_year", new Date(2026, 7, 28)), {
    dateFrom: "2026-01-01",
    dateTo: "2026-12-31"
  });
  assert.deepEqual(getFinanceDateRange("current_month", new Date("2026-07-31T16:00:00Z"), "Asia/Tokyo"), {
    dateFrom: "2026-08-01",
    dateTo: "2026-08-31"
  });

  const summary = normalizeFinanceSummary({
    cash_operating_result: "60000",
    currency: "JPY",
    expense_category_totals: [{ category_name: "Rent", amount: "50000" }],
    net_student_cash_revenue: "190000",
    operating_expenses: "50000",
    payroll_paid: "80000",
    student_cash_received: "200000",
    student_refunds: "10000"
  });

  assert.equal(summary.student_cash_received, 200000);
  assert.equal(summary.student_refunds, 10000);
  assert.equal(summary.cash_operating_result, 60000);
  assert.equal(summary.expense_category_totals[0].category_name, "Rent");
  assert.equal(getPrimaryFinanceSummary([summary]).cash_operating_result, 60000);
  assert.equal(getFinanceResultTone(1), "positive");
  assert.equal(getFinanceResultTone(-1), "negative");
  assert.equal(getFinanceResultTone(0), "neutral");
  assert.match(formatFinanceAmount(10500, "JPY"), /10,500/);

  const organizations = [
    { id: "org-1", name: "Bee School" },
    { id: "org-2", name: "Other School" }
  ];
  const profile = {
    organization_memberships: [
      { organization_id: "org-1", role: "super_admin" },
      { organization_id: "org-2", role: "franchise_owner" }
    ]
  };
  assert.deepEqual(getFinanceOrganizationOptions(profile, organizations), [organizations[0]]);
  assert.deepEqual(
    getFinanceSchoolOptions(
      [
        { id: "school-1", organization_id: "org-1", status: "active" },
        { id: "school-2", organization_id: "org-2", status: "active" },
        { id: "school-3", organization_id: "org-1", status: "inactive" }
      ],
      "org-1"
    ).map((school) => school.id),
    ["school-1"]
  );
});

test("staff routes use the staff RPCs and do not expose payroll workflows", () => {
  assert.match(staffPage, /fetchStaffMembers/);
  assert.match(staffPage, /href="\/staff\/new\/"/);
  assert.match(staffNewPage, /createStaffMember/);
  assert.match(staffEditPage, /updateStaffMember/);
  assert.match(staffProfilePage, /School Assignments/);
  assert.match(staffProfilePage, /Linked Account/);
  assert.match(staffProfilePage, /canManagePayroll/);
  assert.match(staffProfilePage, /fetchStaffCompensationTerms/);
  assert.match(staffProfilePage, /Restricted Compensation History/);
  assert.doesNotMatch(`${staffPage}\n${staffNewPage}\n${staffEditPage}`, /Payroll|compensation|salary|Expenses|Billing|My Number/i);
  assert.doesNotMatch(staffProfilePage, /My Number/i);
});

test("payroll routes provide foundation workflows without unrelated finance modules", () => {
  const payrollRoutes = [
    payrollPage,
    payrollPeriodNewPage,
    payrollPeriodDetailPage,
    payrollEntryNewPage,
    payrollEntryEditPage,
    payrollPaymentNewPage
  ].join("\n");

  assert.match(payrollPage, /fetchPayrollPeriods/);
  assert.match(payrollPeriodNewPage, /createPayrollPeriod/);
  assert.match(payrollPeriodDetailPage, /updatePayrollPeriod/);
  assert.match(payrollPeriodDetailPage, /Staff Payroll Entries/);
  assert.match(payrollEntryNewPage, /createPayrollEntry/);
  assert.match(payrollEntryNewPage, /fetchStaffCompensationTerms/);
  assert.match(payrollEntryNewPage, /filterStaffForPeriod/);
  assert.match(payrollEntryEditPage, /updatePayrollEntry/);
  assert.match(payrollEntryEditPage, /Payment History/);
  assert.match(payrollPaymentNewPage, /recordPayrollPayment/);
  assert.match(payrollRoutes, /canManagePayroll/);
  assert.doesNotMatch(payrollRoutes, /Student Billing|Expenses|Finance Dashboard|createTrialLesson|create_trial_lesson/i);
});

test("student billing routes expose restricted billing workflows only", () => {
  const billingRoutes = [
    billingPage,
    billingChargeNewPage,
    billingPaymentNewPage,
    billingAllocationNewPage,
    billingRefundNewPage
  ].join("\n");

  assert.match(studentProfilePage, /canManageBilling/);
  assert.match(studentProfilePage, /fetchStudentBilling/);
  assert.match(studentProfilePage, /Billing \/ Payments/);
  assert.match(studentProfilePage, /Outstanding balance/);
  assert.match(studentProfilePage, /href=\{`\/billing\/charges\/new\/\?studentId=\$\{student\.id\}`\}/);
  assert.match(studentProfilePage, /href=\{`\/billing\/payments\/new\/\?studentId=\$\{student\.id\}`\}/);
  assert.match(studentProfilePage, /href=\{`\/billing\/allocations\/new\/\?studentId=\$\{student\.id\}`\}/);
  assert.match(studentProfilePage, /href=\{`\/billing\/refunds\/new\/\?studentId=\$\{student\.id\}`\}/);

  assert.match(billingPage, /fetchBillingManagement/);
  assert.match(billingPage, /Outstanding Students/);
  assert.match(billingPage, /Overdue Charges/);
  assert.match(billingPage, /Recent Payments/);
  assert.match(billingPage, /dateFrom/);
  assert.match(billingPage, /schoolId/);
  assert.match(billingPage, /status/);
  assert.match(billingPage, /paymentStatus/);
  assert.match(billingChargeNewPage, /createStudentCharge/);
  assert.match(billingPaymentNewPage, /recordStudentPayment/);
  assert.match(billingAllocationNewPage, /allocateStudentPayment/);
  assert.match(billingRefundNewPage, /recordStudentRefund/);
  assert.match(studentProfilePage, /BillingAllocationsList/);
  assert.match(billingRoutes, /canManageBilling/);
  assert.doesNotMatch(billingRoutes, /Payroll|Expenses|Finance Dashboard|createTrialLesson|create_trial_lesson/i);
});

test("expense routes provide foundation workflows without payroll, billing, or finance dashboard modules", () => {
  const expenseRoutes = [
    expensesPage,
    expenseNewPage,
    expenseDetailPage,
    expenseFormComponent
  ].join("\n");

  assert.match(expensesPage, /fetchExpenses/);
  assert.match(expensesPage, /fetchExpenseSummary/);
  assert.match(expensesPage, /fetchExpenseCategories/);
  assert.match(expensesPage, /dateFrom/);
  assert.match(expensesPage, /dateTo/);
  assert.match(expensesPage, /schoolId/);
  assert.match(expensesPage, /categoryId/);
  assert.match(expensesPage, /vendor/);
  assert.match(expensesPage, /paymentMethod/);
  assert.match(expensesPage, /status/);
  assert.match(expenseNewPage, /createExpense/);
  assert.match(expenseDetailPage, /updateExpense/);
  assert.match(expenseDetailPage, /voidExpense/);
  assert.match(expenseDetailPage, /VoidExpenseForm/);
  assert.match(expenseRoutes, /canManageExpenses/);
  assert.match(expenseFormComponent, /receiptReference/);
  assert.match(expenseFormComponent, /receiptFilePath/);
  assert.match(expenseFormComponent, /receiptOriginalName/);
  assert.doesNotMatch(expenseRoutes, /Finance Dashboard|createPayroll|recordPayroll|createStudentCharge|recordStudentPayment|createTrialLesson/i);
});

test("finance route presents aggregate overview and source-module drilldowns only", () => {
  assert.match(financePage, /fetchFinanceDashboardSummary/);
  assert.match(financePage, /fetchOrganizations/);
  assert.match(financePage, /fetchSchools/);
  assert.match(financePage, /canManageFinance/);
  assert.match(financePage, /financeDateRangePresets/);
  assert.match(financePage, /getFinanceOrganizationOptions/);
  assert.match(financePage, /getFinanceSchoolOptions/);
  assert.match(financePage, /Student cash received/);
  assert.match(financePage, /Refunds/);
  assert.match(financePage, /Net student revenue/);
  assert.match(financePage, /Outstanding receivables/);
  assert.match(financePage, /Overdue receivables/);
  assert.match(financePage, /Payroll paid/);
  assert.match(financePage, /Payroll payable/);
  assert.match(financePage, /Operating expenses/);
  assert.match(financePage, /Cash operating result/);
  assert.match(financePage, /Accrual view/);
  assert.match(financePage, /Expense Breakdown By Category/);
  assert.match(financePage, /href="\/billing\/"/);
  assert.match(financePage, /href="\/payroll\/"/);
  assert.match(financePage, /href="\/expenses\/"/);
  assert.doesNotMatch(
    financePage,
    /createStudentCharge|recordStudentPayment|allocateStudentPayment|recordStudentRefund|createPayroll|recordPayrollPayment|createExpense|updateExpense|voidExpense|createTrialLesson/i
  );
});

test("trial lessons use canonical status values and explicit relationship selects", () => {
  assert.deepEqual(
    trialLessonStatuses.map((status) => status.value),
    ["inquiry", "booked", "completed", "no_show", "cancelled", "joined", "did_not_join"]
  );
  assert.match(trialLessonSelect, /prospects:prospects!trial_lessons_prospect_id_organization_id_school_id_fkey/);
  assert.match(trialLessonSelect, /prospect_contacts:prospect_contacts!prospect_contacts_prospect_id_organization_id_school_id_fkey/);
  assert.match(
    trialLessonSelect,
    /trial_lesson_participants:trial_lesson_participants!trial_lesson_participants_trial_lesson_id_organization_id_schoo/
  );
});

test("trial lessons surface pending booking review and conversion through the atomic RPC", () => {
  assert.match(trialLessonsPage, /fetchPendingTrialBookingImportCount/);
  assert.match(trialLessonsPage, /href="\/trial-lessons\/imports\/"/);
  assert.match(pendingTrialBookingsPage, /fetchPendingTrialBookingImports/);
  assert.match(pendingTrialBookingsPage, /reviewStatus,?/);
  assert.match(pendingTrialBookingsPage, /href=\{`\/trial-lessons\/imports\/review\/\?id=\$\{pendingImport\.id\}`\}/);
  assert.match(pendingTrialBookingReviewPage, /updatePendingTrialBookingReview/);
  assert.match(pendingTrialBookingReviewPage, /convertPendingTrialBookingImport/);
  assert.match(pendingTrialBookingReviewPage, /fetchPendingTrialBookingProspectCandidates/);
  assert.match(pendingTrialBookingReviewPage, /Create Trial Lesson/);
  assert.doesNotMatch(pendingTrialBookingsPage, /createTrialLesson|create_trial_lesson_mvp|from\("trial_lessons"\)|from\("prospects"\)/);
  assert.doesNotMatch(pendingTrialBookingReviewPage, /from\("trial_lessons"\)|from\("prospects"\)|from\("prospect_contacts"\)/);
});

test("sidebar trial lessons badge reuses the pending review count", () => {
  assert.equal(formatCountBadgeValue(0), "");
  assert.equal(formatCountBadgeValue(null), "");
  assert.equal(formatCountBadgeValue(1), "1");
  assert.equal(formatCountBadgeValue(99), "99");
  assert.equal(formatCountBadgeValue(100), "99+");

  assert.match(adminShell, /fetchPendingTrialBookingImportCount/);
  assert.match(adminShell, /reviewStatus: "pending_review"/);
  assert.match(adminShell, /item\.href === "\/trial-lessons\/"/);
  assert.match(adminShell, /className="nav-count-badge"/);
  assert.match(adminShell, /\{badgeValue \? <span className="nav-count-badge">\{badgeValue\}<\/span> : null\}/);
});

test("pending booking count helper targets only pending review rows", () => {
  const dataSource = readFileSync(new URL("../lib/data.js", import.meta.url), "utf8");

  assert.match(dataSource, /fetchPendingTrialBookingImportCount/);
  assert.match(dataSource, /\.from\("pending_trial_booking_imports"\)/);
  assert.match(dataSource, /\.select\("id", \{ count: "exact", head: true \}\)/);
  assert.match(dataSource, /\.eq\("review_status", filters\.reviewStatus\)/);
});

test("Gmail Trial Booking cron health uses native cron and net histories safely", () => {
  assert.equal(typeof fetchGmailTrialBookingCronHealth, "function");
  assert.match(gmailTrialBookingCronHealthSql, /cron\.job_run_details/);
  assert.match(gmailTrialBookingCronHealthSql, /net\._http_response/);
  assert.match(gmailTrialBookingCronHealthSql, /bee-school-gmail-trial-booking-poll/);
  assert.match(gmailTrialBookingCronHealthSql, /minutes_since_last_success/);
  assert.match(gmailTrialBookingCronHealthSql, /public\.is_super_admin\(\)/);
  assert.match(gmailTrialBookingCronHealthSql, /school_manager/);
  assert.match(gmailTrialBookingCronHealthSql, /office_staff/);
  assert.match(
    gmailTrialBookingCronHealthSql,
    /revoke all on function public\.get_gmail_trial_booking_cron_health\(timestamptz\) from public, anon, authenticated/
  );
  assert.match(gmailTrialBookingCronHealthSql, /grant execute on function public\.get_gmail_trial_booking_cron_health\(timestamptz\) to authenticated/);
  assert.doesNotMatch(gmailTrialBookingCronHealthSql, /GMAIL_POLL_CRON_SECRET|Authorization|decrypted_secret|GMAIL_REFRESH_TOKEN/);
});

test("Gmail Trial Booking cron health thresholds drive alert visibility", () => {
  assert.equal(
    getGmailTrialBookingCronHealthStatus({
      lastSuccessAt: "2026-08-28T03:15:00Z",
      minutesSinceLastSuccess: 30,
      recentFailureCount: 0
    }),
    "healthy"
  );
  assert.equal(
    getGmailTrialBookingCronHealthStatus({
      lastSuccessAt: "2026-08-28T03:15:00Z",
      minutesSinceLastSuccess: 31,
      recentFailureCount: 0
    }),
    "warning"
  );
  assert.equal(
    getGmailTrialBookingCronHealthStatus({
      lastSuccessAt: "2026-08-28T03:15:00Z",
      minutesSinceLastSuccess: 46,
      recentFailureCount: 0
    }),
    "critical"
  );
  assert.equal(
    getGmailTrialBookingCronHealthStatus({
      lastSuccessAt: "2026-08-28T03:15:00Z",
      minutesSinceLastSuccess: 1,
      recentFailureCount: 1
    }),
    "warning"
  );
  assert.equal(
    getGmailTrialBookingCronHealthStatus({
      lastSuccessAt: "2026-08-28T03:15:00Z",
      minutesSinceLastSuccess: 1,
      recentFailureCount: 2
    }),
    "critical"
  );
  assert.equal(getGmailTrialBookingCronHealthStatus({ lastSuccessAt: null }), "critical");
  assert.equal(shouldShowGmailTrialBookingCronHealthAlert({ status: "healthy" }), false);
  assert.equal(shouldShowGmailTrialBookingCronHealthAlert({ status: "warning" }), true);
  assert.equal(shouldShowGmailTrialBookingCronHealthAlert({ status: "critical" }), true);
});

test("dashboard reads and displays unhealthy Gmail Trial Booking cron health only for managers", () => {
  assert.match(dashboardPage, /canManageTrialLessons/);
  assert.match(dashboardPage, /includeCronHealth: mayViewCronHealth/);
  assert.match(dashboardPage, /shouldShowGmailTrialBookingCronHealthAlert/);
  assert.match(dashboardPage, /Trial Booking email import may be delayed/);
  assert.match(dashboardPage, /role="alert"/);
});

test("pending booking review select and patch protect source metadata", () => {
  for (const column of [
    "source_mailbox",
    "gmail_message_id",
    "gmail_thread_id",
    "received_at",
    "sender",
    "subject",
    "booking_source",
    "trial_type",
    "course",
    "lesson_type",
    "raw_body",
    "parse_status",
    "parse_error",
    "review_status",
    "converted_trial_lesson_id",
    "converted_at",
    "converted_by"
  ]) {
    assert.match(pendingTrialBookingImportSelect, new RegExp(`\\b${column}\\b`));
  }

  const patch = buildPendingTrialBookingReviewPatch({
    organization_id: "wrong-org",
    school_id: "wrong-school",
    source_mailbox: "wrong@example.com",
    gmail_message_id: "wrong-message",
    raw_body: "do not overwrite",
    review_status: "dismissed",
    student_name: "  UTF8 Validation  ",
    email: "student@example.com",
    phone: "",
    student_age: "7",
    course: "小学生英会話",
    lesson_type: "グループレッスン",
    first_preferred_date: "2026-08-27T00:00:00.000Z",
    first_preferred_time: "18:30:00",
    second_preferred_date: "",
    second_preferred_time: "",
    customer_message: "  Please confirm.  "
  });

  assert.deepEqual(Object.keys(patch), pendingTrialBookingReviewEditableColumns);
  assert.equal(patch.student_name, "UTF8 Validation");
  assert.equal(patch.phone, null);
  assert.equal(patch.student_age, 7);
  assert.equal(patch.course, "小学生英会話");
  assert.equal(patch.lesson_type, "グループレッスン");
  assert.equal(patch.first_preferred_date, "2026-08-27");
  assert.equal(patch.first_preferred_time, "18:30");
  assert.equal(patch.review_status, "reviewed");
  assert.equal("gmail_message_id" in patch, false);
  assert.equal("source_mailbox" in patch, false);
  assert.equal("organization_id" in patch, false);
  assert.equal("school_id" in patch, false);
  assert.equal("raw_body" in patch, false);
});

test("pending booking conversion migration adds traceability and atomic conversion", () => {
  assert.match(pendingTrialBookingConversionSql, /add column if not exists converted_trial_lesson_id uuid/);
  assert.match(pendingTrialBookingConversionSql, /add column if not exists converted_at timestamptz/);
  assert.match(pendingTrialBookingConversionSql, /add column if not exists converted_by uuid/);
  assert.match(pendingTrialBookingConversionSql, /review_status in \('pending_review', 'reviewed', 'dismissed', 'converted'\)/);
  assert.match(pendingTrialBookingConversionSql, /pending_trial_booking_imports_converted_trial_lesson_id_fkey/);
  assert.match(pendingTrialBookingConversionSql, /create unique index if not exists pending_trial_booking_imports_converted_trial_lesson_id_k/);
  assert.match(pendingTrialBookingConversionSql, /create or replace function public\.create_trial_lesson_for_prospect_mvp/);
  assert.match(pendingTrialBookingConversionSql, /return public\.create_trial_lesson_for_prospect_mvp/);
  assert.match(pendingTrialBookingConversionSql, /create or replace function public\.convert_pending_trial_booking_import_to_trial_lesson/);
  assert.match(pendingTrialBookingConversionSql, /for update/);
  assert.match(pendingTrialBookingConversionSql, /Only reviewed pending bookings can be converted/);
  assert.match(pendingTrialBookingConversionSql, /Only successfully parsed pending bookings can be converted/);
  assert.match(pendingTrialBookingConversionSql, /v_import\.converted_trial_lesson_id is not null/);
  assert.match(pendingTrialBookingConversionSql, /review_status = 'converted'/);
  assert.match(pendingTrialBookingConversionSql, /converted_by = \(select auth\.uid\(\)\)/);
  assert.match(pendingTrialBookingConversionSql, /Imported course text is not mapped automatically/);
  assert.match(pendingTrialBookingConversionSql, /grant execute on function public\.convert_pending_trial_booking_import_to_trial_lesson/);
  assert.match(pendingTrialBookingConversionSql, /from public, anon/);
});

test("pending booking prospect candidates use normalized contacts and names", () => {
  const candidate = buildProspectCandidateMatch(
    {
      id: "prospect-1",
      japanese_name: "UTF8 Validation",
      prospect_contacts: [
        { contact_type: "email", value: "UTF8-Validation@Example.Invalid" },
        { contact_type: "phone", value: "090-0000-0000" }
      ]
    },
    {
      student_name: " utf8 validation ",
      email: "utf8-validation@example.invalid",
      phone: "09000000000"
    }
  );

  assert.deepEqual(candidate.matchReasons, ["email", "phone", "name"]);
  assert.equal(candidate.contactComparison.emailAlreadyPresent, true);
  assert.equal(candidate.contactComparison.phoneAlreadyPresent, true);
  assert.equal(normalizeImportedLessonType("グループレッスン"), "group");
  assert.equal(normalizeImportedLessonType("Private lesson"), "private");
  assert.equal(normalizeImportedLessonType("小学生英会話"), "");
});

test("trial participants serialize as relational rows", () => {
  const serialized = serializeParticipants([
    {
      japaneseName: "Yamada Taro",
      furigana: "Yamada Taro phonetic",
      alphabetName: "Taro Yamada",
      dateOfBirth: "",
      ageOverride: "7",
      ageGroupLevelId: "elementary",
      requestedLevelId: "eiken_grade_5"
    },
    {
      japaneseName: "Yamada Hanako",
      furigana: "",
      alphabetName: "",
      dateOfBirth: "2018-03-10",
      ageOverride: "99",
      ageGroupLevelId: "elementary",
      requestedLevelId: "elementary"
    }
  ]);

  assert.equal(serialized.length, 2);
  assert.equal(serialized[0].age_override, 7);
  assert.equal(serialized[1].date_of_birth, "2018-03-10");
});

test("trial lesson prospect intake excludes postal addresses", () => {
  const prospectSchema = trialLessonFoundationSql.match(/create table if not exists public\.prospects \([\s\S]*?\n\);/)?.[0] || "";
  const trialLessonSchema = trialLessonFoundationSql.match(/create table if not exists public\.trial_lessons \([\s\S]*?\n\);/)?.[0] || "";
  const participantSchema =
    trialLessonFoundationSql.match(/create table if not exists public\.trial_lesson_participants \([\s\S]*?\n\);/)?.[0] || "";

  assert.doesNotMatch(prospectSchema, /\b(address|postal|postcode|zip)\b/i);
  assert.doesNotMatch(trialLessonSchema, /\b(address|postal|postcode|zip)\b/i);
  assert.doesNotMatch(participantSchema, /\b(address|postal|postcode|zip)\b/i);
  assert.match(
    trialLessonFoundationSql,
    /constraint prospect_contacts_contact_type_check\s+check \(contact_type in \('email', 'phone'\)\)/
  );
  assert.doesNotMatch(trialLessonSelect, /\b(address|postal|postcode|zip)\b/i);
});

test("student date of birth stays on the profile surface and age is derived", () => {
  const referenceDate = new Date("2026-08-25T00:00:00");

  assert.match(studentProfileSelect, /date_of_birth/);
  assert.match(studentProfileSelect, /age_override/);
  assert.doesNotMatch(studentListSelect, /date_of_birth/);
  assert.doesNotMatch(recentStudentsSelect, /date_of_birth/);
  assert.equal(formatAgeFromDate("2015-04-12", referenceDate), "11 years");
  assert.equal(formatAgeFromDate("2015-12-01", referenceDate), "10 years");
  assert.equal(formatAgeFromDate("", referenceDate), "Not set");
  assert.equal(formatStudentAge({ date_of_birth: "2015-12-01", age_override: 99 }, referenceDate), "10 years");
  assert.equal(formatStudentAge({ date_of_birth: "", age_override: 8 }, referenceDate), "8 years");
  assert.equal(formatStudentAge({ date_of_birth: "", age_override: null }, referenceDate), "\u2014");
});

test("contact rows start with one primary email and phone", () => {
  const rows = createInitialContactRows();

  assert.equal(rows.emails.length, 1);
  assert.equal(rows.phones.length, 1);
  assert.equal(rows.emails[0].is_primary, true);
  assert.equal(rows.phones[0].is_primary, true);
});

test("contact rows allow adding and removing while preserving one row", () => {
  let rows = createInitialContactRows();
  rows = addContactRow(rows, "email");
  assert.equal(rows.emails.length, 2);

  rows = removeContactRow(rows, "email", rows.emails[1].id);
  assert.equal(rows.emails.length, 1);

  rows = removeContactRow(rows, "email", rows.emails[0].id);
  assert.equal(rows.emails.length, 1);
});

test("primary contact selection is exclusive within each contact type", () => {
  let rows = createInitialContactRows();
  rows = addContactRow(rows, "email");
  rows = addContactRow(rows, "phone");

  rows = markPrimaryContact(rows, "email", rows.emails[1].id);
  rows = markPrimaryContact(rows, "phone", rows.phones[1].id);

  assert.deepEqual(
    rows.emails.map((row) => row.is_primary),
    [false, true]
  );
  assert.deepEqual(
    rows.phones.map((row) => row.is_primary),
    [false, true]
  );
});

test("contact serialization keeps multiple values and one primary per type", () => {
  let rows = createInitialContactRows();
  rows = addContactRow(rows, "email");
  rows = addContactRow(rows, "phone");
  rows = updateContactRow(rows, "email", rows.emails[0].id, "value", "student@example.com");
  rows = updateContactRow(rows, "email", rows.emails[1].id, "value", "mother@example.com");
  rows = updateContactRow(rows, "email", rows.emails[1].id, "label", "Mother");
  rows = markPrimaryContact(rows, "email", rows.emails[1].id);
  rows = updateContactRow(rows, "phone", rows.phones[0].id, "value", "090-0000-0000");
  rows = updateContactRow(rows, "phone", rows.phones[1].id, "value", "080-0000-0000");

  const serialized = serializeContactRows(rows);

  assert.equal(serialized.length, 4);
  assert.equal(serialized.filter((contact) => contact.contact_type === "email" && contact.is_primary).length, 1);
  assert.equal(serialized.filter((contact) => contact.contact_type === "phone" && contact.is_primary).length, 1);
  assert.equal(serialized.find((contact) => contact.value === "mother@example.com").label, "Mother");
});

test("student contact records prefill the shared contact editor", () => {
  const rows = createContactRowsFromStudentContacts([
    { id: "email-1", contact_type: "email", label: "Mother", value: "mother@example.com", is_primary: true },
    { id: "phone-1", contact_type: "phone", label: "Mobile", value: "090-0000-0000", is_primary: false }
  ]);

  assert.equal(rows.emails.length, 1);
  assert.equal(rows.phones.length, 1);
  assert.equal(rows.emails[0].label, "Mother");
  assert.equal(rows.phones[0].is_primary, true);
});

test("student edit workflow is routed and backed by an atomic RPC", () => {
  assert.match(studentProfilePage, /href=\{`\/students\/edit\/\?id=\$\{student\.id\}`\}/);
  assert.match(studentEditPage, /updateStudent\(supabase/);
  assert.match(updateStudentSql, /create or replace function public\.update_student_mvp/);
  assert.match(updateStudentSql, /delete from public\.student_contacts/);
  assert.match(updateStudentSql, /delete from public\.student_guardians/);
  assert.match(updateStudentSql, /student_notes/);
  assert.match(updateStudentSql, /public\.can_manage_student\(p_student_id\)/);
  assert.match(updateStudentSql, /grant execute on function public\.update_student_mvp/);
});

test("student edit state preserves relational form values", () => {
  const editState = createStudentEditState({
    id: "student-1",
    first_name: "Taro",
    last_name: "Yamada",
    preferred_name: "Taro",
    school_id: "school-1",
    status: "active",
    date_of_birth: "",
    age_override: 8,
    student_contacts: [],
    student_guardians: [
      {
        id: "guardian-1",
        full_name: "Parent Yamada",
        relationship: "Mother",
        email: "parent@example.com",
        phone: "080-0000-0000",
        notes: "Pickup allowed"
      }
    ],
    student_notes: [{ id: "note-1", visibility: "admin", note: "Needs follow-up" }],
    student_enrollments: [
      {
        id: "enrollment-1",
        status: "active",
        classes: {
          id: "class-1",
          assigned_teacher_profile_id: "teacher-1",
          lesson_type: "group",
          level_id: "elementary",
          lesson_day: "monday",
          lesson_time: "16:30:00"
        }
      }
    ]
  });

  assert.equal(editState.form.ageOverride, "8");
  assert.equal(editState.form.assignedTeacherProfileId, "teacher-1");
  assert.equal(editState.form.lessonTime, "16:30");
  assert.equal(editState.guardians[0].notes, "Pickup allowed");
  assert.equal(editState.notes[0].noteId, "note-1");
  assert.equal(validateGuardianRows(editState.guardians), true);
  assert.deepEqual(serializeGuardianRows(editState.guardians)[0].full_name, "Parent Yamada");
  assert.deepEqual(serializeNoteRows(editState.notes)[0].id, "note-1");
});

test("converted trial lessons link by stored student id without redundant action text", () => {
  assert.match(trialLessonsPage, /className="convert-button"/);
  assert.doesNotMatch(trialLessonsPage, />\s*Converted\s*</);
  assert.match(trialLessonsPage, /const convertedParticipant = trialLesson\.trial_lesson_participants\?\.find/);
  assert.match(trialLessonsPage, /const linkedStudentId = trialLesson\.converted_student_id \|\| convertedParticipant\?\.converted_student_id/);
  assert.match(trialLessonsPage, /\{linkedStudentId \? \(/);
  assert.match(trialLessonsPage, /href=\{`\/students\/profile\/\?id=\$\{linkedStudentId\}`\}/);
  assert.match(trialLessonsPage, />\s*View student\s*</);
});
