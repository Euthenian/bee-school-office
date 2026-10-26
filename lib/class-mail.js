import { getDefaultStudentEmail } from "./communication-templates.js";
import { isValidStudentEmail } from "./students.js";

const supportedVariables = new Set(["student_name", "student_email", "recipient_name", "school_name"]);

export function selectClassEmailTemplates(templates = []) {
  return templates.filter((template) => template.status === "active"
    && template.channel === "email"
    && template.template_key !== "student_departure_confirmation"
    && (template.variable_keys || []).every((key) => supportedVariables.has(key)));
}

export function summarizeClassEmailRecipients(students = []) {
  const validEmails = students.map((student) => getDefaultStudentEmail(student))
    .filter((email) => isValidStudentEmail(email));
  const recipientCount = new Set(validEmails.map((email) => email.trim().toLowerCase())).size;
  return {
    recipientCount,
    missingCount: students.length - validEmails.length,
    duplicateCount: validEmails.length - recipientCount
  };
}
