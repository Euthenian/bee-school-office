import { getActiveEnrollment } from "./class-details.js";
import { createContactRowsFromStudentContacts } from "./contacts.js";

export const studentStatuses = ["active", "pending", "paused", "withdrawn", "graduated", "inactive"];

export const noteVisibilities = [
  { value: "admin", label: "Administrative" },
  { value: "education", label: "Educational" }
];

export function createEmptyStudentForm() {
  return {
    firstName: "",
    lastName: "",
    preferredName: "",
    schoolId: "",
    startDate: "",
    dateOfBirth: "",
    ageOverride: "",
    status: "active",
    assignedTeacherProfileId: "",
    lessonType: "group",
    classLevelId: "",
    lessonDay: "",
    lessonTime: "",
    guardianFullName: "",
    guardianRelationship: "",
    guardianEmail: "",
    guardianPhone: "",
    internalNote: ""
  };
}

export function createStudentEditState(student) {
  const activeEnrollment = getActiveEnrollment(student?.student_enrollments);
  const classDetails = activeEnrollment?.classes;

  return {
    form: {
      firstName: student?.first_name || "",
      lastName: student?.last_name || "",
      preferredName: student?.preferred_name || "",
      schoolId: student?.school_id || "",
      startDate: toDateInput(student?.start_date),
      dateOfBirth: toDateInput(student?.date_of_birth),
      ageOverride: student?.date_of_birth ? "" : stringifyValue(student?.age_override),
      status: student?.status || "active",
      assignedTeacherProfileId: classDetails?.assigned_teacher_profile_id || classDetails?.assigned_teacher?.id || "",
      lessonType: classDetails?.lesson_type || "group",
      classLevelId: classDetails?.level_id || "",
      lessonDay: classDetails?.lesson_day || "",
      lessonTime: toTimeInput(classDetails?.lesson_time),
      guardianFullName: "",
      guardianRelationship: "",
      guardianEmail: "",
      guardianPhone: "",
      internalNote: ""
    },
    contacts: createContactRowsFromStudentContacts(student?.student_contacts || []),
    guardians: createGuardianRowsFromStudentGuardians(student?.student_guardians || []),
    notes: createNoteRowsFromStudentNotes(student?.student_notes || [])
  };
}

export function createInitialGuardianRow() {
  return {
    id: createLocalId(),
    fullName: "",
    relationship: "",
    email: "",
    phone: "",
    notes: ""
  };
}

export function createGuardianRowsFromStudentGuardians(guardians = []) {
  if (!guardians.length) {
    return [createInitialGuardianRow()];
  }

  return guardians.map((guardian) => ({
    id: guardian.id || createLocalId(),
    fullName: guardian.full_name || "",
    relationship: guardian.relationship || "",
    email: guardian.email || "",
    phone: guardian.phone || "",
    notes: guardian.notes || ""
  }));
}

export function addGuardianRow(rows) {
  return [...rows, createInitialGuardianRow()];
}

export function updateGuardianRow(rows, rowId, field, value) {
  return rows.map((row) => (row.id === rowId ? { ...row, [field]: value } : row));
}

export function removeGuardianRow(rows, rowId) {
  const remaining = rows.filter((row) => row.id !== rowId);
  return remaining.length ? remaining : [createInitialGuardianRow()];
}

export function serializeGuardianRows(rows = []) {
  return rows
    .map((row) => ({
      full_name: normalizeText(row.fullName),
      relationship: normalizeText(row.relationship),
      email: normalizeText(row.email),
      phone: normalizeText(row.phone),
      notes: normalizeText(row.notes)
    }))
    .filter((row) => row.full_name || row.relationship || row.email || row.phone || row.notes);
}

export function createInitialNoteRow() {
  return {
    id: createLocalId(),
    noteId: "",
    visibility: "admin",
    note: ""
  };
}

export function createNoteRowsFromStudentNotes(notes = []) {
  if (!notes.length) {
    return [createInitialNoteRow()];
  }

  return notes.map((note) => ({
    id: note.id || createLocalId(),
    noteId: note.id || "",
    visibility: note.visibility || "admin",
    note: note.note || ""
  }));
}

export function addNoteRow(rows) {
  return [...rows, createInitialNoteRow()];
}

export function updateNoteRow(rows, rowId, field, value) {
  return rows.map((row) => (row.id === rowId ? { ...row, [field]: value } : row));
}

export function removeNoteRow(rows, rowId) {
  const remaining = rows.filter((row) => row.id !== rowId);
  return remaining.length ? remaining : [createInitialNoteRow()];
}

export function serializeNoteRows(rows = []) {
  return rows
    .map((row) => ({
      id: row.noteId || "",
      visibility: row.visibility || "admin",
      note: normalizeText(row.note)
    }))
    .filter((row) => row.note);
}

export function validateGuardianRows(rows = []) {
  return rows.every((row) => {
    const hasDetails = row.relationship.trim() || row.email.trim() || row.phone.trim() || row.notes.trim();
    return !hasDetails || row.fullName.trim();
  });
}

function normalizeText(value) {
  if (typeof value !== "string") {
    return value ?? null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function stringifyValue(value) {
  return value === null || value === undefined ? "" : String(value);
}

function toDateInput(value) {
  return value ? String(value).slice(0, 10) : "";
}

function toTimeInput(value) {
  return value ? String(value).slice(0, 5) : "";
}

function createLocalId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
