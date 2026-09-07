import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { inflateRawSync } from "node:zlib";

export const LEGACY_STUDENT_IMPORT_BATCHES_TABLE = "legacy_student_import_batches";
export const LEGACY_STUDENT_IMPORT_ROWS_TABLE = "legacy_student_import_rows";

export const IGNORED_LEGACY_COLUMNS = [
  "Name Suffix",
  "To finance",
  "Link To finance",
  "RICO Next fee",
  "Detail next fee",
  "Column2"
];

const IGNORED_LEGACY_COLUMN_KEYS = new Set(IGNORED_LEGACY_COLUMNS.map(normalizeHeaderKey));
const ACTIVE_STATUS_MAPPING = {
  Y: "active",
  N: "inactive"
};

const COLUMN_RULES = [
  { key: "legacy_customer_id", labels: ["customerid", "customer id", "customer number"] },
  { key: "active", labels: ["active"] },
  { key: "first_name", labels: ["t", "first name", "given name"] },
  { key: "last_name", labels: ["last name", "family name", "surname"] },
  { key: "teacher", labels: ["teacher"] },
  { key: "lesson_type", labels: ["lesson type"] },
  { key: "age", labels: ["age"] },
  { key: "group_name", labels: ["group name", "class name"] },
  { key: "frequency", labels: ["frequency"] },
  { key: "fee", labels: ["fee"] },
  { key: "review_asked", labels: ["review asked"] },
  { key: "review_left", labels: ["review left"] },
  { key: "birthday", labels: ["birthday", "birth date", "date of birth", "dob"] },
  { key: "stop", labels: ["stop", "stop date", "end date"] }
];

const START_DATE_KEYS = new Set(["joining", "joining date", "start date"]);
const JAPANESE_MOBILE_HEADER_KEY = "\u643a\u5e2f";

export function readLegacyStudentWorkbook(filePath) {
  const buffer = readFileSync(filePath);
  const extension = extname(filePath).toLowerCase();
  const workbook = extension === ".csv" ? parseCsvWorkbook(buffer, filePath) : parseXlsxWorkbook(buffer, filePath);

  return {
    ...workbook,
    file: {
      name: basename(filePath),
      path: filePath,
      sha256: createHash("sha256").update(buffer).digest("hex")
    }
  };
}

export function buildLegacyStudentImportDryRun(input = {}) {
  const workbook = input.workbook || { sheets: [] };
  const teacherMappings = normalizeTeacherMappings(input.teacherMappings || input.teacher_mappings || {});
  const existingStudents = input.existingStudents || input.existing_students || [];
  const selectedSheets = new Set(input.sheetName ? [input.sheetName] : input.sheetNames || []);
  const rows = [];
  const populatedColumns = new Map();
  const ignoredColumns = new Map();
  const headersBySheet = {};
  const teacherValues = new Map();
  const duplicateBuckets = createDuplicateBuckets(existingStudents);
  const processedSheets = [];

  for (const sheet of workbook.sheets || []) {
    if (selectedSheets.size && !selectedSheets.has(sheet.name)) continue;

    processedSheets.push(sheet);
    headersBySheet[sheet.name] = sheet.headers;
    seedColumnCounts(populatedColumns, ignoredColumns, sheet.headers);

    for (const sourceRow of sheet.rows || []) {
      trackColumnPopulation(sourceRow.values, populatedColumns, ignoredColumns);
      const row = normalizeLegacyStudentRow(sourceRow, {
        sheetName: sheet.name,
        teacherMappings,
        targetSchoolName: input.targetSchoolName || input.target_school_name || "Ohashi"
      });

      if (row.normalized_candidate.teacher?.source_value) {
        incrementMap(teacherValues, row.normalized_candidate.teacher.source_value);
      }

      rows.push(row);
      addRowDuplicateKeys(duplicateBuckets, row);
    }
  }

  annotateDuplicateCandidates(rows, duplicateBuckets);

  const summary = summarizeRows(rows, {
    workbook,
    headersBySheet,
    populatedColumns,
    ignoredColumns,
    targetSchoolName: input.targetSchoolName || input.target_school_name || "Ohashi",
    teacherValues
  });
  const processedWorkbook = { ...workbook, sheets: processedSheets };

  return {
    workbook: {
      sheets: processedSheets.map((sheet) => ({
        name: sheet.name,
        row_count: sheet.rows.length,
        headers: sheet.headers
      })),
      file: workbook.file || null
    },
    mapping: buildProposedMapping(headersBySheet),
    summary,
    rows,
    staging: buildStagingPreview({ workbook: processedWorkbook, rows, summary })
  };
}

