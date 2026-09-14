import { getAiEigoAccessStatus } from "./ai-eigo-invitations.js";
import { formatEnrollment, formatPersonName } from "./format.js";

export const studentStatuses = [
  { value: "active", label: "Active" },
  { value: "pending", label: "Pending" },
  { value: "paused", label: "Paused" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "graduated", label: "Graduated" },
  { value: "inactive", label: "Inactive" }
];

export const studentStatusValues = studentStatuses.map((status) => status.value);

export function isValidStudentStatus(value) {
  return studentStatusValues.includes(value);
}

export const studentStartDateFilterOptions = [
  { value: "all", label: "All dates" },
  { value: "this_month", label: "This month" },
  { value: "last_3_months", label: "Last 3 months" },
  { value: "this_year", label: "This year" },
  { value: "older", label: "Older" }
];

export const studentAiEigoFilterOptions = [
  { value: "all", label: "All" },
  { value: "invited", label: "Invited" },
  { value: "not_invited", label: "Not invited" },
  { value: "linked", label: "Claimed / active" }
];

export function getLocalDateKey(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

export function createDefaultStudentFilters() {
  return {
    aiEigo: "all",
    courseClass: "all",
    schoolId: "all",
    search: "",
    startDate: "all",
    status: "all"
  };
}

export function hasActiveStudentFilters(filters = createDefaultStudentFilters()) {
  const defaults = createDefaultStudentFilters();
  return Object.entries(defaults).some(([key, value]) => (filters[key] ?? value) !== value);
}

export function filterStudents(students = [], filters = {}, today = getLocalDateKey()) {
  const normalizedFilters = { ...createDefaultStudentFilters(), ...filters };
  const search = normalizedFilters.search.trim().toLowerCase();

  return students.filter((student) => {
    if (search && !studentSearchText(student).includes(search)) return false;
    if (normalizedFilters.status !== "all" && student.status !== normalizedFilters.status) return false;
    if (normalizedFilters.schoolId !== "all" && student.school_id !== normalizedFilters.schoolId) return false;
    if (normalizedFilters.courseClass !== "all" && getStudentCourseClassValue(student) !== normalizedFilters.courseClass) return false;
    if (!studentStartDateMatches(student.start_date, normalizedFilters.startDate, today)) return false;
    if (!studentAiEigoMatches(student, normalizedFilters.aiEigo)) return false;
    return true;
  });
}

export function getStudentCourseClassOptions(students = []) {
  return [...new Set(students.map(getStudentCourseClassValue).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({ value, label: value }));
}

export function getVisibleSelectedIds(selectedIds = new Set(), visibleStudents = []) {
  const visibleIds = new Set(visibleStudents.map((student) => student.id));
  return new Set([...selectedIds].filter((studentId) => visibleIds.has(studentId)));
}

export function getStudentCourseClassValue(student) {
  const value = formatEnrollment(student?.student_enrollments || []);
  return value && value !== "Not set" ? value : "Not set";
}

export function isValidStudentEmail(value) {
  return /^[^@\s,<>]+@[^@\s,<>]+\.[^@\s,<>]+$/.test(String(value || "").trim());
}

function studentSearchText(student) {
  return [
    formatPersonName(student),
    student?.first_name,
    student?.last_name,
    student?.preferred_name,
    student?.legacy_customer_id,
    student?.legacy_japanese_name
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function studentAiEigoMatches(student, filter) {
  if (filter === "all") return true;

  const status = getAiEigoAccessStatus(student);
  if (filter === "invited") return status !== "not_invited" && status !== "linked";
  return status === filter;
}

function studentStartDateMatches(value, filter, today) {
  if (filter === "all") return true;

  const date = parseDateOnly(value);
  const todayDate = parseDateOnly(today);
  if (!date || !todayDate) return false;

  const thisMonthStart = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);
  const thisYearStart = new Date(todayDate.getFullYear(), 0, 1);
  const threeMonthsStart = new Date(todayDate.getFullYear(), todayDate.getMonth() - 3, todayDate.getDate());

  if (filter === "this_month") return date >= thisMonthStart && date <= todayDate;
  if (filter === "last_3_months") return date >= threeMonthsStart && date <= todayDate;
  if (filter === "this_year") return date >= thisYearStart && date <= todayDate;
  if (filter === "older") return date < thisYearStart;
  return true;
}

function parseDateOnly(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(String(value).slice(0, 10))) return null;
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}
