export const officeTodosUpdatedEvent = "office-todos-updated";

export const officeTodoStatuses = [
  { value: "open", label: "Open" },
  { value: "completed", label: "Completed" }
];

export function createOfficeTodoForm(defaults = {}) {
  return {
    organizationId: defaults.organizationId || defaults.organization_id || "",
    schoolId: defaults.schoolId || defaults.school_id || "",
    title: defaults.title || "",
    description: defaults.description || "",
    dueDate: normalizeOfficeTodoDate(defaults.dueDate || defaults.due_date),
    assignedProfileId: defaults.assignedProfileId || defaults.assigned_profile_id || ""
  };
}

export function validateOfficeTodoForm(form) {
  if (!form.organizationId) return "Organization is required.";
  if (!form.schoolId) return "School is required.";
  if (!normalizeOfficeTodoText(form.title)) return "Title is required.";
  if (form.dueDate && !normalizeOfficeTodoDate(form.dueDate)) return "Due date must be a valid date.";
  return "";
}

export function buildOfficeTodoInsert(input = {}) {
  return {
    organizationId: input.organizationId,
    schoolId: input.schoolId,
    title: normalizeOfficeTodoText(input.title),
    description: normalizeOfficeTodoText(input.description),
    dueDate: normalizeOfficeTodoDate(input.dueDate),
    sourceType: input.sourceType || "manual",
    sourceReference: normalizeOfficeTodoText(input.sourceReference),
    assignedProfileId: input.assignedProfileId || ""
  };
}

export function isOfficeTodoOutstanding(todo) {
  return todo?.status === "open";
}

export function countOutstandingOfficeTodos(todos = []) {
  return todos.filter(isOfficeTodoOutstanding).length;
}

export function notifyOfficeTodosUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(officeTodosUpdatedEvent));
  }
}

function normalizeOfficeTodoText(value) {
  return String(value || "").trim();
}

function normalizeOfficeTodoDate(value) {
  const normalized = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}