export function normalizeLegacyStudentRow(sourceRow, context = {}) {
  const warnings = [];
  const errors = [];
  const unresolved = [];
  const raw = sourceRow.values || {};
  const mapped = collectMappedValues(raw);
  const unknownPopulatedColumns = collectUnknownPopulatedColumns(raw);
  const birthday = parseDateValue(firstValue(mapped.birthday), "Birthday", warnings);
  const age = normalizeAge(firstValue(mapped.age), warnings);
  const startDates = normalizeStartDates(mapped.start_dates || [], warnings);
  const stopDate = parseDateValue(firstValue(mapped.stop), "Stop", warnings);
  const activeState = normalizeActiveState(firstValue(mapped.active), errors);
  const status = resolveStudentStatus(activeState);
  const contacts = [
    ...normalizeEmailContacts(mapped.email_contacts || [], warnings),
    ...normalizePhoneContacts(mapped.phone_contacts || [], warnings)
  ];
  const teacherValue = emptyToNull(firstValue(mapped.teacher));
  const teacher = normalizeTeacher(teacherValue, context.teacherMappings || {}, warnings, unresolved);
  const lessonType = normalizeLessonType(firstValue(mapped.lesson_type), warnings);
  const fee = normalizeStagedField(firstValue(mapped.fee), "fee", warnings);
  const address = normalizeAddress(mapped.address_columns || [], warnings);
  const review = normalizeReviewState(mapped, warnings);
  const japaneseName = normalizeJapaneseName(mapped.japanese_name_columns || [], warnings);

  for (const column of unknownPopulatedColumns) {
    unresolved.push({
      code: "unresolved_populated_column",
      column: column.header,
      value_present: true
    });
  }

  const normalizedCandidate = {
    target_school_name: context.targetSchoolName || "Ohashi",
    legacy_customer_id: emptyToNull(firstValue(mapped.legacy_customer_id)),
    status,
    status_source: {
      column: "Active",
      source_value: activeState.source_value,
      normalized_value: activeState.normalized_value,
      mapping: activeState.mapping
    },
    first_name: emptyToNull(firstValue(mapped.first_name)),
    last_name: emptyToNull(firstValue(mapped.last_name)),
    preferred_name: null,
    japanese_name: japaneseName,
    date_of_birth: birthday,
    age_override: birthday ? null : age,
    start_date: startDates.resolved_date,
    start_date_candidates: startDates.candidates,
    stop_date: stopDate,
    lesson_type: lessonType,
    group_name: emptyToNull(firstValue(mapped.group_name)),
    frequency: emptyToNull(firstValue(mapped.frequency)),
    contacts,
    teacher,
    fee,
    review,
    address,
    import_blockers: []
  };

  const identityState = getStudentIdentityState(normalizedCandidate);
  if (!identityState.usable) {
    errors.push({
      code: "missing_usable_identity",
      message: "No safe student identity could be established from alphabet name or staged Japanese name.",
      reasons: identityState.reasons
    });
  } else if (!normalizedCandidate.first_name || !normalizedCandidate.last_name) {
    warnings.push({
      code: "partial_alphabet_name",
      message: "Alphabet first/last name is incomplete, but another usable identity signal is present for staging review."
    });
  }

  const validationState = errors.length ? "error" : warnings.length || unresolved.length ? "warning" : "valid";
  normalizedCandidate.import_blockers = buildImportBlockers({ errors });

  return {
    source_sheet_name: context.sheetName || sourceRow.sheetName || null,
    source_row_number: sourceRow.rowNumber,
    raw_source_data: raw,
    normalized_candidate: normalizedCandidate,
    validation_state: validationState,
    warnings,
    errors,
    unresolved,
    duplicate_candidates: [],
    imported_student_id: null,
    imported_at: null
  };
}

export function parseXlsxWorkbook(buffer, filePath = "workbook.xlsx") {
  const entries = readZipEntries(buffer);
  const workbookXml = readZipText(entries, "xl/workbook.xml");
  const relationshipXml = readZipText(entries, "xl/_rels/workbook.xml.rels");
  const sharedStrings = entries.has("xl/sharedStrings.xml")
    ? parseSharedStrings(readZipText(entries, "xl/sharedStrings.xml"))
    : [];
  const sheetRelationships = parseWorkbookRelationships(relationshipXml);
  const sheets = parseWorkbookSheets(workbookXml)
    .map((sheet) => {
      const target = sheetRelationships.get(sheet.relationshipId);
      if (!target) return null;
      const sheetPath = normalizeWorkbookTarget(target);
      return parseWorksheet(readZipText(entries, sheetPath), sheet.name, sharedStrings);
    })
    .filter(Boolean);

  return {
    file: { name: basename(filePath), path: filePath },
    sheets
  };
}

export function parseCsvWorkbook(buffer, filePath = "workbook.csv") {
  const rows = parseCsvText(buffer.toString("utf8"));
  const headers = rows[0] || [];
  const sheetRows = rows.slice(1).map((values, index) => ({
    rowNumber: index + 2,
    values: Object.fromEntries(headers.map((header, columnIndex) => [header || `Column${columnIndex + 1}`, values[columnIndex] ?? ""]))
  }));

  return {
    file: { name: basename(filePath), path: filePath },
    sheets: [
      {
        name: basename(filePath),
        headers: headers.map((header, index) => header || `Column${index + 1}`),
        rows: sheetRows.filter((row) => hasPopulatedValue(row.values))
      }
    ]
  };
}

