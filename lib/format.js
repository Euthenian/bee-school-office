import { formatClassSummary, getActiveEnrollment } from "./class-details.js";
import { roleLabels } from "./roles.js";

export function humanize(value) {
  if (!value) return "Unknown";
  return String(value)
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

export function formatDateTime(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

export function formatAgeFromDate(value, referenceDate = new Date()) {
  if (!value) return "Not set";

  const [year, month, day] = String(value)
    .slice(0, 10)
    .split("-")
    .map((part) => Number.parseInt(part, 10));

  if (!year || !month || !day) return "Not set";

  let age = referenceDate.getFullYear() - year;
  const currentMonth = referenceDate.getMonth() + 1;
  const currentDay = referenceDate.getDate();
  if (currentMonth < month || (currentMonth === month && currentDay < day)) {
    age -= 1;
  }

  if (age < 0) return "Not set";
  return `${age} ${age === 1 ? "year" : "years"}`;
}

export function formatStudentAge(student, referenceDate = new Date()) {
  const calculatedAge = formatAgeFromDate(student?.date_of_birth, referenceDate);
  if (student?.date_of_birth) {
    return calculatedAge === "Not set" ? "\u2014" : calculatedAge;
  }

  if (Number.isInteger(student?.age_override)) {
    return `${student.age_override} ${student.age_override === 1 ? "year" : "years"}`;
  }

  return "\u2014";
}

export function formatPersonName(person) {
  const preferred = person?.preferred_name ? ` (${person.preferred_name})` : "";
  const name = [person?.first_name, person?.last_name].filter(Boolean).join(" ");
  return name ? `${name}${preferred}` : "Unnamed student";
}

export function formatEnrollment(enrollments = []) {
  const enrollment = getActiveEnrollment(enrollments);
  if (!enrollment) return "Not set";

  const classSummary = formatClassSummary(enrollment);
  if (classSummary) return classSummary;

  return [
    enrollment.courses?.name,
    enrollment.class_name,
    enrollment.level
  ]
    .filter(Boolean)
    .join(" / ") || "Not set";
}

export function formatUserRoles(user) {
  const roles = [
    ...(user?.organization_memberships || []).map((membership) => membership.role),
    ...(user?.school_memberships || []).map((membership) => membership.role)
  ];

  if (!roles.length) return "No roles";

  return [...new Set(roles)]
    .map((role) => roleLabels[role] || humanize(role))
    .join(", ");
}
