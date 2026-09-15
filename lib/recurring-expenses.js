export const recurringExpenseRecurrences = [
  { value: "one_time", label: "One-time" },
  { value: "monthly", label: "Monthly" }
];

export const recurringExpenseStatuses = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" }
];

export function createRecurringExpenseTemplateForm(defaults = {}) {
  return {
    schoolId: defaults.schoolId || defaults.school_id || "",
    categoryId: defaults.categoryId || defaults.category_id || "",
    name: defaults.name || "",
    vendor: defaults.vendor || "",
    amount: stringifyAmount(defaults.amount),
    currency: defaults.currency || "JPY",
    taxAmount: stringifyAmount(defaults.taxAmount ?? defaults.tax_amount),
    paymentMethod: defaults.paymentMethod || defaults.payment_method || "bank_transfer",
    recurrence: defaults.recurrence || "monthly",
    startDate: normalizeDate(defaults.startDate || defaults.start_date) || getCurrentDateString(),
    endDate: normalizeDate(defaults.endDate || defaults.end_date),
    notes: defaults.notes || "",
    status: defaults.status || "active"
  };
}

export function validateRecurringExpenseTemplateForm(form) {
  if (!form.schoolId) return "School is required.";
  if (!form.categoryId) return "Expense category is required.";
  if (!normalizeText(form.name)) return "Expense name is required.";
  if (!isPositiveAmount(form.amount)) return "Amount must be greater than zero.";
  if (!/^[A-Za-z]{3}$/.test(String(form.currency || "").trim())) return "Currency must be a three-letter code.";
  if (form.taxAmount !== "" && (!isAmount(form.taxAmount) || Number(form.taxAmount) < 0)) {
    return "Tax amount must be zero or greater.";
  }
  if (form.taxAmount !== "" && Number(form.taxAmount) > Number(form.amount)) {
    return "Tax amount cannot exceed the expense amount.";
  }
  if (!recurringExpenseRecurrences.some((recurrence) => recurrence.value === form.recurrence)) {
    return "Recurrence is required.";
  }
  if (!normalizeDate(form.startDate)) return "Start date is required.";
  if (form.endDate && normalizeDate(form.endDate) < normalizeDate(form.startDate)) {
    return "End date cannot be before start date.";
  }
  return "";
}

export function getMonthStartDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

function getCurrentDateString() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeDate(value) {
  const normalized = normalizeText(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function stringifyAmount(value) {
  return value === null || value === undefined ? "" : String(value);
}

function isAmount(value) {
  if (value === "" || value === null || value === undefined) return false;
  return Number.isFinite(Number(value));
}

function isPositiveAmount(value) {
  return isAmount(value) && Number(value) > 0;
}
