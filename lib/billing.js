export const studentChargeTypes = [
  { value: "tuition", label: "Tuition" },
  { value: "entrance_fee", label: "Entrance fee" },
  { value: "materials", label: "Materials" },
  { value: "trial_lesson", label: "Trial lesson" },
  { value: "private_lesson", label: "Private lesson" },
  { value: "deposit", label: "Deposit" },
  { value: "adjustment", label: "Adjustment" },
  { value: "other", label: "Other" }
];

export const studentChargeStatuses = [
  { value: "draft", label: "Draft" },
  { value: "open", label: "Open" },
  { value: "partially_paid", label: "Partially paid" },
  { value: "paid", label: "Paid" },
  { value: "void", label: "Void" },
  { value: "cancelled", label: "Cancelled" }
];

export const studentPaymentMethods = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "bank_debit", label: "Bank debit" },
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "other", label: "Other" }
];

export const studentPaymentStatuses = [
  { value: "received", label: "Received" },
  { value: "partial", label: "Partially allocated" },
  { value: "allocated", label: "Allocated" },
  { value: "refunded", label: "Refunded" },
  { value: "void", label: "Void" }
];

export const studentRefundMethods = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "other", label: "Other" }
];

export function createStudentChargeForm(studentId = "", defaults = {}) {
  return {
    studentId,
    billingPeriodStart: defaults.billingPeriodStart || "",
    billingPeriodEnd: defaults.billingPeriodEnd || "",
    chargeType: defaults.chargeType || "tuition",
    description: defaults.description || "",
    amount: stringifyAmount(defaults.amount),
    currency: defaults.currency || "JPY",
    dueDate: defaults.dueDate || "",
    status: defaults.status || "open",
    sourceType: defaults.sourceType || "",
    sourceId: defaults.sourceId || "",
    notes: defaults.notes || ""
  };
}

export function createStudentPaymentForm(studentId = "") {
  return {
    studentId,
    paymentDate: new Date().toISOString().slice(0, 10),
    amount: "",
    currency: "JPY",
    paymentMethod: "bank_transfer",
    reference: "",
    status: "received",
    notes: ""
  };
}

export function createStudentPaymentAllocationForm(studentId = "", paymentId = "", chargeId = "") {
  return {
    studentId,
    studentPaymentId: paymentId,
    studentChargeId: chargeId,
    amount: "",
    notes: ""
  };
}

export function createStudentRefundForm(studentId = "", paymentId = "") {
  return {
    studentId,
    studentPaymentId: paymentId,
    refundDate: new Date().toISOString().slice(0, 10),
    amount: "",
    currency: "JPY",
    refundMethod: "bank_transfer",
    reference: "",
    status: "recorded",
    notes: ""
  };
}

export function validateStudentChargeForm(form) {
  if (!form.studentId) return "Student is required.";
  if (!form.chargeType) return "Charge type is required.";
  if (!form.description.trim()) return "Charge description is required.";
  if (!isAmount(form.amount)) return "Charge amount must be a valid amount.";
  if (Number(form.amount || 0) < 0 && form.chargeType !== "adjustment") {
    return "Only adjustment charges may use negative amounts.";
  }
  if (!isCurrencyCode(form.currency)) return "Currency must be a three-letter code.";
  if (form.billingPeriodStart && form.billingPeriodEnd && form.billingPeriodEnd < form.billingPeriodStart) {
    return "Billing period end cannot be before billing period start.";
  }
  return "";
}

export function validateStudentPaymentForm(form) {
  if (!form.studentId) return "Student is required.";
  if (!form.paymentDate) return "Payment date is required.";
  if (!isPositiveAmount(form.amount)) return "Payment amount must be greater than zero.";
  if (!isCurrencyCode(form.currency)) return "Currency must be a three-letter code.";
  return "";
}

export function validateStudentPaymentAllocationForm(form) {
  if (!form.studentPaymentId) return "Payment is required.";
  if (!form.studentChargeId) return "Charge is required.";
  if (!isPositiveAmount(form.amount)) return "Allocation amount must be greater than zero.";
  return "";
}

export function validateStudentRefundForm(form) {
  if (!form.studentId) return "Student is required.";
  if (!form.refundDate) return "Refund date is required.";
  if (!isPositiveAmount(form.amount)) return "Refund amount must be greater than zero.";
  if (!isCurrencyCode(form.currency)) return "Currency must be a three-letter code.";
  return "";
}

export function normalizeBillingAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  return String(value).trim();
}

export function formatBillingAmount(value, currency = "JPY") {
  if (value === null || value === undefined || value === "") return "Not set";

  const amount = Number(value);
  if (!Number.isFinite(amount)) return "Not set";

  return new Intl.NumberFormat("en-US", {
    currency: currency || "JPY",
    maximumFractionDigits: currency === "JPY" ? 0 : 2,
    style: "currency"
  }).format(amount);
}

export function getChargeAllocatedTotal(charge) {
  return (charge?.student_payment_allocations || []).reduce((total, allocation) => total + Number(allocation.amount || 0), 0);
}

export function getChargeBalance(charge) {
  return Number(charge?.amount || 0) - getChargeAllocatedTotal(charge);
}

export function getPaymentAllocatedTotal(payment) {
  return (payment?.student_payment_allocations || []).reduce((total, allocation) => total + Number(allocation.amount || 0), 0);
}

export function getPaymentRefundTotal(payment) {
  return (payment?.student_refunds || []).reduce((total, refund) => {
    if (refund.status === "void") return total;
    return total + Number(refund.amount || 0);
  }, 0);
}

export function getPaymentUnallocatedBalance(payment) {
  return Number(payment?.amount || 0) - getPaymentAllocatedTotal(payment) - getPaymentRefundTotal(payment);
}

export function getPrimaryBillingSummary(summaryRows = []) {
  return (
    summaryRows.find((summary) => summary.currency === "JPY") ||
    summaryRows[0] || {
      currency: "JPY",
      total_charges: 0,
      total_payments_allocated: 0,
      outstanding_balance: 0,
      overdue_balance: 0,
      unallocated_payments: 0,
      refunds_total: 0
    }
  );
}

function stringifyAmount(value) {
  return value === null || value === undefined ? "" : String(value);
}

function isCurrencyCode(value) {
  return /^[A-Za-z]{3}$/.test(String(value || "").trim());
}

function isAmount(value) {
  if (value === "" || value === null || value === undefined) return false;
  return Number.isFinite(Number(value));
}

function isPositiveAmount(value) {
  return isAmount(value) && Number(value) > 0;
}
