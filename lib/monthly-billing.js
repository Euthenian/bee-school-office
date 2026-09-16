export const monthlyBillingStatusFilters = [
  { value: "all", label: "All students" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive / stopped" },
  { value: "upcoming_change", label: "Upcoming billing change" }
];

export function getBillingMonthStart(value = new Date()) {
  const parts = getYearMonthParts(value);
  if (!parts) return "";

  return `${parts.year}-${pad(parts.month)}-01`;
}

export function getBillingMonthEnd(value) {
  const monthStart = getBillingMonthStart(value);
  if (!monthStart) return "";

  const parts = getYearMonthParts(monthStart);
  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month), 0));
  return date.toISOString().slice(0, 10);
}

export function createMonthlyBillingFilters(referenceDate = new Date()) {
  const monthStart = getBillingMonthStart(referenceDate);

  return {
    billingMonth: monthStart,
    month: monthStart.slice(5, 7),
    organizationId: "",
    schoolId: "",
    search: "",
    status: "all",
    year: monthStart.slice(0, 4)
  };
}

export function syncBillingMonthFromParts(filters) {
  const year = String(filters.year || "").padStart(4, "0");
  const month = String(filters.month || "").padStart(2, "0");

  if (!/^\d{4}$/.test(year) || !/^(0[1-9]|1[0-2])$/.test(month)) {
    return filters.billingMonth || "";
  }

  return `${year}-${month}-01`;
}

export function getBillingStopTiming(billingEndDate, billingMonth) {
  if (!billingEndDate || !billingMonth) return "";

  const stop = String(billingEndDate).slice(0, 10);
  const monthStart = getBillingMonthStart(billingMonth);
  const monthEnd = getBillingMonthEnd(billingMonth);
  const nextMonthStart = addMonths(monthStart, 1);
  const nextMonthEnd = getBillingMonthEnd(nextMonthStart);

  if (stop >= monthStart && stop <= monthEnd) return "this_month";
  if (stop >= nextMonthStart && stop <= nextMonthEnd) return "next_month";
  return "";
}

export function getBillingStopAlertLabel(timing) {
  if (timing === "this_month") return "\u2605 Stops this month · Next month \u00a50";
  if (timing === "next_month") return "\u2605 Stops next month · Payment will become \u00a50";
  return "";
}

export function shouldZeroMonthlyBilling(billingEndDate, billingMonth) {
  if (!billingEndDate || !billingMonth) return false;

  return String(billingEndDate).slice(0, 10) < getBillingMonthStart(billingMonth);
}

export function calculateMonthlySnapshotAmounts(profile = {}, billingMonth) {
  const amount = shouldZeroMonthlyBilling(profile.billing_end_date, billingMonth)
    ? 0
    : Number(profile.monthly_fee_yen || 0);

  return {
    baseAmount: amount,
    finalAmount: amount
  };
}

export function normalizeMonthlyBillingRow(row = {}) {
  return {
    ...row,
    base_amount: normalizeAmount(row.base_amount),
    current_default_monthly_fee_yen: normalizeNullableAmount(row.current_default_monthly_fee_yen),
    default_monthly_fee_yen: normalizeNullableAmount(row.default_monthly_fee_yen),
    final_amount: normalizeAmount(row.final_amount),
    refund_amount: normalizeAmount(row.refund_amount),
    billing_change_timing:
      row.billing_change_timing || getBillingStopTiming(row.current_billing_end_date || row.billing_end_date, row.billing_month)
  };
}

export function filterMonthlyBillingRows(rows = [], filters = {}) {
  const search = String(filters.search || "").trim().toLowerCase();

  return rows.filter((row) => {
    if (filters.status === "active" && row.student_status !== "active") return false;
    if (filters.status === "inactive" && row.student_status === "active") return false;
    if (filters.status === "upcoming_change" && !row.billing_change_timing) return false;

    if (!search) return true;

    return [
      row.student_first_name,
      row.student_last_name,
      row.student_preferred_name,
      row.school_name,
      row.comment,
      row.override_reason
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(search));
  });
}

export function buildMonthlyBillingSnapshotUpdate(input = {}) {
  return {
    comment: emptyToNull(input.comment),
    finalAmount: normalizeAmount(input.finalAmount),
    overrideReason: emptyToNull(input.overrideReason),
    refundAmount: normalizeAmount(input.refundAmount)
  };
}

export function getUpcomingBillingChangeCount(rows = []) {
  return rows.filter((row) => row.billing_change_timing === "this_month" || row.billing_change_timing === "next_month").length;
}

export function getMonthOptions() {
  return Array.from({ length: 12 }, (_, index) => {
    const value = pad(index + 1);
    return {
      label: new Date(Date.UTC(2026, index, 1)).toLocaleString("en-US", { month: "long" }),
      value
    };
  });
}

export function getYearOptions(referenceDate = new Date()) {
  const year = referenceDate.getFullYear();
  return [year - 1, year, year + 1, year + 2].map((value) => String(value));
}

function addMonths(monthStart, count) {
  const parts = getYearMonthParts(monthStart);
  if (!parts) return "";

  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1 + count, 1));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-01`;
}

function getYearMonthParts(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return { month: value.getMonth() + 1, year: value.getFullYear() };
  }

  const match = String(value || "").match(/^(\d{4})-(\d{2})/);
  if (!match) return null;

  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;

  return { month, year: match[1] };
}

function normalizeAmount(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function normalizeNullableAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function emptyToNull(value) {
  const trimmed = String(value || "").trim();
  return trimmed ? trimmed : null;
}

function pad(value) {
  return String(value).padStart(2, "0");
}
