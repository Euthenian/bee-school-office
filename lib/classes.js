import { formatClassLevel, formatLessonDay, formatLessonTime, formatLessonType, formatTeacherName } from "./class-details.js";

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
  return [
    `${formatLessonDay(classRow?.lesson_day)} ${formatLessonTime(classRow?.lesson_time)}`,
    formatClassLevel(classRow),
    formatLessonType(classRow?.lesson_type),
    formatTeacherName(classRow?.assigned_teacher)
  ]
    .filter((item) => item && item !== "Not set" && item !== "No teacher assigned")
    .join(" · ");
}

export function formatClassOption(classRow) {
  const feeLabel = classRow?.lesson_type === "private" ? "Private" : "Group";
  return [
    `${formatLessonDay(classRow?.lesson_day)} ${formatLessonTime(classRow?.lesson_time)}`,
    formatClassLevel(classRow),
    feeLabel,
    formatTeacherName(classRow?.assigned_teacher)
  ]
    .filter((item) => item && item !== "Not set")
    .join(" · ");
}

export function filterClasses(classes = [], filters = {}) {
  const search = String(filters.search || "").trim().toLowerCase();
  return classes.filter((classRow) => {
    if (filters.schoolId && filters.schoolId !== "all" && classRow.school_id !== filters.schoolId) return false;
    if (filters.lessonType && filters.lessonType !== "all" && classRow.lesson_type !== filters.lessonType) return false;
    if (filters.status && filters.status !== "all" && classRow.status !== filters.status) return false;

    if (!search) return true;

    const haystack = [
      formatClassName(classRow),
      classRow.schools?.name,
      classRow.class_levels?.label,
      classRow.assigned_teacher?.full_name,
      classRow.assigned_teacher?.email,
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
    assignedTeacherProfileId: input.assignedTeacherProfileId || "",
    classLevelId: input.classLevelId || "",
    lessonDay: input.lessonDay || "",
    lessonTime: input.lessonTime || "",
    lessonType: input.lessonType || "group",
    schoolId: input.schoolId || "",
    status: input.status || "active"
  };
}
