import { serializeContactRows } from "./contacts.js";
import { normalizeGmailTrialBookingCronHealth } from "./cron-health.js";
import { normalizeBillingAmount } from "./billing.js";
import { normalizeExpenseAmount } from "./expenses.js";
import { normalizePayrollAmount } from "./payroll.js";
import { serializeStaffAssignments } from "./staff.js";
import { serializeGuardianRows, serializeNoteRows } from "./student-form.js";
import {
  buildStudentQuestionDatePatch,
  buildStudentQuestionDonePatch,
  buildStudentQuestionInsert,
  getTodayDateString,
  normalizeQuestionDate
} from "./student-questions.js";
import { buildPendingTrialBookingImport } from "./trial-booking-imports.js";
import { serializeParticipants } from "./trial-lessons.js";

export const studentListSelect = `
  id,
  first_name,
  last_name,
  preferred_name,
  status,
  start_date,
  age_override,
  schools:schools!students_school_id_organization_id_fkey (
    id,
    name
  ),
  student_enrollments:student_enrollments!student_enrollments_student_id_organization_id_school_id_fkey (
    id,
    status,
    level,
    class_name,
    classes:classes!student_enrollments_class_id_organization_id_school_id_fkey (
      id,
      assigned_teacher_profile_id,
      lesson_type,
      level_id,
      lesson_day,
      lesson_time,
      class_levels (
        id,
        label
      ),
      assigned_teacher:profiles!classes_assigned_teacher_profile_id_fkey (
        id,
        full_name,
        email
      )
    ),
    courses (
      id,
      name
    )
  )
`;

export const studentProfileSelect = `
  id,
  organization_id,
  school_id,
  first_name,
  last_name,
  preferred_name,
  status,
  start_date,
  date_of_birth,
  age_override,
  created_at,
  organizations:organizations!students_organization_id_fkey (
    id,
    name,
    type
  ),
  schools:schools!students_school_id_organization_id_fkey (
    id,
    name,
    status
  ),
  student_contacts (
    id,
    contact_type,
    label,
    value,
    is_primary,
    created_at
  ),
  student_guardians (
    id,
    full_name,
    relationship,
    email,
    phone,
    notes
  ),
  student_enrollments:student_enrollments!student_enrollments_student_id_organization_id_school_id_fkey (
    id,
    status,
    level,
    class_name,
    start_date,
    end_date,
    classes:classes!student_enrollments_class_id_organization_id_school_id_fkey (
      id,
      assigned_teacher_profile_id,
      lesson_type,
      level_id,
      lesson_day,
      lesson_time,
      class_levels (
        id,
        label
      ),
      assigned_teacher:profiles!classes_assigned_teacher_profile_id_fkey (
        id,
        full_name,
        email
      )
    ),
    courses (
      id,
      name
    )
  ),
  student_notes:student_notes!student_notes_student_id_organization_id_school_id_fkey (
    id,
    note,
    visibility,
    created_at,
    updated_at
  )
`;

export const recentStudentsSelect = `
  id,
  first_name,
  last_name,
  preferred_name,
  status,
  start_date,
  age_override,
  created_at,
  schools:schools!students_school_id_organization_id_fkey (
    id,
    name
  )
`;

export const trialLessonSelect = `
  id,
  organization_id,
  school_id,
  trial_date,
  trial_time,
  lesson_type,
  customer_request,
  internal_notes,
  status,
  converted_student_id,
  no_show_at,
  follow_up_due_at,
  automated_follow_up_sent_at,
  phone_follow_up_completed_at,
  follow_up_state,
  created_at,
  schools:schools!trial_lessons_school_id_organization_id_fkey (
    id,
    name
  ),
  prospects:prospects!trial_lessons_prospect_id_organization_id_school_id_fkey (
    id,
    japanese_name,
    furigana,
    alphabet_name,
    inquiry_methods (
      id,
      label
    ),
    acquisition_sources (
      id,
      label
    ),
    prospect_contacts:prospect_contacts!prospect_contacts_prospect_id_organization_id_school_id_fkey (
      id,
      contact_type,
      label,
      value,
      is_primary
    )
  ),
  class_levels (
    id,
    label
  ),
  assigned_teacher:profiles!trial_lessons_assigned_teacher_profile_id_fkey (
    id,
    full_name,
    email
  ),
  trial_lesson_participants:trial_lesson_participants!trial_lesson_participants_trial_lesson_id_organization_id_schoo (
    id,
    japanese_name,
    furigana,
    alphabet_name,
    date_of_birth,
    age_override,
    converted_student_id,
    age_group:class_levels!trial_lesson_participants_age_group_level_id_fkey (
      id,
      label
    ),
    requested_level:class_levels!trial_lesson_participants_requested_level_id_fkey (
      id,
      label
    )
  )
`;

export const communicationSelect = `
  id,
  organization_id,
  school_id,
  student_id,
  prospect_id,
  trial_lesson_id,
  communication_type,
  channel,
  recipient,
  subject,
  body,
  template_key,
  sent_at,
  sent_by,
  source,
  delivery_status,
  external_provider,
  external_message_id,
  error_message,
  created_at
`;

export const pendingTrialBookingImportSelect = `
  id,
  organization_id,
  school_id,
  source_type,
  source_mailbox,
  gmail_message_id,
  gmail_thread_id,
  received_at,
  sender,
  recipient,
  subject,
  booking_source,
  trial_type,
  student_name,
  email,
  phone,
  student_age,
  course,
  lesson_type,
  first_preferred_date,
  first_preferred_time,
  second_preferred_date,
  second_preferred_time,
  customer_message,
  raw_body,
  parse_status,
  parse_error,
  review_status,
  converted_trial_lesson_id,
  converted_at,
  converted_by,
  created_at,
  updated_at
`;

export const studentQuestionSelect = `
  id,
  organization_id,
  school_id,
  student_id,
  question,
  reminder_date,
  status,
  created_by,
  created_at,
  completed_at,
  updated_at,
  students:students!student_questions_student_id_organization_id_school_id_fkey (
    id,
    organization_id,
    school_id,
    first_name,
    last_name,
    preferred_name,
    status
  ),
  schools:schools!student_questions_school_id_organization_id_fkey (
    id,
    name,
    status
  )
`;

