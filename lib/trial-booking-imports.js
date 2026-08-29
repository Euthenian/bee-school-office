export const TRIAL_BOOKING_SUBJECT_MARKER = "Trial Booking";
export const PENDING_TRIAL_BOOKING_IMPORT_TABLE = "pending_trial_booking_imports";

const FIELD_LABELS = new Map([
  ["booking source", { key: "booking_source" }],
  ["trial type", { key: "trial_type" }],
  ["student name", { key: "student_name" }],
  ["email", { key: "email" }],
  ["phone", { key: "phone" }],
  ["student age", { key: "student_age" }],
  ["course", { key: "course" }],
  ["lesson type", { key: "lesson_type" }],
  ["first preferred date", { key: "first_preferred_date" }],
  ["first preferred time", { key: "first_preferred_time" }],
  ["second preferred date", { key: "second_preferred_date" }],
  ["second preferred time", { key: "second_preferred_time" }],
  ["message", { key: "customer_message", multiline: true }],
  ["comment", { key: "customer_message", multiline: true }],
  ["comments", { key: "customer_message", multiline: true }],
  ["customer message", { key: "customer_message", multiline: true }],
  ["notes", { key: "customer_message", multiline: true }]
]);

const TEXT_FIELD_KEYS = [
  "booking_source",
  "trial_type",
  "student_name",
  "email",
  "phone",
  "course",
  "lesson_type",
  "customer_message"
];

export function isTrialBookingSubject(subject) {
  return normalizeWhitespace(subject).toLowerCase().includes(TRIAL_BOOKING_SUBJECT_MARKER.toLowerCase());
}

export function parseTrialBookingEmail({ subject = "", body = "" } = {}) {
  const errors = [];
  const rawBody = coerceString(body);

  if (!isTrialBookingSubject(subject)) {
    errors.push('Subject must contain "Trial Booking".');
  }

  const bodyResult = parseTrialBookingBody(rawBody);
  errors.push(...bodyResult.errors);

  return {
    fields: bodyResult.fields,
    rawBody,
    parse_status: errors.length ? "parse_error" : "parsed",
    parse_error: errors.length ? errors.join(" ") : null
  };
}

export function parseTrialBookingBody(body = "") {
  const rawFields = {};
  const errors = [];
  let currentMultilineKey = null;

  for (const originalLine of normalizeLineEndings(body).split("\n")) {
    const line = originalLine.trim();
    const labelMatch = line.match(/^([^:：]+)\s*[:：]\s*(.*)$/);

    if (labelMatch) {
      const label = normalizeLabel(labelMatch[1]);
      const field = FIELD_LABELS.get(label);

      if (field) {
        rawFields[field.key] = labelMatch[2].trim();
        currentMultilineKey = field.multiline ? field.key : null;
        continue;
      }
    }

    if (currentMultilineKey && line) {
      rawFields[currentMultilineKey] = [rawFields[currentMultilineKey], line].filter(Boolean).join("\n");
    }
  }

  const fields = buildEmptyFields();

  for (const key of TEXT_FIELD_KEYS) {
    fields[key] = key === "customer_message" ? emptyMultilineToNull(rawFields[key]) : emptyToNull(rawFields[key]);
  }

  fields.student_age = normalizeOptionalInteger(rawFields.student_age, "Student age", errors);
  fields.first_preferred_date = normalizeOptionalDate(rawFields.first_preferred_date, "First preferred date", errors);
  fields.first_preferred_time = normalizeOptionalTime(rawFields.first_preferred_time, "First preferred time", errors);
  fields.second_preferred_date = normalizeOptionalDate(rawFields.second_preferred_date, "Second preferred date", errors);
  fields.second_preferred_time = normalizeOptionalTime(rawFields.second_preferred_time, "Second preferred time", errors);

  if (!fields.student_name) {
    errors.push("Student name is required to identify the booking.");
  }

  return { fields, errors };
}