function collectMappedValues(raw) {
  const mapped = {
    start_dates: [],
    email_contacts: [],
    phone_contacts: [],
    address_columns: [],
    japanese_name_columns: []
  };

  for (const [header, value] of Object.entries(raw)) {
    if (!hasValue(value) || isIgnoredLegacyColumn(header)) continue;

    const headerKey = normalizeHeaderKey(header);
    const rule = COLUMN_RULES.find((candidate) => candidate.labels.includes(headerKey));

    if (rule) {
      appendMappedValue(mapped, rule.key, { header, value });
      continue;
    }

    if (START_DATE_KEYS.has(headerKey)) {
      mapped.start_dates.push({ header, value });
      continue;
    }

    if (isJapaneseNameHeader(header)) {
      mapped.japanese_name_columns.push({ header, value });
      continue;
    }

    if (isEmailHeader(header)) {
      mapped.email_contacts.push({ header, value });
      continue;
    }

    if (isPhoneHeader(header)) {
      mapped.phone_contacts.push({ header, value });
      continue;
    }

    if (isAddressHeader(header)) {
      mapped.address_columns.push({ header, value });
    }
  }

  return mapped;
}

function collectUnknownPopulatedColumns(raw) {
  const columns = [];

  for (const [header, value] of Object.entries(raw)) {
    if (!hasValue(value) || isIgnoredLegacyColumn(header) || getMappedColumnKind(header)) continue;
    columns.push({ header, value });
  }

  return columns;
}

function getMappedColumnKind(header) {
  const headerKey = normalizeHeaderKey(header);
  if (COLUMN_RULES.some((rule) => rule.labels.includes(headerKey))) return "known";
  if (START_DATE_KEYS.has(headerKey)) return "start_date";
  if (isJapaneseNameHeader(header)) return "japanese_name";
  if (isEmailHeader(header)) return "email";
  if (isPhoneHeader(header)) return "phone";
  if (isAddressHeader(header)) return "address";
  return null;
}

function appendMappedValue(mapped, key, entry) {
  if (!mapped[key]) mapped[key] = [];
  mapped[key].push(entry);
}

function parseDateValue(value, label, errors) {
  const normalized = emptyToNull(value);
  if (normalized === null) return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    return excelSerialDateToIso(value);
  }

  const text = String(normalized).trim();
  const normalizedText = text.replace(/[./]/g, "-");
  const isoMatch = normalizedText.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const slashMatch = normalizedText.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);

  if (isoMatch) {
    return validIsoDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]), label, errors);
  }

  if (slashMatch) {
    return validIsoDate(Number(slashMatch[3]), Number(slashMatch[1]), Number(slashMatch[2]), label, errors);
  }

  errors.push({ code: "invalid_date", field: label, value: text, message: `${label} must be a valid date.` });
  return null;
}

function validIsoDate(year, month, day, label, errors) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;

  if (!valid) {
    errors.push({ code: "invalid_date", field: label, value: `${year}-${month}-${day}`, message: `${label} must be a valid date.` });
    return null;
  }

  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function excelSerialDateToIso(serial) {
  const millis = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(millis).toISOString().slice(0, 10);
}

function normalizeAge(value, errors) {
  const normalized = emptyToNull(value);
  if (normalized === null) return null;
  const text = String(normalized).trim();

  if (!/^\d+$/.test(text)) {
    errors.push({ code: "invalid_age", value: text, message: "Age must be a whole number between 0 and 120." });
    return null;
  }

  const parsed = Number(text);
  if (parsed < 0 || parsed > 120) {
    errors.push({ code: "invalid_age", value: text, message: "Age must be a whole number between 0 and 120." });
    return null;
  }

  return parsed;
}

function normalizeStartDates(entries, warnings) {
  const candidates = entries
    .map((entry) => ({
      column: entry.header,
      value: emptyToNull(entry.value),
      normalized_date: parseDateValue(entry.value, entry.header, warnings)
    }))
    .filter((entry) => entry.value !== null);

  const uniqueDates = [...new Set(candidates.map((entry) => entry.normalized_date).filter(Boolean))];

  if (uniqueDates.length > 1) {
    warnings.push({
      code: "conflicting_start_dates",
      message: "Joining, Joining Date, and Start Date contain conflicting values.",
      candidates
    });
    return { candidates, resolved_date: null };
  }

  return { candidates, resolved_date: uniqueDates[0] || null };
}

function normalizeActiveState(value, errors) {
  const normalized = emptyToNull(value);
  if (normalized === null) {
    errors.push({ code: "missing_active_status", field: "Active", message: "Active must be Y or N to map students.status." });
    return {
      source_value: null,
      normalized_value: null,
      mapping: null,
      status: null
    };
  }

  const key = String(normalized).trim().toUpperCase();

  if (key === "Y" || key === "N") {
    return {
      source_value: normalized,
      normalized_value: key,
      mapping: `${key} -> ${ACTIVE_STATUS_MAPPING[key]}`,
      status: ACTIVE_STATUS_MAPPING[key]
    };
  }

  errors.push({ code: "unrecognized_active_value", field: "Active", value: normalized, message: "Active must be Y or N to map students.status." });
  return {
    source_value: normalized,
    normalized_value: key,
    mapping: null,
    status: null
  };
}

function resolveStudentStatus(activeState) {
  return activeState.status;
}