export const staffSelect = `
  id,
  organization_id,
  profile_id,
  legal_name,
  display_name,
  address,
  phone,
  email,
  employment_type,
  employment_start_date,
  employment_end_date,
  status,
  notes,
  created_at,
  updated_at,
  organizations:organizations!staff_organization_id_fkey (
    id,
    name,
    type,
    status
  ),
  profiles:profiles!staff_profile_id_fkey (
    id,
    email,
    full_name,
    status
  ),
  staff_school_assignments:staff_school_assignments!staff_school_assignments_staff_id_organization_id_fkey (
    id,
    organization_id,
    school_id,
    can_teach,
    status,
    start_date,
    end_date,
    schools:schools!staff_school_assignments_school_id_organization_id_fkey (
      id,
      name,
      status
    )
  )
`;

export const payrollPaymentSelect = `
  id,
  organization_id,
  payroll_entry_id,
  payment_date,
  amount,
  currency,
  payment_method,
  reference,
  notes,
  created_at,
  updated_at
`;

export const compensationTermSelect = `
  id,
  organization_id,
  school_id,
  staff_id,
  compensation_type,
  amount,
  unit,
  currency,
  effective_from,
  effective_to,
  notes,
  created_at,
  updated_at,
  schools:schools!staff_compensation_terms_school_id_organization_id_fkey (
    id,
    name,
    status
  ),
  staff:staff!staff_compensation_terms_staff_id_organization_id_fkey (
    id,
    legal_name,
    display_name,
    email
  )
`;

export const payrollEntrySelect = `
  id,
  organization_id,
  school_id,
  payroll_period_id,
  staff_id,
  compensation_term_id,
  compensation_type,
  compensation_amount,
  compensation_unit,
  currency,
  base_amount,
  adjustments_amount,
  gross_amount,
  deductions_amount,
  net_payable,
  status,
  notes,
  created_at,
  updated_at,
  staff:staff!payroll_entries_staff_id_organization_id_fkey (
    id,
    legal_name,
    display_name,
    email,
    profile_id
  ),
  staff_compensation_terms:staff_compensation_terms!payroll_entries_compensation_term_id_organization_id_fkey (
    id,
    compensation_type,
    amount,
    unit,
    currency,
    effective_from,
    effective_to
  ),
  payroll_payments:payroll_payments!payroll_payments_payroll_entry_id_organization_id_fkey (
    ${payrollPaymentSelect}
  )
`;

export const payrollPeriodSelect = `
  id,
  organization_id,
  school_id,
  scope,
  period_start,
  period_end,
  status,
  notes,
  created_at,
  updated_at,
  organizations:organizations!payroll_periods_organization_id_fkey (
    id,
    name,
    type,
    status
  ),
  schools:schools!payroll_periods_school_id_organization_id_fkey (
    id,
    name,
    status
  ),
  payroll_entries:payroll_entries!payroll_entries_payroll_period_id_organization_id_fkey (
    ${payrollEntrySelect}
  )
`;

export const billingStudentSummarySelect = `
  id,
  organization_id,
  school_id,
  first_name,
  last_name,
  preferred_name,
  status,
  schools:schools!students_school_id_organization_id_fkey (
    id,
    name,
    status
  )
`;

export const studentPaymentAllocationForChargeSelect = `
  id,
  organization_id,
  school_id,
  student_id,
  student_payment_id,
  student_charge_id,
  amount,
  currency,
  notes,
  created_at,
  updated_at,
  student_payments:student_payments!student_allocations_payment_scope_fkey (
    id,
    payment_date,
    amount,
    currency,
    payment_method,
    reference,
    status
  )
`;

export const studentPaymentAllocationForPaymentSelect = `
  id,
  organization_id,
  school_id,
  student_id,
  student_payment_id,
  student_charge_id,
  amount,
  currency,
  notes,
  created_at,
  updated_at,
  student_charges:student_charges!student_allocations_charge_scope_fkey (
    id,
    charge_type,
    description,
    amount,
    currency,
    due_date,
    status
  )
`;

export const studentRefundSelect = `
  id,
  organization_id,
  school_id,
  student_id,
  student_payment_id,
  refund_date,
  amount,
  currency,
  refund_method,
  reference,
  status,
  notes,
  created_at,
  updated_at,
  student_payments:student_payments!student_refunds_payment_scope_fkey (
    id,
    payment_date,
    amount,
    currency,
    payment_method,
    reference,
    status
  )
`;

export const studentChargeSelect = `
  id,
  organization_id,
  school_id,
  student_id,
  billing_period_start,
  billing_period_end,
  charge_type,
  description,
  amount,
  currency,
  due_date,
  status,
  source_type,
  source_id,
  notes,
  created_at,
  updated_at,
  students:students!student_charges_student_fkey (
    ${billingStudentSummarySelect}
  ),
  student_payment_allocations:student_payment_allocations!student_allocations_charge_scope_fkey (
    ${studentPaymentAllocationForChargeSelect}
  )
`;

export const studentPaymentSelect = `
  id,
  organization_id,
  school_id,
  student_id,
  payment_date,
  amount,
  currency,
  payment_method,
  reference,
  status,
  notes,
  created_at,
  updated_at,
  students:students!student_payments_student_fkey (
    ${billingStudentSummarySelect}
  ),
  student_payment_allocations:student_payment_allocations!student_allocations_payment_scope_fkey (
    ${studentPaymentAllocationForPaymentSelect}
  ),
  student_refunds:student_refunds!student_refunds_payment_scope_fkey (
    id,
    refund_date,
    amount,
    currency,
    refund_method,
    reference,
    status,
    notes,
    created_at
  )
`;

export const expenseCategorySelect = `
  id,
  organization_id,
  school_id,
  name,
  code,
  status,
  sort_order,
  created_at,
  updated_at,
  schools:schools!expense_categories_school_id_organization_id_fkey (
    id,
    name,
    status
  )
`;

export const expenseSelect = `
  id,
  organization_id,
  school_id,
  expense_date,
  category_id,
  vendor,
  description,
  amount,
  currency,
  tax_amount,
  payment_method,
  reference,
  receipt_reference,
  receipt_file_path,
  receipt_original_name,
  notes,
  status,
  created_by,
  voided_by,
  voided_at,
  void_reason,
  created_at,
  updated_at,
  schools:schools!expenses_school_id_organization_id_fkey (
    id,
    name,
    status
  ),
  expense_categories:expense_categories!expenses_category_id_organization_id_fkey (
    id,
    name,
    code,
    status
  ),
  created_by_profile:profiles!expenses_created_by_fkey (
    id,
    full_name,
    email
  ),
  voided_by_profile:profiles!expenses_voided_by_fkey (
    id,
    full_name,
    email
  )
`;

