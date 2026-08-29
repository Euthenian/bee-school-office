export const expensePaymentMethods = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "bank_debit", label: "Bank debit" },
  { value: "card", label: "Card" },
  { value: "other", label: "Other" }
];

export const expenseStatuses = [
  { value: "active", label: "Active" },
  { value: "void", label: "Void" }
];

export function createExpenseForm(defaults = {}) {
  return {
    schoolId: defaults.schoolId || defaults.school_id || "",
    expenseDate: defaults.expenseDate || defaults.expense_date || new Date().toISOString().slice(0, 10),
    categoryId: defaults.categoryId || defaults.category_id || "",
    vendor: defaults.vendor || "",
    description: defaults.description || "",
    amount: stringifyAmount(defaults.amount),
    currency: defaults.currency || "JPY",
    taxAmount: stringifyAmount(defaults.taxAmount ?? defaults.tax_amount),
    paymentMethod: defaults.paymentMethod || defaults.payment_method || "cash",
    reference: defaults.reference || "",
    receiptReference: defaults.receiptReference || defaults.receipt_reference || "",
    receiptFilePath: defaults.receiptFilePath || defaults.receipt_file_path || "",
    receiptOriginalName: defaults.receiptOriginalName || defaults.receipt_original_name || "",
    notes: defaults.notes || ""
  };
}

export function validateExpenseForm(form) {
  if (!form.schoolId) return "School is required.";
  if (!form.expenseDate) return "Expense date is required.";
  if (!form.categoryId) return "Expense category is required.";
  if (!form.description.trim()) return "Expense description is required.";
  if (!isPositiveAmount(form.amount)) return "Expense amount must be greater than zero.";
  if (!isCurrencyCode(form.currency)) return "Currency must be a three-letter code.";
  if (form.taxAmount !== "" && form.taxAmount !== null && form.taxAmount !== undefined) {
    if (!isAmount(form.taxAmount) || Number(form.taxAmount) < 0) {
      return "Tax amount must be zero or greater.";
    }
    if (Number(form.taxAmount) > Number(form.amount)) {
      return "Tax amount cannot exceed the expense amount.";
    }
  }
  if (!expensePaymentMethods.some((method) => method.value === form.paymentMethod)) {
    return "Payment method is required.";
  }
  return "";
}

export function normalizeExpenseAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  return String(value).trim();
}

export function formatExpenseAmount(value, currency = "JPY") {
  if (value === null || value === undefined || value === "") return "Not set";

  const amount = Number(value);
  if (!Number.isFinite(amount)) return "Not set";

  return new Intl.NumberFormat("en-US", {
    currency: currency || "JPY",
    maximumFractionDigits: currency === "JPY" ? 0 : 2,
    style: "currency"
  }).format(amount);
}

export function getPrimaryExpenseSummary(summaryRows = []) {
  return (
    summaryRows.find((summary) => summary.currency === "JPY") ||
    summaryRows[0] || {
      currency: "JPY",
      total_expenses: 0,
      total_tax: 0,
      expense_count: 0,
      category_totals: [],
      school_totals: []
    }
  );
}

export function isExpenseCategoryAvailableForSchool(category, schoolId) {
  if (!category) return false;
  return category.status === "active" && (!category.school_id || category.school_id === schoolId);
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