function normalizeLessonType(value, warnings) {
  const normalized = emptyToNull(value);
  if (normalized === null) return null;
  const key = String(normalized).trim().toLowerCase();

  if (["group", "group lesson", "group lessons"].includes(key)) return "group";
  if (["private", "private lesson", "private lessons"].includes(key)) return "private";

  warnings.push({ code: "unrecognized_lesson_type", value: normalized, message: "Lesson type must map to group or private." });
  return null;
}

function normalizeEmailContacts(entries, warnings) {
  const contacts = [];

  for (const entry of entries) {
    const values = splitMultiValue(entry.value);
    for (const value of values) {
      const email = value.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        warnings.push({ code: "invalid_email", column: entry.header, value, message: "Email contact is staged for review and is not imported as a contact." });
        continue;
      }
      contacts.push({ contact_type: "email", label: contactLabelFromHeader(entry.header), value: email, is_primary: contacts.length === 0 });
    }
  }

  return contacts;
}

function normalizePhoneContacts(entries, warnings) {
  const contacts = [];

  for (const entry of entries) {
    const values = splitMultiValue(entry.value);
    for (const value of values) {
      const compact = value.replace(/[^\d+]/g, "");
      if (compact.replace(/^\+/, "").length < 8) {
        warnings.push({ code: "invalid_phone", column: entry.header, value, message: "Phone contact needs manual review." });
      }
      contacts.push({ contact_type: "phone", label: contactLabelFromHeader(entry.header), value, is_primary: contacts.length === 0 });
    }
  }

  return contacts;
}

function normalizeTeacher(value, teacherMappings, warnings, unresolved) {
  if (!value) {
    return { source_value: null, profile_id: null, match_status: "not_provided" };
  }

  const mapping = teacherMappings.get(normalizeLookupKey(value));
  if (mapping) {
    return {
      source_value: value,
      profile_id: mapping.profile_id || mapping.profileId || mapping.id || null,
      match_status: "mapped"
    };
  }

  warnings.push({ code: "unknown_teacher", value, message: "Teacher must be mapped to an existing Bee School Office teacher profile." });
  unresolved.push({ code: "unknown_teacher", value });
  return { source_value: value, profile_id: null, match_status: "unmapped" };
}

function normalizeStagedField(value, kind, warnings) {
  const normalized = emptyToNull(value);
  if (normalized === null) return { source_value: null, import_action: "none" };

  warnings.push({
    code: `${kind}_staged_only`,
    value_present: true,
    message: `${kind} is staged for review and is not imported into live student records by this dry run.`
  });

  return {
    source_value: normalized,
    import_action: "staged_only"
  };
}

function normalizeAddress(entries, warnings) {
  const parts = entries
    .map((entry) => ({ column: entry.header, value: emptyToNull(entry.value) }))
    .filter((entry) => entry.value);

  if (!parts.length) {
    return { source_columns: [], value: null, import_action: "none" };
  }

  warnings.push({
    code: "address_model_required",
    value_present: true,
    message: "Postal address is staged only until an enrolled-student address model/import policy is approved."
  });

  return {
    source_columns: parts,
    value: parts.map((entry) => entry.value).join("\n"),
    import_action: "staged_only_model_required"
  };
}

function normalizeReviewState(mapped, warnings) {
  const asked = emptyToNull(firstValue(mapped.review_asked));
  const left = emptyToNull(firstValue(mapped.review_left));
  const hasReviewState = Boolean(asked || left);

  if (hasReviewState) {
    warnings.push({
      code: "review_state_staged_only",
      value_present: true,
      message: "Legacy review state is staged only. Historical timestamps must not be fabricated."
    });
  }

  return {
    asked_state: asked,
    left_state: left,
    import_action: hasReviewState ? "staged_only_policy_required" : "none"
  };
}

function normalizeJapaneseName(entries, warnings) {
  const columns = entries
    .map((entry) => ({ column: entry.header, value: emptyToNull(entry.value) }))
    .filter((entry) => entry.value);

  if (!columns.length) {
    return { columns: [], family_name: null, given_name: null, direction: "not_provided", import_action: "none" };
  }

  warnings.push({
    code: "japanese_name_direction_required",
    value_present: true,
    message: "Japanese name columns are staged until the workbook confirms family/given direction."
  });

  return {
    columns,
    family_name: null,
    given_name: null,
    direction: "requires_workbook_review",
    import_action: "staged_only_direction_required"
  };
}

function buildImportBlockers({ errors = [] }) {
  const blockers = [];
  if (errors.some((error) => error.code === "missing_usable_identity")) blockers.push("missing_usable_identity");
  if (errors.some((error) => error.code === "missing_active_status")) blockers.push("missing_active_status");
  if (errors.some((error) => error.code === "unrecognized_active_value")) blockers.push("unrecognized_active_value");
  return blockers;
}

function createDuplicateBuckets(existingStudents) {
  const buckets = new Map();
  for (const student of existingStudents || []) {
    for (const key of buildExistingStudentDuplicateKeys(student)) {
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ type: "existing_student", student_id: student.id || null, label: student.label || null });
    }
  }
  return buckets;
}

function addRowDuplicateKeys(buckets, row) {
  for (const key of buildRowDuplicateKeys(row)) {
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({ type: "source_row", row_number: row.source_row_number, sheet_name: row.source_sheet_name });
  }
}

