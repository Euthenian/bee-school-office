export const financeDateRangePresets = [
  { value: "current_month", label: "Current month" },
  { value: "previous_month", label: "Previous month" },
  { value: "current_year", label: "Current year" },
  { value: "custom", label: "Custom" }
];

export function getFinanceDateRange(preset = "current_month", referenceDate = new Date(), timeZone = "") {
  const { month, year } = getDateParts(referenceDate, timeZone);

  if (preset === "previous_month") {
    return {
      dateFrom: formatDateInput(new Date(year, month - 1, 1)),
      dateTo: formatDateInput(new Date(year, month, 0))
    };
  }

  if (preset === "current_year") {
    return {
      dateFrom: formatDateInput(new Date(year, 0, 1)),
      dateTo: formatDateInput(new Date(year, 11, 31))
    };
  }

  return {
    dateFrom: formatDateInput(new Date(year, month, 1)),
    dateTo: formatDateInput(new Date(year, month + 1, 0))
  };
}

export function getPrimaryFinanceSummary(summaryRows = []) {
  const row = summaryRows.find((summary) => summary.currency === "JPY") || summaryRows[0] || {};
  return normalizeFinanceSummary(row);
}

export function normalizeFinanceSummary(row = {}) {
  const currency = row.currency || "JPY";
  const studentCashReceived = toNumber(row.student_cash_received);
  const studentRefunds = toNumber(row.student_refunds);
  const netStudentCashRevenue = toNumber(row.net_student_cash_revenue);
  const payrollPaid = toNumber(row.payroll_paid);
  const operatingExpenses = toNumber(row.operating_expenses);
  const cashOperatingResult = toNumber(
    row.cash_operating_result ?? netStudentCashRevenue - payrollPaid - operatingExpenses
  );
  const accrualOperatingResult = toNumber(row.accrual_operating_result);

  return {
    organization_id: row.organization_id || "",
    school_id: row.school_id || "",
    school_name: row.school_name || "All schools",
    date_from: row.date_from || "",
    date_to: row.date_to || "",
    as_of_date: row.as_of_date || "",
    currency,
    student_cash_received: studentCashReceived,
    student_refunds: studentRefunds,
    net_student_cash_revenue: netStudentCashRevenue,
    student_charges_created: toNumber(row.student_charges_created),
    student_service_period_charges: toNumber(row.student_service_period_charges),
    outstanding_receivables: toNumber(row.outstanding_receivables),
    overdue_receivables: toNumber(row.overdue_receivables),
    unallocated_student_payments: toNumber(row.unallocated_student_payments),
    payroll_accrued_net_payable: toNumber(row.payroll_accrued_net_payable),
    payroll_paid: payrollPaid,
    operating_expenses: operatingExpenses,
    operating_expense_tax: toNumber(row.operating_expense_tax),
    cash_operating_result: cashOperatingResult,
    accrual_operating_result: accrualOperatingResult,
    student_payment_count: toNumber(row.student_payment_count),
    student_refund_count: toNumber(row.student_refund_count),
    student_charge_count: toNumber(row.student_charge_count),
    payroll_entry_count: toNumber(row.payroll_entry_count),
    payroll_payment_count: toNumber(row.payroll_payment_count),
    expense_count: toNumber(row.expense_count),
    expense_category_totals: normalizeJsonArray(row.expense_category_totals)
  };
}

export function getFinanceOrganizationOptions(profile, organizations = []) {
  const superAdminOrganizationIds = new Set(
    (profile?.organization_memberships || [])
      .filter((membership) => membership.role === "super_admin")
      .map((membership) => membership.organization_id)
      .filter(Boolean)
  );

  return organizations.filter((organization) => superAdminOrganizationIds.has(organization.id));
}

export function getFinanceSchoolOptions(schools = [], organizationId = "") {
  return schools.filter(
    (school) =>
      school.status === "active" &&
      (school.organization_id === organizationId || school.organizations?.id === organizationId)
  );
}

export function getFinanceResultTone(value) {
  const amount = Number(value || 0);
  if (amount > 0) return "positive";
  if (amount < 0) return "negative";
  return "neutral";
}

export function formatFinanceAmount(value, currency = "JPY") {
  const amount = Number(value || 0);

  return new Intl.NumberFormat("en-US", {
    currency: currency || "JPY",
    maximumFractionDigits: currency === "JPY" ? 0 : 2,
    style: "currency"
  }).format(amount);
}

function formatDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDateParts(referenceDate, timeZone) {
  if (!timeZone) {
    return {
      month: referenceDate.getMonth(),
      year: referenceDate.getFullYear()
    };
  }

  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric"
    }).formatToParts(referenceDate);
  } catch {
    return {
      month: referenceDate.getMonth(),
      year: referenceDate.getFullYear()
    };
  }
  const valueByType = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    month: Number(valueByType.month) - 1,
    year: Number(valueByType.year)
  };
}

function toNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function normalizeJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
