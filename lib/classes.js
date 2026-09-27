import { formatLessonDay, formatLessonTime } from "./class-details.js";

export const classStatuses = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" }
];

export function getClassActiveStudentCount(classRow) {
  return (classRow?.student_enrollments || []).filter((enrollment) => enrollment.status === "active").length;
}

export function getClassEnrollmentCount(classRow) {
  return (classRow?.student_enrollments || []).length;
}

export function formatClassName(classRow) {
  return [formatLessonDay(classRow?.lesson_day), formatLessonTime(classRow?.lesson_time)]
    .filter((item) => item && item !== "Not set")
    .join(" ");
}

export function formatClassOption(classRow) {
  return [formatClassName(classRow), classRow?.schools?.name || ""].filter(Boolean).join(" - ");
}

export function filterClasses(classes = [], filters = {}) {
  const search = String(filters.search || "").trim().toLowerCase();
  return classes.filter((classRow) => {
    if (filters.schoolId && filters.schoolId !== "all" && classRow.school_id !== filters.schoolId) return false;
    if (filters.status && filters.status !== "all" && classRow.status !== filters.status) return false;

    if (!search) return true;

    const haystack = [
      formatClassName(classRow),
      classRow.schools?.name,
      classRow.status
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(search);
  });
}

export function buildClassMutation(input = {}) {
  return {
    lessonDay: input.lessonDay || "",
    lessonTime: input.lessonTime || "",
    schoolId: input.schoolId || "",
    status: input.status || "active"
  };
}