function annotateDuplicateCandidates(rows, buckets) {
  for (const row of rows) {
    const candidates = [];
    for (const key of buildRowDuplicateKeys(row)) {
      const matches = (buckets.get(key) || []).filter(
        (match) => match.type !== "source_row" || match.row_number !== row.source_row_number || match.sheet_name !== row.source_sheet_name
      );
      if (matches.length) {
        candidates.push({ key, matches });
      }
    }

    row.duplicate_candidates = candidates;
    if (candidates.length) {
      row.warnings.push({ code: "duplicate_candidate", message: "Potential duplicate requires manual review." });
      if (row.validation_state === "valid") row.validation_state = "warning";
    }
    row.normalized_candidate.import_blockers = buildImportBlockers({
      errors: row.errors
    });
    row.import_eligibility = buildImportEligibility(row);
  }
}

function getStudentIdentityState(candidate) {
  const reasons = [];
  const alphabetParts = [candidate.first_name, candidate.last_name].filter(Boolean);
  const usableAlphabetParts = alphabetParts.filter((part) => !isLikelyEmailText(part));
  const japaneseName = (candidate.japanese_name?.columns || []).map((entry) => entry.value).filter(Boolean).join(" ");

  if (usableAlphabetParts.length) return { usable: true, reasons };
  if (japaneseName) return { usable: true, reasons };

  if (!alphabetParts.length) reasons.push("missing_alphabet_name");
  if (alphabetParts.some(isLikelyEmailText)) reasons.push("alphabet_name_contains_email");
  if (!japaneseName) reasons.push("missing_japanese_name");

  return { usable: false, reasons };
}