export const prospectCandidateSelect = `
  id,
  organization_id,
  school_id,
  japanese_name,
  furigana,
  alphabet_name,
  prospect_contacts:prospect_contacts!prospect_contacts_prospect_id_organization_id_school_id_fkey (
    id,
    contact_type,
    label,
    value,
    is_primary
  )
`;

export const pendingTrialBookingReviewEditableColumns = [
  "student_name",
  "email",
  "phone",
  "student_age",
  "course",
  "lesson_type",
  "first_preferred_date",
  "first_preferred_time",
  "second_preferred_date",
  "second_preferred_time",
  "customer_message",
  "review_status"
];

export async function fetchDashboardData(supabase, options = {}) {
  try {
    const [activeStudents, schools, staff, recentStudents, cronHealthResult] = await Promise.all([
      countRows(supabase, "students", { column: "status", value: "active" }),
      countRows(supabase, "schools", { column: "status", value: "active" }),
      countRows(supabase, "staff", { column: "status", value: "active" }),
      fetchRecentStudents(supabase),
      options.includeCronHealth
        ? fetchGmailTrialBookingCronHealth(supabase)
        : Promise.resolve({ data: null, error: null })
    ]);

    if (cronHealthResult.error) {
      throw cronHealthResult.error;
    }

    return {
      data: {
        metrics: {
          activeStudents,
          schools,
          staff
        },
        recentStudents,
        cronHealth: cronHealthResult.data
      },
      error: null
    };
  } catch (error) {
    return { data: null, error };
  }
}

export async function fetchGmailTrialBookingCronHealth(supabase) {
  const { data, error } = await supabase.rpc("get_gmail_trial_booking_cron_health");
  const row = Array.isArray(data) ? data[0] : data;

  return {
    data: normalizeGmailTrialBookingCronHealth(row),
    error
  };
}

export async function fetchFinanceDashboardSummary(supabase, filters = {}) {
  const { data, error } = await supabase.rpc("get_finance_dashboard_mvp", {
    p_organization_id: emptyToNull(filters.organizationId),
    p_date_from: emptyToNull(filters.dateFrom),
    p_date_to: emptyToNull(filters.dateTo),
    p_school_id: emptyToNull(filters.schoolId),
    p_as_of_date: emptyToNull(filters.asOfDate)
  });

  return { data: data || [], error };
}

export async function fetchStudents(supabase, search = "") {
  let query = supabase
    .from("students")
    .select(studentListSelect)
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true })
    .limit(100);

  const trimmed = search.trim();
  if (trimmed) {
    const term = `%${trimmed}%`;
    query = query.or(`first_name.ilike.${term},last_name.ilike.${term},preferred_name.ilike.${term},status.ilike.${term}`);
  }

  const { data, error } = await query;
  return { data, error };
}

export async function fetchStudentProfile(supabase, studentId) {
  const { data, error } = await supabase
    .from("students")
    .select(studentProfileSelect)
    .eq("id", studentId)
    .maybeSingle();

  return { data, error };
}

export async function fetchStudentCommunications(supabase, studentId) {
  const { data, error } = await supabase
    .from("communications")
    .select(communicationSelect)
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(12);

  return { data: data || [], error };
}

export async function fetchStudentQuestions(supabase, filters = {}) {
  let query = supabase
    .from("student_questions")
    .select(studentQuestionSelect)
    .order("reminder_date", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(filters.limit || 200);

  if (filters.studentId) {
    query = query.eq("student_id", filters.studentId);
  }

  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }

  const { data, error } = await query;
  return { data: data || [], error };
}

export async function fetchStudentQuestionBadgeCount(supabase, today = getTodayDateString()) {
  const { count, error } = await supabase
    .from("student_questions")
    .select("id", { count: "exact", head: true })
    .eq("status", "open")
    .lte("reminder_date", normalizeQuestionDate(today));

  return { count: count ?? 0, error };
}

export async function createStudentQuestion(supabase, input) {
  const row = buildStudentQuestionInsert(input);
  const { data, error } = await supabase
    .from("student_questions")
    .insert(row)
    .select(studentQuestionSelect)
    .maybeSingle();

  return { data, error, row };
}

export async function markStudentQuestionDone(supabase, questionId) {
  const patch = buildStudentQuestionDonePatch();
  const { data, error } = await supabase
    .from("student_questions")
    .update(patch)
    .eq("id", questionId)
    .select(studentQuestionSelect)
    .maybeSingle();

  return { data, error, patch };
}

export async function changeStudentQuestionDate(supabase, questionId, reminderDate) {
  const patch = buildStudentQuestionDatePatch(reminderDate);
  const { data, error } = await supabase
    .from("student_questions")
    .update(patch)
    .eq("id", questionId)
    .select(studentQuestionSelect)
    .maybeSingle();

  return { data, error, patch };
}

export async function deleteStudentQuestion(supabase, questionId) {
  const { data, error } = await supabase
    .from("student_questions")
    .delete()
    .eq("id", questionId)
    .select("id, student_id")
    .maybeSingle();

  return { data, error };
}

export async function fetchCommunications(supabase, filters = {}) {
  let query = supabase
    .from("communications")
    .select(communicationSelect)
    .order("created_at", { ascending: false })
    .limit(filters.limit || 200);

  if (filters.studentId) {
    query = query.eq("student_id", filters.studentId);
  }

  if (filters.prospectId) {
    query = query.eq("prospect_id", filters.prospectId);
  }

  if (filters.trialLessonId) {
    query = query.eq("trial_lesson_id", filters.trialLessonId);
  }

  const { data, error } = await query;
  return { data: data || [], error };
}

export async function fetchSchools(supabase) {
  const { data, error } = await supabase
    .from("schools")
    .select(
      `
        id,
        organization_id,
        name,
        status,
        created_at,
        organizations (
          id,
          name,
          type,
          status
        )
      `
    )
    .order("name", { ascending: true });

  return { data, error };
}

export async function fetchOrganizations(supabase) {
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, type, status")
    .order("name", { ascending: true });

  return { data, error };
}

export async function fetchProfilesForStaff(supabase) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, status")
    .order("full_name", { ascending: true, nullsFirst: false })
    .order("email", { ascending: true, nullsFirst: false });

  return { data, error };
}

export async function fetchClassLevels(supabase) {
  const { data, error } = await supabase
    .from("class_levels")
    .select("id, label")
    .eq("status", "active")
    .order("sort_order", { ascending: true });

  return { data, error };
}

