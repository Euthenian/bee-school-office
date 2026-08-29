export const studentQuestionsUpdatedEvent = "student-questions-updated";

export const studentQuestionStatuses = [
  { value: "open", label: "Open" },
  { value: "done", label: "Done" }
];

export function createStudentQuestionForm() {
  return {
    question: "",
    reminderDate: ""
  };
}

export function validateStudentQuestionForm(form) {
  return Boolean(normalizeQuestionText(form?.question) && normalizeQuestionDate(form?.reminderDate));
}

export function buildStudentQuestionInsert(input = {}) {
  return {
    organization_id: input.organizationId,
    school_id: input.schoolId,
    student_id: input.studentId,
    question: normalizeQuestionText(input.question),
    reminder_date: normalizeQuestionDate(input.reminderDate),
    status: "open",
    created_by: input.createdBy
  };
}

export function buildStudentQuestionDatePatch(reminderDate) {
  return {
    reminder_date: normalizeQuestionDate(reminderDate)
  };
}

export function buildStudentQuestionDonePatch(completedAt = new Date().toISOString()) {
  return {
    status: "done",
    completed_at: completedAt
  };
}

export function normalizeQuestionText(value) {
  return String(value || "").trim();
}

export function normalizeQuestionDate(value) {
  return String(value || "").trim().slice(0, 10);
}

export function getTodayDateString(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "";

  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isStudentQuestionBadgeEligible(question, today = getTodayDateString()) {
  const reminderDate = normalizeQuestionDate(question?.reminder_date);
  return question?.status === "open" && Boolean(reminderDate) && reminderDate <= today;
}

export function countDueStudentQuestions(questions, today = getTodayDateString()) {
  return (questions || []).filter((question) => isStudentQuestionBadgeEligible(question, today)).length;
}

export function getStudentQuestionDisplayStatus(question, today = getTodayDateString()) {
  if (question?.status === "done") return "done";

  const reminderDate = normalizeQuestionDate(question?.reminder_date);
  if (reminderDate && reminderDate < today) return "overdue";
  if (reminderDate && reminderDate === today) return "due_today";
  return "open";
}

export function isStudentQuestionOverdue(question, today = getTodayDateString()) {
  return getStudentQuestionDisplayStatus(question, today) === "overdue";
}

export function sortOpenStudentQuestions(questions) {
  return [...(questions || [])].sort((left, right) => {
    const leftDate = normalizeQuestionDate(left?.reminder_date);
    const rightDate = normalizeQuestionDate(right?.reminder_date);
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    return String(left?.created_at || "").localeCompare(String(right?.created_at || ""));
  });
}

export function removeStudentQuestionById(questions, questionId) {
  return (questions || []).filter((question) => question?.id !== questionId);
}

export function replaceStudentQuestionById(questions, updatedQuestion) {
  return sortOpenStudentQuestions(
    (questions || []).map((question) => (question?.id === updatedQuestion?.id ? updatedQuestion : question))
  );
}

export function notifyStudentQuestionsUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(studentQuestionsUpdatedEvent));
  }
}
