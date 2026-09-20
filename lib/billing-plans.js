import { formatLessonType } from "./class-details.js";
import { formatBillingAmount } from "./billing.js";

export function normalizeBillingPlan(row = {}) {
  const monthlyFeeYen = row.monthly_fee_yen === null || row.monthly_fee_yen === undefined ? null : Number(row.monthly_fee_yen);
  const lessonDurationMinutes =
    row.lesson_duration_minutes === null || row.lesson_duration_minutes === undefined ? null : Number(row.lesson_duration_minutes);
  const lessonsPerMonth = row.lessons_per_month === null || row.lessons_per_month === undefined ? null : Number(row.lessons_per_month);
  const sortOrder = row.sort_order === null || row.sort_order === undefined ? 100 : Number(row.sort_order);

  return {
    id: row.id || "",
    organization_id: row.organization_id || "",
    school_id: row.school_id || "",
    name: row.name || "",
    lesson_type: row.lesson_type || "",
    lesson_duration_minutes: Number.isFinite(lessonDurationMinutes) ? lessonDurationMinutes : null,
    lessons_per_month: Number.isFinite(lessonsPerMonth) ? lessonsPerMonth : null,
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
    lessonType: normalized.lesson_type || "",
    lessonDurationMinutes:
      normalized.lesson_duration_minutes === null || normalized.lesson_duration_minutes === undefined
        ? ""
        : String(normalized.lesson_duration_minutes),
    lessonsPerMonth:
      normalized.lessons_per_month === null || normalized.lessons_per_month === undefined ? "" : String(normalized.lessons_per_month),
    monthlyFeeYen: normalized.monthly_fee_yen === null || normalized.monthly_fee_yen === undefined ? "" : String(normalized.monthly_fee_yen),
    active: normalized.active,
    sortOrder: String(normalized.sort_order ?? 100)
  };
}

export function validateBillingPlanForm(form = {}) {
  if (!String(form.name || "").trim()) return "Lesson Package name is required.";
  if (!form.organizationId) return "Organization is required.";

  if (form.lessonDurationMinutes !== "" && !isPositiveInteger(form.lessonDurationMinutes)) {
    return "Lesson duration must be a positive whole number of minutes.";
  }

  if (form.lessonsPerMonth !== "" && !isPositiveInteger(form.lessonsPerMonth)) {
    return "Lessons per month must be a positive whole number.";
  }

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
    lesson_type: emptyToNull(form.lessonType),
    lesson_duration_minutes: optionalNumberToNull(form.lessonDurationMinutes),
    lessons_per_month: optionalNumberToNull(form.lessonsPerMonth),
    monthly_fee_yen: Number(form.monthlyFeeYen),
    active: form.active !== false,
    sort_order: Number(form.sortOrder || 100)
  };
}

export function formatLessonPackageDetails(plan = {}) {
  const typeLabel = plan.lesson_type ? formatLessonType(plan.lesson_type) : "";
  const duration = plan.lesson_duration_minutes ? `${plan.lesson_duration_minutes} min` : "";
  const frequency = plan.lessons_per_month ? `${plan.lessons_per_month}/month` : "";

  return [typeLabel, duration, frequency].filter(Boolean).join(" / ");
}

export function formatLessonPackageOption(plan = {}) {
  const name = String(plan.name || "").trim() || "Unnamed package";
  const details = formatLessonPackageDetails(plan);
  const detailSuffix = details && !nameContainsDetails(name, plan) ? ` / ${details}` : "";
  const amount = formatBillingAmount(plan.monthly_fee_yen, "JPY");
  const status = plan.active ? "" : " (inactive)";

  return `${name}${detailSuffix} - ${amount}${status}`;
}

function isPositiveInteger(value) {
  return /^\d+$/.test(String(value || "")) && Number(value) > 0;
}

function optionalNumberToNull(value) {
  const trimmed = String(value || "").trim();
  return trimmed ? Number(trimmed) : null;
}

function emptyToNull(value) {
  const trimmed = String(value || "").trim();
  return trimmed ? trimmed : null;
}

function nameContainsDetails(name, plan) {
  const normalized = name.toLowerCase();
  const hasType = !plan.lesson_type || normalized.includes(formatLessonType(plan.lesson_type).toLowerCase());
  const hasDuration = !plan.lesson_duration_minutes || normalized.includes(String(plan.lesson_duration_minutes));
  const hasFrequency = !plan.lessons_per_month || normalized.includes(String(plan.lessons_per_month));

  return hasType && hasDuration && hasFrequency;
}