export async function fetchInquiryMethods(supabase) {
  const { data, error } = await supabase
    .from("inquiry_methods")
    .select("id, label")
    .eq("status", "active")
    .order("sort_order", { ascending: true });

  return { data, error };
}

export async function fetchAcquisitionSources(supabase) {
  const { data, error } = await supabase
    .from("acquisition_sources")
    .select("id, label")
    .eq("status", "active")
    .order("sort_order", { ascending: true });

  return { data, error };
}

export async function fetchSchoolTeachers(supabase, schoolId) {
  const { data, error } = await supabase.rpc("school_teacher_options", {
    p_school_id: schoolId
  });

  return { data, error };
}

export async function fetchStaffMembers(supabase, search = "") {
  const { data, error } = await supabase
    .from("staff")
    .select(staffSelect)
    .order("display_name", { ascending: true, nullsFirst: false })
    .order("legal_name", { ascending: true })
    .limit(200);

  const trimmed = search.trim().toLowerCase();
  const filtered = trimmed
    ? (data || []).filter((staffMember) =>
        [
          staffMember.display_name,
          staffMember.legal_name,
          staffMember.email,
          staffMember.phone,
          staffMember.employment_type,
          staffMember.status,
          staffMember.profiles?.email,
          staffMember.profiles?.full_name,
          ...(staffMember.staff_school_assignments || []).map((assignment) => assignment.schools?.name)
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(trimmed))
      )
    : data;

  return { data: filtered || [], error };
}

export async function fetchStaffMember(supabase, staffId) {
  const { data, error } = await supabase
    .from("staff")
    .select(staffSelect)
    .eq("id", staffId)
    .maybeSingle();

  return { data, error };
}

export async function createStaffMember(supabase, input) {
  const { data, error } = await supabase.rpc("create_staff_member_mvp", {
    p_organization_id: input.organizationId,
    p_profile_id: emptyToNull(input.profileId),
    p_legal_name: input.legalName,
    p_display_name: emptyToNull(input.displayName),
    p_address: emptyToNull(input.address),
    p_phone: emptyToNull(input.phone),
    p_email: emptyToNull(input.email),
    p_employment_type: input.employmentType,
    p_employment_start_date: emptyToNull(input.employmentStartDate),
    p_employment_end_date: emptyToNull(input.employmentEndDate),
    p_status: input.status,
    p_notes: emptyToNull(input.notes),
    p_assignments: serializeStaffAssignments(input.assignments)
  });

  return { data, error };
}

export async function updateStaffMember(supabase, input) {
  const { data, error } = await supabase.rpc("update_staff_member_mvp", {
    p_staff_id: input.staffId,
    p_profile_id: emptyToNull(input.profileId),
    p_legal_name: input.legalName,
    p_display_name: emptyToNull(input.displayName),
    p_address: emptyToNull(input.address),
    p_phone: emptyToNull(input.phone),
    p_email: emptyToNull(input.email),
    p_employment_type: input.employmentType,
    p_employment_start_date: emptyToNull(input.employmentStartDate),
    p_employment_end_date: emptyToNull(input.employmentEndDate),
    p_status: input.status,
    p_notes: emptyToNull(input.notes),
    p_assignments: serializeStaffAssignments(input.assignments)
  });

  return { data, error };
}

export async function fetchStaffCompensationTerms(supabase, staffId) {
  const { data, error } = await supabase
    .from("staff_compensation_terms")
    .select(compensationTermSelect)
    .eq("staff_id", staffId)
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false });

  return { data: data || [], error };
}

export async function createStaffCompensationTerm(supabase, input) {
  const { data, error } = await supabase.rpc("create_staff_compensation_term_mvp", {
    p_staff_id: input.staffId,
    p_school_id: emptyToNull(input.schoolId),
    p_compensation_type: input.compensationType,
    p_amount: normalizePayrollAmount(input.amount),
    p_unit: input.unit,
    p_currency: emptyToNull(input.currency) || "JPY",
    p_effective_from: emptyToNull(input.effectiveFrom),
    p_effective_to: emptyToNull(input.effectiveTo),
    p_notes: emptyToNull(input.notes)
  });

  return { data, error };
}

export async function fetchPayrollPeriods(supabase) {
  const { data, error } = await supabase
    .from("payroll_periods")
    .select(payrollPeriodSelect)
    .order("period_start", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);

  return { data: data || [], error };
}

export async function fetchPayrollPeriod(supabase, payrollPeriodId) {
  const { data, error } = await supabase
    .from("payroll_periods")
    .select(payrollPeriodSelect)
    .eq("id", payrollPeriodId)
    .maybeSingle();

  return { data, error };
}

export async function createPayrollPeriod(supabase, input) {
  const { data, error } = await supabase.rpc("create_payroll_period_mvp", {
    p_organization_id: input.organizationId,
    p_scope: input.scope,
    p_school_id: emptyToNull(input.schoolId),
    p_period_start: emptyToNull(input.periodStart),
    p_period_end: emptyToNull(input.periodEnd),
    p_status: input.status,
    p_notes: emptyToNull(input.notes)
  });

  return { data, error };
}

export async function updatePayrollPeriod(supabase, input) {
  const { data, error } = await supabase.rpc("update_payroll_period_mvp", {
    p_payroll_period_id: input.payrollPeriodId,
    p_status: input.status,
    p_notes: emptyToNull(input.notes)
  });

  return { data, error };
}

export async function fetchPayrollEntry(supabase, payrollEntryId) {
  const { data, error } = await supabase
    .from("payroll_entries")
    .select(payrollEntrySelect)
    .eq("id", payrollEntryId)
    .maybeSingle();

  return { data, error };
}

export async function createPayrollEntry(supabase, input) {
  const { data, error } = await supabase.rpc("create_payroll_entry_mvp", {
    p_payroll_period_id: input.payrollPeriodId,
    p_staff_id: input.staffId,
    p_compensation_term_id: emptyToNull(input.compensationTermId),
    p_currency: emptyToNull(input.currency) || "JPY",
    p_base_amount: normalizePayrollAmount(input.baseAmount),
    p_adjustments_amount: normalizePayrollAmount(input.adjustmentsAmount),
    p_gross_amount: normalizePayrollAmount(input.grossAmount),
    p_deductions_amount: normalizePayrollAmount(input.deductionsAmount),
    p_net_payable: normalizePayrollAmount(input.netPayable),
    p_status: input.status,
    p_notes: emptyToNull(input.notes)
  });

  return { data, error };
}

