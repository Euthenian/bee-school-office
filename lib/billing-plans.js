export function normalizeBillingPlan(row = {}) {
  const monthlyFeeYen = row.monthly_fee_yen === null || row.monthly_fee_yen === undefined ? null : Number(row.monthly_fee_yen);
  const sortOrder = row.sort_order === null || row.sort_order === undefined ? 100 : Number(row.sort_order);

  return {
    id: row.id || "",
    organization_id: row.organization_id || "",
    school_id: row.school_id || "",
    name: row.name || "",
    monthly_fee_yen: Number.isFinite(monthlyFeeYen) ? monthlyFeeYen : null,
    active: row.active !== false,
    sort_order: Number.isFinite(sortOrder) ? sortOrder : 100,
    is_current: Boolean(row.is_current),
    created_at: row.created_at || "",
    updated_at: row.updated_at || ""
  };
}

export function createBillingPlanForm(plan = {}, defaults = {}) {
  const normalized = normalizeBillingPlan(plan);

  return {
    id: normalized.id,
    organizationId: normalized.organization_id || defaults.organizationId || "",
    schoolId: normalized.school_id || "",
    name: normalized.name,
    monthlyFeeYen: normalized.monthly_fee_yen === null || normalized.monthly_fee_yen === undefined ? "" : String(normalized.monthly_fee_yen),
    active: normalized.active,
    sortOrder: String(normalized.sort_order ?? 100)
  };
}

export function validateBillingPlanForm(form = {}) {
  if (!String(form.name || "").trim()) return "Billing Plan name is required.";
  if (!form.organizationId) return "Organization is required.";

  if (!/^\d+$/.test(String(form.monthlyFeeYen || ""))) {
    return "Monthly fee must be a whole yen amount.";
  }

  const monthlyFee = Number(form.monthlyFeeYen);
  if (!Number.isInteger(monthlyFee) || monthlyFee < 0 || monthlyFee > 100000) {
    return "Monthly fee must be between 0 and 100000.";
  }

  if (!/^-?\d+$/.test(String(form.sortOrder || ""))) {
    return "Sort order must be a whole number.";
  }

  return "";
}

export function buildBillingPlanMutation(form = {}) {
  return {
    organization_id: form.organizationId,
    school_id: emptyToNull(form.schoolId),
    name: String(form.name || "").trim(),
    monthly_fee_yen: Number(form.monthlyFeeYen),
    active: form.active !== false,
    sort_order: Number(form.sortOrder || 100)
  };
}

function emptyToNull(value) {
  const trimmed = String(value || "").trim();
  return trimmed ? trimmed : null;
}