function isLikelyEmailText(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function buildImportEligibility(row) {
  const blockers = row.normalized_candidate.import_blockers || [];
  const warningCount = row.warnings.length + row.unresolved.length;

  if (blockers.length) {
    return {
      eligible: false,
      status: "blocked",
      blockers,
      warning_count: warningCount,
      error_count: row.errors.length
    };
  }

  return {
    eligible: true,
    status: warningCount ? "importable_with_warnings" : "importable",
    blockers: [],
    warning_count: warningCount,
    error_count: row.errors.length
  };
}

function buildRowDuplicateKeys(row) {
  const candidate = row.normalized_candidate;
  const keys = [];
  if (candidate.legacy_customer_id) keys.push(`legacy:${normalizeLookupKey(candidate.legacy_customer_id)}`);
  if (candidate.first_name && candidate.last_name) {
    keys.push(`alphabet_name:${normalizeLookupKey(candidate.last_name)}:${normalizeLookupKey(candidate.first_name)}`);
  }
  for (const contact of candidate.contacts || []) {
    if (contact.contact_type === "email") keys.push(`email:${normalizeLookupKey(contact.value)}`);
    if (contact.contact_type === "phone") keys.push(`phone:${normalizePhoneKey(contact.value)}`);
  }
  const japaneseRaw = (candidate.japanese_name?.columns || []).map((entry) => entry.value).filter(Boolean).join(" ");
  if (japaneseRaw) keys.push(`japanese_name:${normalizeLookupKey(japaneseRaw)}`);
  return [...new Set(keys)];
}

function buildExistingStudentDuplicateKeys(student) {
  const keys = [];
  if (student.legacy_customer_id) keys.push(`legacy:${normalizeLookupKey(student.legacy_customer_id)}`);
  if (student.first_name && student.last_name) {
    keys.push(`alphabet_name:${normalizeLookupKey(student.last_name)}:${normalizeLookupKey(student.first_name)}`);
  }
  for (const contact of student.contacts || student.student_contacts || []) {
    if (contact.contact_type === "email" && contact.value) keys.push(`email:${normalizeLookupKey(contact.value)}`);
    if (contact.contact_type === "phone" && contact.value) keys.push(`phone:${normalizePhoneKey(contact.value)}`);
  }
  if (student.japanese_name) keys.push(`japanese_name:${normalizeLookupKey(student.japanese_name)}`);
  return [...new Set(keys)];
}

function summarizeRows(rows, context) {
  const warningRows = rows.filter((row) => row.validation_state === "warning").length;
  const errorRows = rows.filter((row) => row.validation_state === "error").length;
  const activeColumnSummary = summarizeActiveColumn(rows);
  const eligibleRows = rows.filter((row) => row.import_eligibility?.eligible);
  const blockedRows = rows.filter((row) => !row.import_eligibility?.eligible);
  const importableWithWarnings = eligibleRows.filter((row) => row.import_eligibility?.status === "importable_with_warnings");
  const unknownTeachers = [...context.teacherValues.entries()]
    .filter(([teacher]) => rows.some((row) => row.normalized_candidate.teacher?.source_value === teacher && row.normalized_candidate.teacher?.match_status === "unmapped"))
    .map(([teacher, count]) => ({ value: teacher, count }));

  return {
    target_school_name: context.targetSchoolName,
    total_source_rows: rows.length,
    active_students: activeColumnSummary.y_count,
    inactive_students: activeColumnSummary.n_count,
    active_y_count: activeColumnSummary.y_count,
    active_n_count: activeColumnSummary.n_count,
    blank_or_invalid_active_values: activeColumnSummary.blank_or_invalid_count,
    blank_active_values: activeColumnSummary.blank_count,
    invalid_active_values: activeColumnSummary.invalid_count,
    active_column: activeColumnSummary,
    eligible_for_import: eligibleRows.length,
    completely_blocked: blockedRows.length,
    importable_with_warnings: importableWithWarnings.length,
    status_mapping_to_production: {
      "Active = Y": "students.status = active",
      "Active = N": "students.status = inactive"
    },
    valid_rows: rows.filter((row) => row.validation_state === "valid").length,
    rows_with_warnings: warningRows,
    rows_with_errors: errorRows,
    duplicate_candidates: rows.filter((row) => row.duplicate_candidates.length).length,
    unknown_teachers: unknownTeachers,
    conflicting_start_joining_dates: rows.filter((row) => hasRowIssue(row, "conflicting_start_dates")).length,
    invalid_emails: rows.filter((row) => hasRowIssue(row, "invalid_email")).length,
    invalid_phones: rows.filter((row) => row.warnings.some((warning) => warning.code === "invalid_phone")).length,
    invalid_birthdays: rows.filter((row) => hasRowIssue(row, "invalid_date", "Birthday")).length,
    unresolved_fields: collectSummaryUnresolved(rows),
    populated_legacy_columns: mapToColumnCountArray(context.populatedColumns),
    ignored_legacy_columns: mapToColumnCountArray(context.ignoredColumns),
    teacher_values_found: [...context.teacherValues.entries()].map(([value, count]) => ({ value, count })),
    fee_handling_recommendation: "Stage Fee values only. Do not create student_charges or recurring pricing until the owner approves a pricing policy.",
    address_handling_recommendation: "Stage Address values only. Current create/update student RPCs accept email and phone contacts, so final address import requires an enrolled-student address model or approved contact-address import path.",
    review_state_handling_recommendation: "Stage Review asked/left states only. Do not fabricate google_review_asked_at/google_review_left_at timestamps.",
    completely_unused_empty_columns: collectCompletelyUnusedColumns(context.headersBySheet, context.populatedColumns)
  };
}

function summarizeActiveColumn(rows) {
  const invalidValues = new Map();
  const blankRows = [];
  const invalidRows = [];
  let yCount = 0;
  let nCount = 0;
  let blankCount = 0;
  let invalidCount = 0;

  for (const row of rows) {
    const entry = getActiveColumnEntry(row.raw_source_data);
    const normalized = emptyToNull(entry?.value);

    if (normalized === null) {
      blankCount += 1;
      blankRows.push({ sheet_name: row.source_sheet_name, row_number: row.source_row_number });
      continue;
    }

    const key = String(normalized).trim().toUpperCase();
    if (key === "Y") {
      yCount += 1;
    } else if (key === "N") {
      nCount += 1;
    } else {
      invalidCount += 1;
      incrementMap(invalidValues, String(normalized).trim());
      invalidRows.push({ sheet_name: row.source_sheet_name, row_number: row.source_row_number, value: normalized });
    }
  }

  return {
    total_rows: rows.length,
    y_count: yCount,
    n_count: nCount,
    blank_count: blankCount,
    invalid_count: invalidCount,
    blank_or_invalid_count: blankCount + invalidCount,
    invalid_values: [...invalidValues.entries()].map(([value, count]) => ({ value, count })),
    blank_rows: blankRows,
    invalid_rows: invalidRows
  };
}

function getActiveColumnEntry(raw) {
  const entry = Object.entries(raw || {}).find(([header]) => normalizeHeaderKey(header) === "active");
  return entry ? { header: entry[0], value: entry[1] } : null;
}

function hasRowIssue(row, code, field) {
  return [...row.errors, ...row.warnings].some((issue) => issue.code === code && (!field || issue.field === field));
}

function collectSummaryUnresolved(rows) {
  const counts = new Map();

  for (const row of rows) {
    for (const item of row.unresolved) {
      const key = item.column || item.value || item.code;
      incrementMap(counts, `${item.code}:${key}`);
    }
  }

  return [...counts.entries()].map(([key, count]) => {
    const [code, value] = key.split(/:(.*)/s);
    return { code, value, count };
  });
}

function buildStagingPreview({ workbook, rows, summary }) {
  return {
    batch: {
      source_file_name: workbook.file?.name || null,
      source_file_sha256: workbook.file?.sha256 || null,
      source_sheet_names: (workbook.sheets || []).map((sheet) => sheet.name),
      import_status: "dry_run",
      dry_run_summary: summary
    },
    rows: rows.map((row) => ({
      source_sheet_name: row.source_sheet_name,
      source_row_number: row.source_row_number,
      legacy_customer_id: row.normalized_candidate.legacy_customer_id,
      raw_source_data: row.raw_source_data,
      normalized_candidate: row.normalized_candidate,
      validation_state: row.validation_state,
      warnings: row.warnings,
      errors: row.errors,
      unresolved: row.unresolved,
      duplicate_candidates: row.duplicate_candidates,
      import_eligibility: row.import_eligibility,
      imported_student_id: null,
      imported_at: null
    }))
  };
}

function buildProposedMapping(headersBySheet) {
  const mappings = [];
  const headers = [...new Set(Object.values(headersBySheet).flat())];

  for (const header of headers) {
    if (isIgnoredLegacyColumn(header)) {
      mappings.push({ source_column: header, target: "ignored_obsolete_owner_approved" });
      continue;
    }

    const kind = getMappedColumnKind(header);
    if (!kind) {
      mappings.push({ source_column: header, target: "unresolved_report_if_populated" });
      continue;
    }

    mappings.push({ source_column: header, target: targetForColumnKind(kind, header) });
  }

  return mappings;
}

function targetForColumnKind(kind, header) {
  if (kind === "known") {
    const rule = COLUMN_RULES.find((candidate) => candidate.labels.includes(normalizeHeaderKey(header)));
    const targets = {
      legacy_customer_id: "legacy_customer_id migration reference",
      active: "students.status",
      first_name: "students.first_name",
      last_name: "students.last_name",
      teacher: "existing teacher profile mapping",
      lesson_type: "classes.lesson_type when complete class details are approved",
      age: "students.age_override only when Birthday is blank",
      group_name: "student_enrollments.class_name / class grouping review",
      frequency: "staged only when populated",
      fee: "staged only; pricing policy required before final import",
      review_asked: "staged only; review timestamp policy required",
      review_left: "staged only; review timestamp policy required",
      birthday: "students.date_of_birth",
      stop: "staged historical stop_date only; zero effect on students.status"
    };
    return targets[rule.key] || "known";
  }

  const targets = {
    start_date: "students.start_date after conflict check",
    japanese_name: "staged only until Japanese family/given direction is verified",
    email: "student_contacts email rows",
    phone: "student_contacts phone rows",
    address: "staged only; enrolled-student address model required"
  };

  return targets[kind];
}

function seedColumnCounts(populatedColumns, ignoredColumns, headers) {
  for (const header of headers) {
    if (!populatedColumns.has(header)) populatedColumns.set(header, 0);
    if (isIgnoredLegacyColumn(header) && !ignoredColumns.has(header)) ignoredColumns.set(header, 0);
  }
}

function trackColumnPopulation(values, populatedColumns, ignoredColumns) {
  for (const [header, value] of Object.entries(values)) {
    if (hasValue(value)) {
      incrementMap(populatedColumns, header);
      if (isIgnoredLegacyColumn(header)) incrementMap(ignoredColumns, header);
    }
  }
}

function mapToColumnCountArray(map) {
  return [...map.entries()]
    .filter(([, count]) => count > 0)
    .map(([column, count]) => ({ column, count }));
}

function normalizeTeacherMappings(input) {
  const mappings = new Map();
  if (input instanceof Map) return input;
  const entries = Array.isArray(input) ? input.map((item) => [item.name || item.source || item.value, item]) : Object.entries(input);

  for (const [key, value] of entries) {
    if (!key) continue;
    mappings.set(normalizeLookupKey(key), typeof value === "string" ? { profile_id: value } : value);
  }

  return mappings;
}

function parseWorksheet(xml, sheetName, sharedStrings) {
  const rows = [];
  const rowRegex = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(xml))) {
    const rowNumber = Number(parseAttributes(rowMatch[1]).r || rows.length + 1);
    const cells = parseCells(rowMatch[2], sharedStrings);
    rows.push({ rowNumber, cells });
  }

  const headerRow = rows.find((row) => row.cells.some((cell) => hasValue(cell.value)));
  if (!headerRow) return { name: sheetName, headers: [], rows: [] };

  const headers = headerRow.cells.map((cell, index) => normalizeHeader(cell.value) || `Column${index + 1}`);
  const dataRows = rows
    .filter((row) => row.rowNumber > headerRow.rowNumber)
    .map((row) => ({
      rowNumber: row.rowNumber,
      values: Object.fromEntries(headers.map((header, index) => [header, row.cells[index]?.value ?? ""]))
    }))
    .filter((row) => hasPopulatedValue(row.values));

  return { name: sheetName, headers, rows: dataRows };
}

