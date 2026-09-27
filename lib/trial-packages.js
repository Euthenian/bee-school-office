import { formatClassLevel, formatLessonTime, formatLessonType, formatTeacherName } from "./class-details.js";
import { formatProspectName } from "./trial-lessons.js";

export const trialPackageStatuses = [
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "converted", label: "Converted" },
  { value: "cancelled", label: "Cancelled" }
];

export const trialPackageLessonStatuses = [
  { value: "not_scheduled", label: "Not scheduled" },
  { value: "scheduled", label: "Scheduled" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "no_show", label: "No-show" }
];

export function formatTrialPackageStatus(value) {
  return trialPackageStatuses.find((status) => status.value === value)?.label || "Unknown";
}

export function formatTrialPackageLessonStatus(value) {
  return trialPackageLessonStatuses.find((status) => status.value === value)?.label || "Unknown";
}

export function formatTrialPackageType(value) {
  const normalized = String(value || "").replace(/_/g, " ").trim();
  if (!normalized) return "Trial Package";
  return normalized.replace(/\b\w/g, (character) => character.toUpperCase());
}

export function sortTrialPackageLessons(lessons = []) {
  return [...lessons].sort((left, right) => (left.lesson_number || 0) - (right.lesson_number || 0));
}

export function getTrialPackageProgress(trialPackage) {
  const lessons = sortTrialPackageLessons(trialPackage?.trial_package_lessons || []);
  const completed = lessons.filter((lesson) => lesson.status === "completed").length;
  const total = trialPackage?.total_lessons || lessons.length || 0;
  const unscheduled = lessons.filter((lesson) => lesson.status === "not_scheduled").length;
  const nextLesson = getNextTrialPackageLesson(lessons);
  const nextScheduledLesson = getNextScheduledTrialPackageLesson(lessons);

  return {
    completed,
    total,
    unscheduled,
    nextLesson,
    nextScheduledLesson,
    label: `${completed} / ${total} completed`
  };
}

export function getNextTrialPackageLesson(lessons = []) {
  return sortTrialPackageLessons(lessons).find((lesson) => !["completed", "cancelled", "no_show"].includes(lesson.status)) || null;
}

export function getNextScheduledTrialPackageLesson(lessons = []) {
  return sortTrialPackageLessons(lessons)
    .filter((lesson) => lesson.status === "scheduled" && lesson.lesson_date && lesson.lesson_time)
    .sort((left, right) => {
      const leftValue = `${left.lesson_date} ${left.lesson_time}`;
      const rightValue = `${right.lesson_date} ${right.lesson_time}`;
      return leftValue.localeCompare(rightValue);
    })[0] || null;
}

export function formatTrialPackageSummary(trialPackage) {
  return [
    formatProspectName(trialPackage?.prospects),
    formatClassLevel({ class_levels: trialPackage?.class_levels }),
    formatLessonType(trialPackage?.lesson_type)
  ]
    .filter((item) => item && item !== "Not set")
    .join(" / ");
}

export function formatTrialPackageLessonSchedule(lesson) {
  const linkedTrialLesson = lesson?.linked_trial_lesson;
  return [linkedTrialLesson?.trial_date || lesson?.lesson_date, formatLessonTime(linkedTrialLesson?.trial_time || lesson?.lesson_time)]
    .filter((item) => item && item !== "Not set")
    .join(" ");
}

export function formatTrialPackageLessonTeacher(lesson) {
  if (lesson?.linked_trial_lesson?.assigned_teacher) return formatTeacherName(lesson.linked_trial_lesson.assigned_teacher);
  if (!lesson?.assigned_teacher_staff) return "No teacher";
  return formatTeacherName({
    full_name: lesson.assigned_teacher_staff.display_name || lesson.assigned_teacher_staff.legal_name,
    email: lesson.assigned_teacher_staff.email
  });
}