export function buildPendingTrialBookingImport(input = {}) {
  const headers = input.headers || [];
  const sourceMailbox = emptyToNull(firstPresent(input.sourceMailbox, input.source_mailbox));
  const gmailMessageId = emptyToNull(firstPresent(input.gmailMessageId, input.gmail_message_id));
  const rawBody = coerceString(firstPresent(input.rawBody, input.rawPlainBody, input.body, input.raw_body));
  const subject = emptyToNull(firstPresent(input.subject, getHeaderValue(headers, "subject"))) || "";
  const parsed = parseTrialBookingEmail({ subject, body: rawBody });
  const metadataErrors = [];

  const organizationId = emptyToNull(firstPresent(input.organizationId, input.organization_id));
  const schoolId = emptyToNull(firstPresent(input.schoolId, input.school_id));

  if (!organizationId) metadataErrors.push("organization_id is required.");
  if (!schoolId) metadataErrors.push("school_id is required.");
  if (!sourceMailbox) metadataErrors.push("source_mailbox is required.");
  if (!gmailMessageId) metadataErrors.push("gmail_message_id is required.");

  const allErrors = [...metadataErrors, parsed.parse_error].filter(Boolean);

  return {
    organization_id: organizationId,
    school_id: schoolId,
    source_type: "gmail",
    source_mailbox: sourceMailbox,
    gmail_message_id: gmailMessageId,
    gmail_thread_id: emptyToNull(firstPresent(input.gmailThreadId, input.gmail_thread_id)),
    received_at: normalizeTimestamp(firstPresent(input.receivedAt, input.received_at)),
    sender: emptyToNull(firstPresent(input.sender, getHeaderValue(headers, "from"))),
    recipient: emptyToNull(firstPresent(input.recipient, getHeaderValue(headers, "to"))),
    subject: emptyToNull(subject),
    ...parsed.fields,
    raw_body: rawBody,
    parse_status: allErrors.length ? "parse_error" : "parsed",
    parse_error: allErrors.length ? allErrors.join(" ") : null,
    review_status: emptyToNull(firstPresent(input.reviewStatus, input.review_status)) || "pending_review"
  };
}

export function getPendingTrialBookingImportDeduplicationKey(input = {}) {
  const sourceMailbox = input.source_mailbox || input.sourceMailbox || "";
  const gmailMessageId = input.gmail_message_id || input.gmailMessageId || "";
  return `${sourceMailbox.trim()}::${gmailMessageId.trim()}`;
}

export function getHeaderValue(headers, name) {
  if (!headers || !name) return null;
  const expected = name.toLowerCase();

  if (Array.isArray(headers)) {
    const header = headers.find((item) => item?.name?.toLowerCase() === expected);
    return header?.value ?? null;
  }

  if (typeof headers === "object") {
    const key = Object.keys(headers).find((item) => item.toLowerCase() === expected);
    return key ? headers[key] : null;
  }

  return null;
}

function buildEmptyFields() {
  return {
    booking_source: null,
    trial_type: null,
    student_name: null,
    email: null,
    phone: null,
    student_age: null,
    course: null,
    lesson_type: null,
    first_preferred_date: null,
    first_preferred_time: null,
    second_preferred_date: null,
    second_preferred_time: null,
    customer_message: null
  };
}

function normalizeOptionalInteger(value, label, errors) {
  const normalized = emptyToNull(value);
  if (normalized === null) return null;

  if (!/^\d+$/.test(normalized)) {
    errors.push(`${label} must be a whole number.`);
    return null;
  }

  const parsed = Number(normalized);
  if (parsed < 0 || parsed > 120) {
    errors.push(`${label} must be between 0 and 120.`);
    return null;
  }

  return parsed;
}

function normalizeOptionalDate(value, label, errors) {
  const normalized = emptyToNull(value);
  if (normalized === null) return null;

  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    errors.push(`${label} must use YYYY-MM-DD format.`);
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;

  if (!valid) {
    errors.push(`${label} is not a valid date.`);
    return null;
  }

  return normalized;
}

function normalizeOptionalTime(value, label, errors) {
  const normalized = emptyToNull(value);
  if (normalized === null) return null;

  const match = normalized.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  if (!match) {
    errors.push(`${label} must use HH:MM format.`);
    return null;
  }

  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function normalizeTimestamp(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  return emptyToNull(value);
}

function normalizeLabel(label) {
  return normalizeWhitespace(label).toLowerCase();
}

function normalizeWhitespace(value) {
  return coerceString(value).replace(/\s+/g, " ").trim();
}

function normalizeLineEndings(value) {
  return coerceString(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function emptyToNull(value) {
  const normalized = normalizeWhitespace(value);
  return normalized ? normalized : null;
}

function emptyMultilineToNull(value) {
  const normalized = normalizeLineEndings(value)
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .join("\n");

  return normalized ? normalized : null;
}

function coerceString(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null);
}