export async function updatePayrollEntry(supabase, input) {
  const { data, error } = await supabase.rpc("update_payroll_entry_mvp", {
    p_payroll_entry_id: input.payrollEntryId,
    p_compensation_term_id: emptyToNull(input.compensationTermId),
    p_currency: emptyToNull(input.currency) || "JPY",
    p_base_amount: normalizePayrollAmount(input.baseAmount),
    p_adjustments_amount: normalizePayrollAmount(input.adjustmentsAmount),
    p_gross_amount: normalizePayrollAmount(input.grossAmount),
    p_deductions_amount: normalizePayrollAmount(input.deductionsAmount),
    p_net_payable: normalizePayrollAmount(input.netPayable),
    p_status: input.status,
    p_notes: emptyToNull(input.notes)
  });

  return { data, error };
}

export async function recordPayrollPayment(supabase, input) {
  const { data, error } = await supabase.rpc("record_payroll_payment_mvp", {
    p_payroll_entry_id: input.payrollEntryId,
    p_payment_date: emptyToNull(input.paymentDate),
    p_amount: normalizePayrollAmount(input.amount),
    p_payment_method: input.paymentMethod,
    p_reference: emptyToNull(input.reference),
    p_notes: emptyToNull(input.notes)
  });

  return { data, error };
}

export async function fetchStudentBillingSummary(supabase, studentId) {
  const { data, error } = await supabase.rpc("get_student_billing_summary_mvp", {
    p_student_id: studentId
  });

  return { data: data || [], error };
}

export async function fetchStudentBilling(supabase, studentId) {
  const [summaryResult, chargesResult, paymentsResult, refundsResult] = await Promise.all([
    fetchStudentBillingSummary(supabase, studentId),
    supabase
      .from("student_charges")
      .select(studentChargeSelect)
      .eq("student_id", studentId)
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("student_payments")
      .select(studentPaymentSelect)
      .eq("student_id", studentId)
      .order("payment_date", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("student_refunds")
      .select(studentRefundSelect)
      .eq("student_id", studentId)
      .order("refund_date", { ascending: false })
      .order("created_at", { ascending: false })
  ]);

  const error = [summaryResult.error, chargesResult.error, paymentsResult.error, refundsResult.error].filter(Boolean)[0] || null;

  return {
    data: {
      summary: summaryResult.data || [],
      charges: chargesResult.data || [],
      payments: paymentsResult.data || [],
      refunds: refundsResult.data || []
    },
    error
  };
}

export async function fetchBillingManagement(supabase, filters = {}) {
  let chargesQuery = supabase
    .from("student_charges")
    .select(studentChargeSelect)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(200);

  let paymentsQuery = supabase
    .from("student_payments")
    .select(studentPaymentSelect)
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);

  if (filters.schoolId) {
    chargesQuery = chargesQuery.eq("school_id", filters.schoolId);
    paymentsQuery = paymentsQuery.eq("school_id", filters.schoolId);
  }

  if (filters.status && filters.status !== "all") {
    chargesQuery = chargesQuery.eq("status", filters.status);
  }

  if (filters.paymentStatus && filters.paymentStatus !== "all") {
    paymentsQuery = paymentsQuery.eq("status", filters.paymentStatus);
  }

  if (filters.dateFrom) {
    chargesQuery = chargesQuery.gte("due_date", filters.dateFrom);
    paymentsQuery = paymentsQuery.gte("payment_date", filters.dateFrom);
  }

  if (filters.dateTo) {
    chargesQuery = chargesQuery.lte("due_date", filters.dateTo);
    paymentsQuery = paymentsQuery.lte("payment_date", filters.dateTo);
  }

  const [chargesResult, paymentsResult] = await Promise.all([chargesQuery, paymentsQuery]);
  const search = filters.search?.trim().toLowerCase();
  const charges = search ? filterBillingRows(chargesResult.data || [], search) : chargesResult.data || [];
  const payments = search ? filterBillingRows(paymentsResult.data || [], search) : paymentsResult.data || [];

  return {
    data: {
      charges,
      payments
    },
    error: [chargesResult.error, paymentsResult.error].filter(Boolean)[0] || null
  };
}

export async function createStudentCharge(supabase, input) {
  const { data, error } = await supabase.rpc("create_student_charge_mvp", {
    p_student_id: input.studentId,
    p_billing_period_start: emptyToNull(input.billingPeriodStart),
    p_billing_period_end: emptyToNull(input.billingPeriodEnd),
    p_charge_type: input.chargeType,
    p_description: input.description,
    p_amount: normalizeBillingAmount(input.amount),
    p_currency: emptyToNull(input.currency) || "JPY",
    p_due_date: emptyToNull(input.dueDate),
    p_status: input.status,
    p_source_type: emptyToNull(input.sourceType),
    p_source_id: emptyToNull(input.sourceId),
    p_notes: emptyToNull(input.notes)
  });

  return { data, error };
}

export async function recordStudentPayment(supabase, input) {
  const { data, error } = await supabase.rpc("record_student_payment_mvp", {
    p_student_id: input.studentId,
    p_payment_date: emptyToNull(input.paymentDate),
    p_amount: normalizeBillingAmount(input.amount),
    p_currency: emptyToNull(input.currency) || "JPY",
    p_payment_method: input.paymentMethod,
    p_reference: emptyToNull(input.reference),
    p_status: input.status,
    p_notes: emptyToNull(input.notes)
  });

  return { data, error };
}

export async function allocateStudentPayment(supabase, input) {
  const { data, error } = await supabase.rpc("allocate_student_payment_mvp", {
    p_student_payment_id: input.studentPaymentId,
    p_student_charge_id: input.studentChargeId,
    p_amount: normalizeBillingAmount(input.amount),
    p_notes: emptyToNull(input.notes)
  });

  return { data, error };
}

export async function recordStudentRefund(supabase, input) {
  const { data, error } = await supabase.rpc("record_student_refund_mvp", {
    p_student_id: input.studentId,
    p_student_payment_id: emptyToNull(input.studentPaymentId),
    p_refund_date: emptyToNull(input.refundDate),
    p_amount: normalizeBillingAmount(input.amount),
    p_currency: emptyToNull(input.currency) || "JPY",
    p_refund_method: input.refundMethod,
    p_reference: emptyToNull(input.reference),
    p_status: input.status,
    p_notes: emptyToNull(input.notes)
  });

  return { data, error };
}