function parseCells(rowXml, sharedStrings) {
  const cells = [];
  const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
  let cellMatch;

  while ((cellMatch = cellRegex.exec(rowXml))) {
    const attributes = parseAttributes(cellMatch[1]);
    const columnIndex = columnIndexFromReference(attributes.r);
    cells[columnIndex] = { value: parseCellValue(cellMatch[2], attributes, sharedStrings) };
  }

  return Array.from({ length: cells.length }, (_, index) => cells[index] || { value: "" });
}

function parseCellValue(cellXml, attributes, sharedStrings) {
  if (attributes.t === "inlineStr") {
    return decodeXmlText(cellXml.replace(/<[^>]+>/g, ""));
  }

  const valueMatch = cellXml.match(/<v[^>]*>([\s\S]*?)<\/v>/);
  if (!valueMatch) return "";
  const rawValue = decodeXmlText(valueMatch[1]);

  if (attributes.t === "s") {
    return sharedStrings[Number(rawValue)] || "";
  }

  if (attributes.t === "b") {
    return rawValue === "1" ? "TRUE" : "FALSE";
  }

  if (/^-?\d+(?:\.\d+)?$/.test(rawValue)) {
    return Number(rawValue);
  }

  return rawValue;
}

function parseWorkbookSheets(xml) {
  const sheets = [];
  const sheetRegex = /<sheet\b([^>]*)\/?>/g;
  let match;

  while ((match = sheetRegex.exec(xml))) {
    const attributes = parseAttributes(match[1]);
    sheets.push({ name: attributes.name, relationshipId: attributes["r:id"] });
  }

  return sheets;
}

