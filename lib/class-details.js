export const lessonTypes = [
  { value: "group", label: "Group" },
  { value: "private", label: "Private" }
];

export const lessonDays = [
  { value: "monday", label: "Monday" },
  { value: "tuesday", label: "Tuesday" },
  { value: "wednesday", label: "Wednesday" },
  { value: "thursday", label: "Thursday" },
  { value: "friday", label: "Friday" },
  { value: "saturday", label: "Saturday" },
  { value: "sunday", label: "Sunday" }
];

export function formatLessonType(value) {
  return lessonTypes.find((type) => type.value === value)?.label || "Not set";
}

export function formatLessonDay(value) {
  return lessonDays.find((day) => day.value === value)?.label || "Not set";
}

export function formatLessonTime(value) {
  if (!value) return "Not set";
  return String(value).slice(0, 5);
}

export function formatTeacherName(profile) {
  return profile?.full_name || profile?.email || "No teacher assigned";
}

export function getActiveEnrollment(enrollments = []) {
  return enrollments.find((item) => item.status === "active") || enrollments[0] || null;
}

export function formatClassLevel(classDetails, enrollment) {
  return classDetails?.class_levels?.label || enrollment?.level || "Not set";
}

export function formatClassSummary(enrollment) {
  const classDetails = enrollment?.classes;
  if (!classDetails) {
    return "";
  }

  return [
    formatClassLevel(classDetails, enrollment),
    formatLessonType(classDetails.lesson_type),
    [formatLessonDay(classDetails.lesson_day), formatLessonTime(classDetails.lesson_time)]
      .filter((item) => item !== "Not set")
      .join(" ")
  ]
    .filter((item) => item && item !== "Not set")
    .join(" / ");
}