export async function fetchExpenseCategories(supabase, filters = {}) {
  let query = supabase
    .from("expense_categories")
    .select(expenseCategorySelect)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }

  if (filters.schoolId) {
    query = query.or(`school_id.is.null,school_id.eq.${filters.schoolId}`);
  }

  const { data, error } = await query;
  return { data: data || [], error };
}

export async function fetchExpenseSummary(supabase, filters = {}) {
  const { data, error } = await supabase.rpc("get_expense_summary_mvp", {
    p_date_from: emptyToNull(filters.dateFrom),
    p_date_to: emptyToNull(filters.dateTo),
    p_school_id: emptyToNull(filters.schoolId),
    p_category_id: emptyToNull(filters.categoryId),
    p_vendor: emptyToNull(filters.vendor),
    p_payment_method: filters.paymentMethod && filters.paymentMethod !== "all" ? filters.paymentMethod : null,
    p_status: filters.status || "active"
  });

  return { data: data || [], error };
}

export async function fetchExpenses(supabase, filters = {}) {
  let query = supabase
    .from("expenses")
    .select(expenseSelect)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(filters.limit || 200);

  if (filters.schoolId) {
    query = query.eq("school_id", filters.schoolId);
  }

  if (filters.categoryId) {
    query = query.eq("category_id", filters.categoryId);
  }

  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }

  if (filters.paymentMethod && filters.paymentMethod !== "all") {
    query = query.eq("payment_method", filters.paymentMethod);
  }

  if (filters.vendor) {
    query = query.ilike("vendor", `%${filters.vendor}%`);
  }

  if (filters.dateFrom) {
    query = query.gte("expense_date", filters.dateFrom);
  }

  if (filters.dateTo) {
    query = query.lte("expense_date", filters.dateTo);
  }

  const { data, error } = await query;
  const search = filters.search?.trim().toLowerCase();
  const expenses = search ? filterExpenseRows(data || [], search) : data || [];

  return { data: expenses, error };
}

export async function fetchExpense(supabase, expenseId) {
  const { data, error } = await supabase
    .from("expenses")
    .select(expenseSelect)
    .eq("id", expenseId)
    .maybeSingle();

  return { data, error };
}

export async function createExpense(supabase, input) {
  const { data, error } = await supabase.rpc("create_expense_mvp", {
    p_school_id: input.schoolId,
    p_expense_date: emptyToNull(input.expenseDate),
    p_category_id: input.categoryId,
    p_vendor: emptyToNull(input.vendor),
    p_description: input.description,
    p_amount: normalizeExpenseAmount(input.amount),
    p_currency: emptyToNull(input.currency) || "JPY",
    p_tax_amount: normalizeExpenseAmount(input.taxAmount),
    p_payment_method: input.paymentMethod,
    p_reference: emptyToNull(input.reference),
    p_receipt_reference: emptyToNull(input.receiptReference),
    p_receipt_file_path: emptyToNull(input.receiptFilePath),
    p_receipt_original_name: emptyToNull(input.receiptOriginalName),
    p_notes: emptyToNull(input.notes)
  });

  return { data, error };
}

export async function updateExpense(supabase, input) {
  const { data, error } = await supabase.rpc("update_expense_mvp", {
    p_expense_id: input.expenseId,
    p_school_id: input.schoolId,
    p_expense_date: emptyToNull(input.expenseDate),
    p_category_id: input.categoryId,
    p_vendor: emptyToNull(input.vendor),
    p_description: input.description,
    p_amount: normalizeExpenseAmount(input.amount),
    p_currency: emptyToNull(input.currency) || "JPY",
    p_tax_amount: normalizeExpenseAmount(input.taxAmount),
    p_payment_method: input.paymentMethod,
    p_reference: emptyToNull(input.reference),
    p_receipt_reference: emptyToNull(input.receiptReference),
    p_receipt_file_path: emptyToNull(input.receiptFilePath),
    p_receipt_original_name: emptyToNull(input.receiptOriginalName),
    p_notes: emptyToNull(input.notes)
  });

  return { data, error };
}

export async function voidExpense(supabase, expenseId, voidReason = "") {
  const { data, error } = await supabase.rpc("void_expense_mvp", {
    p_expense_id: expenseId,
    p_void_reason: emptyToNull(voidReason)
  });

  return { data, error };
}

export async function fetchTrialLessons(supabase, filters = {}) {
  let query = supabase
    .from("trial_lessons")
    .select(trialLessonSelect)
    .order("trial_date", { ascending: true })
    .order("trial_time", { ascending: true })
    .limit(100);

  if (filters.scope === "needs_follow_up") {
    query = query
      .eq("status", "no_show")
      .is("phone_follow_up_completed_at", null)
      .in("follow_up_state", ["scheduled", "automated_email_queued", "automated_email_failed", "automated_email_sent"]);
  } else if (filters.status) {
    query = query.eq("status", filters.status);
  }

  if (filters.schoolId) {
    query = query.eq("school_id", filters.schoolId);
  }

  if (filters.teacherId) {
    query = query.eq("assigned_teacher_profile_id", filters.teacherId);
  }

  if (filters.scope === "upcoming") {
    query = query.gte("trial_date", new Date().toISOString().slice(0, 10));
  }

  const { data, error } = await query;
  const search = filters.search?.trim().toLowerCase();
  const filtered = search
    ? (data || []).filter((trialLesson) => {
        const prospect = trialLesson.prospects || {};
        const participants = trialLesson.trial_lesson_participants || [];
        return [
          prospect.japanese_name,
          prospect.furigana,
          prospect.alphabet_name,
          trialLesson.schools?.name,
          trialLesson.assigned_teacher?.full_name,
          trialLesson.assigned_teacher?.email,
          ...(prospect.prospect_contacts || []).map((contact) => contact.value),
          ...participants.flatMap((participant) => [
            participant.japanese_name,
            participant.furigana,
            participant.alphabet_name
          ])
        ]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(search));
      })
    : data;

  return { data: filtered || [], error };
}

export async function fetchPendingTrialBookingImportCount(supabase, filters = {}) {
  let query = supabase
    .from("pending_trial_booking_imports")
    .select("id", { count: "exact", head: true });

  if (filters.reviewStatus) {
    query = query.eq("review_status", filters.reviewStatus);
  }

  const { count, error } = await query;
  return { count: count ?? 0, error };
}

