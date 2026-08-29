export const compensationTypes = [
  { value: "monthly_salary", label: "Monthly salary" },
  { value: "per_lesson", label: "Per lesson" },
  { value: "hourly", label: "Hourly" },
  { value: "manual", label: "Manual/custom" },
  { value: "custom", label: "Custom" }
];

export const compensationUnits = [
  { value: "month", label: "Month" },
  { value: "lesson", label: "Lesson" },
  { value: "hour", label: "Hour" },
  { value: "manual", label: "Manual" },
  { value: "custom", label: "Custom" }
];

export const payrollPeriodStatuses = [
  { value: "draft", label: "Draft" },
  { value: "finalized", label: "Finalized" },
  { value: "paid", label: "Paid" }
];

export const payrollEntryStatuses = [
  { value: "draft", label: "Draft" },
  { value: "finalized", label: "Finalized" },
  { value: "paid", label: "Paid" },
  { value: "void", label: "Void" }
];

export const paymentMethods = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cash", label: "Cash" },
  { value: "manual", label: "Manual" },
  { value: "other", label: "Other" }
];

export function createCompensationTermForm(term = null, staffId = "") {
  return {
    staffId: term?.staff_id || staffId || "",
    schoolId: term?.school_id || "",
    compensationType: term?.compensation_type || "manual",
    amount: stringifyAmount(term?.amount),
    unit: term?.unit || defaultUnitForCompensationType(term?.compensation_type || "manual"),
    currency: term?.currency || "JPY",
    effectiveFrom: toDateInput(term?.effective_from),
    effectiveTo: toDateInput(term?.effective_to),
    notes: term?.notes || ""
  };
}

export function createPayrollPeriodForm(period = null, defaultOrganizationId = "") {
  return {
    organizationId: period?.organization_id || defaultOrganizationId || "",
    scope: period?.scope || "organization",
    schoolId: period?.school_id || "",
    periodStart: toDateInput(period?.period_start),
    periodEnd: toDateInput(period?.period_end),
    status: period?.status || "draft",
    notes: period?.notes || ""
  };
}

export function createPayrollEntryForm(entry = null, periodId = "") {
  return {
    payrollPeriodId: entry?.payroll_period_id || periodId || "",
    staffId: entry?.staff_id || "",
    compensationTermId: entry?.compensation_term_id || "",
    currency: entry?.currency || "JPY",
    baseAmount: stringifyAmount(entry?.base_amount),
    adjustmentsAmount: stringifyAmount(entry?.adjustments_amount),
    grossAmount: stringifyAmount(entry?.gross_amount),
    deductionsAmount: stringifyAmount(entry?.deductions_amount),
    netPayable: stringifyAmount(entry?.net_payable),
    status: entry?.status || "draft",
    notes: entry?.notes || ""
  };
}

export function createPayrollPaymentForm(entry = null) {
  return {
    payrollEntryId: entry?.id || "",
    paymentDate: new Date().toISOString().slice(0, 10),
    amount: stringifyAmount(entry?.net_payable),
    paymentMethod: "bank_transfer",
    reference: "",
    notes: ""
  };
}

export function defaultUnitForCompensationType(type) {
  if (type === "monthly_salary") return "month";
  if (type === "per_lesson") return "lesson";
  if (type === "hourly") return "hour";
  if (type === "custom") return "custom";
  return "manual";
}

export function validateCompensationTermForm(form) {
  if (!form.staffId) return "Staff member is required.";
  if (!form.compensationType) return "Compensation type is required.";
  if (!isNonNegativeAmount(form.amount)) return "Compensation amount must be zero or greater.";
  if (!form.unit) return "Unit is required.";
  if (!isCurrencyCode(form.currency)) return "Currency must be a three-letter code.";
  if (!form.effectiveFrom) return "Effective from date is required.";
  if (form.effectiveFrom && form.effectiveTo && form.effectiveTo < form.effectiveFrom) {
    return "Effective to date cannot be before effective from date.";
  }
  return "";
}

export function validatePayrollPeriodForm(form) {
  if (!form.organizationId) return "Organization is required.";
  if (form.scope === "school" && !form.schoolId) return "School payroll periods require a school.";
  if (form.scope === "organization" && form.schoolId) return "Organization payroll periods cannot include a school.";
  if (!form.periodStart || !form.periodEnd) return "Payroll period start and end dates are required.";
  if (form.periodEnd < form.periodStart) return "Payroll period end date cannot be before the start date.";
  return "";
}

export function validatePayrollEntryForm(form) {
  if (!form.payrollPeriodId) return "Payroll period is required.";
  if (!form.staffId) return "Staff member is required.";
  if (!isCurrencyCode(form.currency)) return "Currency must be a three-letter code.";
  if (!isNonNegativeAmount(form.baseAmount)) return "Base amount must be zero or greater.";
  if (!isAmount(form.adjustmentsAmount)) return "Adjustments must be a valid amount.";
  if (!isNonNegativeAmount(form.grossAmount)) return "Gross amount must be zero or greater.";
  if (!isNonNegativeAmount(form.deductionsAmount)) return "Deductions must be zero or greater.";
  if (!isNonNegativeAmount(form.netPayable)) return "Net payable must be zero or greater.";
  return "";
}

export function validatePayrollPaymentForm(form) {
  if (!form.payrollEntryId) return "Payroll entry is required.";
  if (!form.paymentDate) return "Payment date is required.";
  if (!isPositiveAmount(form.amount)) return "Payment amount must be greater than zero.";
  return "";
}

export function normalizePayrollAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  return String(value).trim();
}

export function formatPayrollAmount(value, currency = "JPY") {
  if (value === null || value === undefined || value === "") return "Not set";

  const amount = Number(value);
  if (!Number.isFinite(amount)) return "Not set";

  return new Intl.NumberFormat("en-US", {
    currency: currency || "JPY",
    maximumFractionDigits: currency === "JPY" ? 0 : 2,
    style: "currency"
  }).format(amount);
}

export function getPayrollEntryPaidTotal(entry) {
  return (entry?.payroll_payments || []).reduce((total, payment) => total + Number(payment.amount || 0), 0);
}

export function getPayrollEntryPaymentStatus(entry) {
  if (entry?.status === "void") return "void";

  const netPayable = Number(entry?.net_payable || 0);
  const paidTotal = getPayrollEntryPaidTotal(entry);
  if (netPayable > 0 && paidTotal >= netPayable) return "paid";
  if (paidTotal > 0) return "partial";
  return "unpaid";
}

function stringifyAmount(value) {
  return value === null || value === undefined ? "" : String(value);
}

function toDateInput(value) {
  return value ? String(value).slice(0, 10) : "";
}

function isCurrencyCode(value) {
  return /^[A-Za-z]{3}$/.test(String(value || "").trim());
}

function isAmount(value) {
  if (value === "" || value === null || value === undefined) return true;
  return Number.isFinite(Number(value));
}

function isNonNegativeAmount(value) {
  return isAmount(value) && Number(value || 0) >= 0;
}

function isPositiveAmount(value) {
  return isAmount(value) && Number(value || 0) > 0;
}