function parseWorkbookRelationships(xml) {
  const relationships = new Map();
  const relationshipRegex = /<Relationship\b([^>]*)\/?>/g;
  let match;

  while ((match = relationshipRegex.exec(xml))) {
    const attributes = parseAttributes(match[1]);
    relationships.set(attributes.Id, attributes.Target);
  }

  return relationships;
}

function parseSharedStrings(xml) {
  const strings = [];
  const sharedStringRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let match;

  while ((match = sharedStringRegex.exec(xml))) {
    const text = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((textMatch) => decodeXmlText(textMatch[1]))
      .join("");
    strings.push(text);
  }

  return strings;
}

function readZipEntries(buffer) {
  const entries = new Map();
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  let offset = centralDirectoryOffset;
  const endOffset = centralDirectoryOffset + centralDirectorySize;

  while (offset < endOffset) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Invalid XLSX central directory.");
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);
    const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = compressionMethod === 0 ? compressed : inflateRawSync(compressed);

    entries.set(fileName, data);
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(buffer) {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  throw new Error("Invalid XLSX file: central directory was not found.");
}

function readZipText(entries, name) {
  const entry = entries.get(name);
  if (!entry) throw new Error(`XLSX file is missing ${name}.`);
  return entry.toString("utf8");
}

function normalizeWorkbookTarget(target) {
  const normalized = target.replace(/^\/+/, "");
  return normalized.startsWith("xl/") ? normalized : `xl/${normalized}`;
}

function parseAttributes(source) {
  const attributes = {};
  const attributeRegex = /([\w:.-]+)="([^"]*)"/g;
  let match;

  while ((match = attributeRegex.exec(source))) {
    attributes[match[1]] = decodeXmlText(match[2]);
  }

  return attributes;
}

function parseCsvText(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  row.push(value.replace(/\r$/, ""));
  rows.push(row);
  return rows;
}

function columnIndexFromReference(reference = "") {
  const columnLetters = reference.replace(/\d+/g, "");
  let index = 0;

  for (const letter of columnLetters) {
    index = index * 26 + letter.toUpperCase().charCodeAt(0) - 64;
  }

  return Math.max(index - 1, 0);
}

function isEmailHeader(header) {
  const key = normalizeHeaderKey(header);
  return key === "mail" || key === "email" || key.includes("gmail") || key.includes("e-mail") || key.includes("email");
}

function isPhoneHeader(header) {
  const key = normalizeHeaderKey(header);
  if (key.includes("phonetic") || key.includes("label")) return false;
  return (
    key === JAPANESE_MOBILE_HEADER_KEY ||
    key.includes("\u96fb\u8a71") ||
    /(^|[^a-z])(phone|mobile|tel|cell)([^a-z]|$)/.test(key)
  );
}

function isAddressHeader(header) {
  const key = normalizeHeaderKey(header);
  return key.includes("address") || key.includes("street") || key.includes("postal") || key.includes("postcode") || key.includes("zip");
}

function isJapaneseNameHeader(header) {
  const key = normalizeHeaderKey(header);
  return key.includes("namejp") || key.includes("japanese name") || key.includes("\u65e5\u672c\u8a9e");
}

function isIgnoredLegacyColumn(header) {
  return IGNORED_LEGACY_COLUMN_KEYS.has(normalizeHeaderKey(header));
}

function normalizeHeader(value) {
  return normalizeWhitespace(value);
}

function normalizeHeaderKey(value) {
  return normalizeWhitespace(value).toLowerCase();
}

function normalizeLookupKey(value) {
  return normalizeWhitespace(value).toLowerCase();
}

function normalizePhoneKey(value) {
  return normalizeWhitespace(value).replace(/[^\d+]/g, "");
}

function contactLabelFromHeader(header) {
  const normalized = normalizeWhitespace(header);
  return normalized || "Other";
}

function splitMultiValue(value) {
  return normalizeWhitespace(value)
    .split(/[;,\n]/)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);
}

function firstValue(entries) {
  return entries?.find((entry) => hasValue(entry.value))?.value ?? null;
}

function hasPopulatedValue(values) {
  return Object.values(values).some(hasValue);
}

function hasValue(value) {
  return emptyToNull(value) !== null;
}

function emptyToNull(value) {
  const normalized = normalizeWhitespace(value);
  return normalized ? normalized : null;
}

function normalizeWhitespace(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function decodeXmlText(value) {
  return String(value)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function incrementMap(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function collectCompletelyUnusedColumns(headersBySheet, populatedColumns) {
  const headers = [...new Set(Object.values(headersBySheet).flat())];
  return headers
    .filter((header) => (populatedColumns.get(header) || 0) === 0)
    .map((column) => ({ column, count: 0 }));
}