export async function fetchPendingTrialBookingImports(supabase, filters = {}) {
  let query = supabase
    .from("pending_trial_booking_imports")
    .select(pendingTrialBookingImportSelect)
    .order("received_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(100);

  if (filters.reviewStatus && filters.reviewStatus !== "all") {
    query = query.eq("review_status", filters.reviewStatus);
  }

  const { data, error } = await query;
  const search = filters.search?.trim().toLowerCase();
  const filtered = search
    ? (data || []).filter((booking) =>
        [
          booking.student_name,
          booking.course,
          booking.lesson_type,
          booking.email,
          booking.phone,
          booking.booking_source,
          booking.trial_type,
          booking.subject
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search))
      )
    : data;

  return { data: filtered || [], error };
}

export async function fetchPendingTrialBookingImport(supabase, pendingImportId) {
  const { data, error } = await supabase
    .from("pending_trial_booking_imports")
    .select(pendingTrialBookingImportSelect)
    .eq("id", pendingImportId)
    .maybeSingle();

  return { data, error };
}

export async function updatePendingTrialBookingReview(supabase, pendingImportId, input) {
  const patch = buildPendingTrialBookingReviewPatch(input);
  const { data, error } = await supabase
    .from("pending_trial_booking_imports")
    .update(patch)
    .eq("id", pendingImportId)
    .select(pendingTrialBookingImportSelect)
    .maybeSingle();

  return { data, error, patch };
}

export async function fetchPendingTrialBookingProspectCandidates(supabase, pendingImport) {
  if (!pendingImport?.organization_id || !pendingImport?.school_id) {
    return { data: [], error: null };
  }

  const { data, error } = await supabase
    .from("prospects")
    .select(prospectCandidateSelect)
    .eq("organization_id", pendingImport.organization_id)
    .eq("school_id", pendingImport.school_id)
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) return { data: [], error };

  return {
    data: (data || [])
      .map((prospect) => buildProspectCandidateMatch(prospect, pendingImport))
      .filter((candidate) => candidate.matchReasons.length > 0),
    error: null
  };
}

export async function convertPendingTrialBookingImport(supabase, input) {
  const { data, error } = await supabase.rpc("convert_pending_trial_booking_import_to_trial_lesson", {
    p_pending_import_id: input.pendingImportId,
    p_prospect_id: emptyToNull(input.prospectId),
    p_create_new_prospect: Boolean(input.createNewProspect),
    p_trial_date: emptyToNull(input.trialDate),
    p_trial_time: emptyToNull(input.trialTime),
    p_lesson_type: emptyToNull(input.lessonType),
    p_level_id: emptyToNull(input.levelId),
    p_assigned_teacher_profile_id: emptyToNull(input.assignedTeacherProfileId)
  });

  return { data, error };
}

export function normalizeImportedLessonType(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("private") || normalized.includes("プライベート")) return "private";
  if (normalized.includes("group") || normalized.includes("グループ")) return "group";
  return "";
}

export function buildPendingTrialBookingReviewPatch(input = {}) {
  return {
    student_name: emptyToNull(input.student_name),
    email: emptyToNull(input.email),
    phone: emptyToNull(input.phone),
    student_age: normalizeOptionalInteger(input.student_age),
    course: emptyToNull(input.course),
    lesson_type: emptyToNull(input.lesson_type),
    first_preferred_date: normalizeOptionalDate(input.first_preferred_date),
    first_preferred_time: normalizeOptionalTime(input.first_preferred_time),
    second_preferred_date: normalizeOptionalDate(input.second_preferred_date),
    second_preferred_time: normalizeOptionalTime(input.second_preferred_time),
    customer_message: emptyToNull(input.customer_message),
    review_status: "reviewed"
  };
}

export async function createTrialLesson(supabase, input) {
  const { data, error } = await supabase.rpc("create_trial_lesson_mvp", {
    p_school_id: input.schoolId,
    p_contact_japanese_name: input.contactJapaneseName,
    p_contact_furigana: emptyToNull(input.contactFurigana),
    p_contact_alphabet_name: emptyToNull(input.contactAlphabetName),
    p_contacts: serializeContactRows(input.contacts),
    p_inquiry_method_id: emptyToNull(input.inquiryMethodId),
    p_acquisition_source_id: emptyToNull(input.acquisitionSourceId),
    p_trial_date: emptyToNull(input.trialDate),
    p_trial_time: emptyToNull(input.trialTime),
    p_assigned_teacher_profile_id: emptyToNull(input.assignedTeacherProfileId),
    p_lesson_type: input.lessonType,
    p_level_id: emptyToNull(input.levelId),
    p_status: input.status,
    p_customer_request: emptyToNull(input.customerRequest),
    p_internal_notes: emptyToNull(input.internalNotes),
    p_participants: serializeParticipants(input.participants)
  });

  return { data, error };
}

export async function createPendingTrialBookingImport(supabase, input) {
  const row = buildPendingTrialBookingImport(input);

  if (!row.organization_id || !row.school_id || !row.source_mailbox || !row.gmail_message_id) {
    return {
      data: null,
      error: new Error(row.parse_error || "Pending trial booking import is missing required source metadata."),
      row
    };
  }

  const { data, error } = await supabase
    .from("pending_trial_booking_imports")
    .upsert(row, {
      onConflict: "source_mailbox,gmail_message_id",
      ignoreDuplicates: true
    })
    .select("id")
    .maybeSingle();

  return { data: data?.id || null, error, row };
}

export async function convertTrialLessonParticipant(supabase, trialLessonId, participantId) {
  const { data, error } = await supabase.rpc("convert_trial_lesson_participant_to_student", {
    p_trial_lesson_id: trialLessonId,
    p_participant_id: participantId
  });

  return { data, error };
}

export async function deleteTrialLesson(supabase, trialLessonId) {
  const { data, error } = await supabase.rpc("delete_trial_lesson_mvp", {
    p_trial_lesson_id: trialLessonId
  });

  return { data, error };
}

export async function confirmTrialLesson(supabase, input) {
  const { data, error } = await supabase.rpc("confirm_trial_lesson_mvp", {
    p_trial_lesson_id: input.trialLessonId,
    p_trial_date: emptyToNull(input.trialDate),
    p_trial_time: emptyToNull(input.trialTime),
    p_assigned_teacher_profile_id: emptyToNull(input.assignedTeacherProfileId)
  });

  return { data, error };
}

export async function queueCommunication(supabase, input) {
  const { data, error } = await supabase.rpc("queue_communication_mvp", {
    p_organization_id: input.organizationId,
    p_school_id: input.schoolId,
    p_student_id: emptyToNull(input.studentId),
    p_prospect_id: emptyToNull(input.prospectId),
    p_trial_lesson_id: emptyToNull(input.trialLessonId),
    p_communication_type: input.communicationType || "custom",
    p_channel: input.channel || "email",
    p_recipient: emptyToNull(input.recipient),
    p_subject: emptyToNull(input.subject),
    p_body: emptyToNull(input.body),
    p_template_key: emptyToNull(input.templateKey)
  });

  return { data, error };
}

export async function markTrialLessonPhoneFollowUpComplete(supabase, trialLessonId) {
  const { data, error } = await supabase.rpc("mark_trial_lesson_phone_follow_up_complete", {
    p_trial_lesson_id: trialLessonId
  });

  return { data, error };
}

export async function createStudent(supabase, input) {
  const { data, error } = await supabase.rpc("create_student_mvp", {
    p_school_id: input.schoolId,
    p_first_name: input.firstName,
    p_last_name: input.lastName,
    p_preferred_name: emptyToNull(input.preferredName),
    p_status: input.status,
    p_start_date: emptyToNull(input.startDate),
    p_date_of_birth: emptyToNull(input.dateOfBirth),
    p_age_override: normalizeAgeOverride(input.ageOverride),
    p_contacts: serializeContactRows(input.contacts),
    p_assigned_teacher_profile_id: emptyToNull(input.assignedTeacherProfileId),
    p_lesson_type: input.lessonType,
    p_class_level_id: emptyToNull(input.classLevelId),
    p_lesson_day: emptyToNull(input.lessonDay),
    p_lesson_time: emptyToNull(input.lessonTime),
    p_guardian_full_name: emptyToNull(input.guardianFullName),
    p_guardian_relationship: emptyToNull(input.guardianRelationship),
    p_guardian_email: emptyToNull(input.guardianEmail),
    p_guardian_phone: emptyToNull(input.guardianPhone),
    p_internal_note: emptyToNull(input.internalNote)
  });

  return { data, error };
}

export async function updateStudent(supabase, input) {
  const { data, error } = await supabase.rpc("update_student_mvp", {
    p_student_id: input.studentId,
    p_school_id: input.schoolId,
    p_first_name: input.firstName,
    p_last_name: input.lastName,
    p_preferred_name: emptyToNull(input.preferredName),
    p_status: input.status,
    p_start_date: emptyToNull(input.startDate),
    p_date_of_birth: emptyToNull(input.dateOfBirth),
    p_age_override: normalizeAgeOverride(input.ageOverride),
    p_contacts: serializeContactRows(input.contacts),
    p_assigned_teacher_profile_id: emptyToNull(input.assignedTeacherProfileId),
    p_lesson_type: input.lessonType,
    p_class_level_id: emptyToNull(input.classLevelId),
    p_lesson_day: emptyToNull(input.lessonDay),
    p_lesson_time: emptyToNull(input.lessonTime),
    p_guardians: serializeGuardianRows(input.guardians),
    p_notes: serializeNoteRows(input.notes)
  });

  return { data, error };
}

export async function fetchUsers(supabase) {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      `
        id,
        email,
        full_name,
        status,
        created_at,
        organization_memberships (
          id,
          role,
          organizations (
            id,
            name
          )
        ),
        school_memberships (
          id,
          role,
          schools (
            id,
            name
          )
        )
      `
    )
    .order("full_name", { ascending: true });

  return { data, error };
}

async function countRows(supabase, table, filter) {
  let query = supabase.from(table).select("id", { count: "exact", head: true });

  if (filter) {
    query = query.eq(filter.column, filter.value);
  }

  const { count, error } = await query;
  if (error) {
    throw error;
  }

  return count ?? 0;
}

async function fetchRecentStudents(supabase) {
  const { data, error } = await supabase
    .from("students")
    .select(recentStudentsSelect)
    .order("created_at", { ascending: false })
    .limit(6);

  if (error) {
    throw error;
  }

  return data || [];
}

function emptyToNull(value) {
  if (typeof value !== "string") {
    return value ?? null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeAgeOverride(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const age = Number(value);
  return Number.isInteger(age) ? age : value;
}

function normalizeOptionalInteger(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : value;
}

function normalizeOptionalDate(value) {
  const normalized = emptyToNull(value);
  return normalized ? String(normalized).slice(0, 10) : null;
}

function normalizeOptionalTime(value) {
  const normalized = emptyToNull(value);
  return normalized ? String(normalized).slice(0, 5) : null;
}

function filterBillingRows(rows, search) {
  return rows.filter((row) => {
    const student = row.students || {};
    return [
      row.description,
      row.charge_type,
      row.payment_method,
      row.reference,
      row.status,
      student.first_name,
      student.last_name,
      student.preferred_name,
      student.schools?.name
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(search));
  });
}

function filterExpenseRows(rows, search) {
  return rows.filter((row) =>
    [
      row.vendor,
      row.description,
      row.reference,
      row.payment_method,
      row.status,
      row.expense_categories?.name,
      row.expense_categories?.code,
      row.schools?.name
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(search))
  );
}

export function buildProspectCandidateMatch(prospect, pendingImport) {
  const contacts = prospect?.prospect_contacts || [];
  const prospectEmails = contacts.filter((contact) => contact.contact_type === "email").map((contact) => contact.value);
  const prospectPhones = contacts.filter((contact) => contact.contact_type === "phone").map((contact) => contact.value);
  const importEmail = normalizeEmail(pendingImport?.email);
  const importPhone = normalizePhone(pendingImport?.phone);
  const importName = normalizeName(pendingImport?.student_name);
  const matchReasons = [];

  if (importEmail && prospectEmails.some((email) => normalizeEmail(email) === importEmail)) {
    matchReasons.push("email");
  }

  if (importPhone && prospectPhones.some((phone) => normalizePhone(phone) === importPhone)) {
    matchReasons.push("phone");
  }

  if (importName && normalizeName(prospect?.japanese_name) === importName) {
    matchReasons.push("name");
  }

  return {
    ...prospect,
    matchReasons,
    contactComparison: {
      importEmail: pendingImport?.email || "",
      importPhone: pendingImport?.phone || "",
      prospectEmails,
      prospectPhones,
      emailAlreadyPresent: Boolean(importEmail && prospectEmails.some((email) => normalizeEmail(email) === importEmail)),
      phoneAlreadyPresent: Boolean(importPhone && prospectPhones.some((phone) => normalizePhone(phone) === importPhone))
    }
  };
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || "").replace(/\D+/g, "");
}

function normalizeName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}
