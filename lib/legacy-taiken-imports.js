import { createHash } from "node:crypto";

const text = (value) => String(value ?? "").trim();
const key = (value) => text(value).normalize("NFKC").toLowerCase().replace(/\s+/gu, " ");
export const normalizeTaikenName = (value) => key(value).replace(/[\s\u3000]/gu, "");

export function normalizeTaikenEmail(value) {
  const normalized = key(value);
  return /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/u.test(normalized) ? normalized : null;
}

export function normalizeTaikenPhone(value) {
  const raw = text(value).normalize("NFKC");
  if (!raw || !/^[+\d\s().-]+$/u.test(raw)) return null;
  let digits = raw.replace(/[\s().-]/gu, "");
  if (digits.startsWith("+81")) digits = `0${digits.slice(3).replace(/^0/, "")}`;
  // Lost leading zeros are not restored: numeric spreadsheet cells need review.
  return /^0\d{9,10}$/.test(digits) ? digits : null;
}

export function parseTaikenDate(value, date1904 = false) {
  if (!text(value)) return null;
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < (date1904 ? 0 : 1) || value > 100000 || (!date1904 && value === 60)) return null;
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, value < 60 ? 31 : 30);
    return new Date(epoch + value * 86400000).toISOString().slice(0, 10);
  }
  const normalized = text(value).normalize("NFKC").replace(/\s+/gu, "");
  let match = normalized.match(/^(\d{4})[-/\u5e74](\d{1,2})[-/\u6708](\d{1,2})\u65e5?$/u);
  if (!match) {
    const trailingYear = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (trailingYear && +trailingYear[1] <= 12 && +trailingYear[2] > 12) match = [trailingYear[0], trailingYear[3], trailingYear[1], trailingYear[2]];
    else if (trailingYear && +trailingYear[1] > 12 && +trailingYear[2] <= 12) match = [trailingYear[0], trailingYear[3], trailingYear[2], trailingYear[1]];
  }
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && year <= 2200 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.toISOString().slice(0, 10) : null;
}

export function parseTaikenTime(value) {
  if (!text(value)) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || value >= 1) return null;
    const seconds = Math.round(value * 86400);
    if (seconds >= 86400) return null;
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map((part) => String(part).padStart(2, "0")).join(":");
  }
  const match = text(value).normalize("NFKC").match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const [, hour, minute, second = "0"] = match;
  if (+hour > 23 || +minute > 59 || +second > 59) return null;
  return [hour, minute, second].map((part) => part.padStart(2, "0")).join(":");
}

function studentNames(student) {
  return [...new Set([
    student.legacy_japanese_name, student.japanese_name, student.alphabet_name,
    [student.first_name, student.last_name].filter(Boolean).join(" "),
    [student.last_name, student.first_name].filter(Boolean).join(" ")
  ].map(normalizeTaikenName).filter(Boolean))];
}

function studentDisplayName(student) {
  return [student.first_name, student.last_name].filter(Boolean).join(" ") ||
    student.preferred_name || student.legacy_japanese_name || null;
}

export function matchTaikenStudent({ names = [], email, phone, legacyCustomerId }, students, target) {
  const identities = names.map(normalizeTaikenName).filter(Boolean);
  const matches = [];
  for (const student of students) {
    if (student.organization_id !== target.organization_id || student.school_id !== target.school_id) continue;
    const contacts = student.student_contacts || student.contacts || [];
    const signals = [];
    if (legacyCustomerId && text(student.legacy_customer_id) === text(legacyCustomerId)) signals.push("legacy_customer_id");
    if (email && contacts.some((contact) => contact.contact_type === "email" && normalizeTaikenEmail(contact.value) === email)) signals.push("email");
    if (phone && contacts.some((contact) => contact.contact_type === "phone" && normalizeTaikenPhone(contact.value) === phone)) signals.push("phone");
    if (studentNames(student).some((name) => identities.includes(name))) signals.push("exact_name");
    if (signals.length) matches.push({
      student_id: student.id,
      student_name: studentDisplayName(student),
      student_preferred_name: student.preferred_name || null,
      student_legacy_japanese_name: student.legacy_japanese_name || null,
      student_status: student.status || null,
      signals,
      strong: signals.includes("legacy_customer_id") || (signals.includes("exact_name") && (signals.includes("email") || signals.includes("phone")))
    });
  }
  const strong = matches.filter((candidate) => candidate.strong);
  const emailOwners = matches.filter((candidate) => candidate.signals.includes("email"));
  const phoneOwners = matches.filter((candidate) => candidate.signals.includes("phone"));
  const conflictingContacts = emailOwners.length > 0 && phoneOwners.length > 0 &&
    !emailOwners.some((candidate) => phoneOwners.some((other) => other.student_id === candidate.student_id));
  const category = strong.length === 1 && !conflictingContacts ? "A" : matches.length ? "B" : "C";
  return { category, chosen_student_id: category === "A" ? strong[0].student_id : null, candidates: matches };
}

export function taikenSourceIdentity(target, hash, rowNumber) {
  if (!target?.organization_id || !target?.school_id || !/^[a-f0-9]{64}$/.test(hash) || !Number.isInteger(rowNumber) || rowNumber <= 0) {
    throw new Error("A resolved tenant, SHA-256 and positive source row are required.");
  }
  return createHash("sha256").update(JSON.stringify([target.school_id, hash, "Taiken", rowNumber])).digest("hex");
}

const INQUIRY_ALIASES = { mail: "email", email: "email", phone: "phone", "drop-by": "walk_in" };
const ACQUISITION_ALIASES = {
  "ホームページ": "bee_school_website", homepage: "bee_school_website", "google map": "google_maps",
  "知り合い・友人の紹介": "referral", "知り合い": "referral", "その他": "other"
};
const LESSON_ALIASES = {
  group: "group", "グループ": "group", private: "private", "プライベート": "private", "プライベートレッスン": "private"
};
const LEVEL_ALIASES = {
  "小学生": "elementary", "小学2年": "elementary", "幼稚園": "kindergarten",
  "中学生": "junior_high", "chu 1": "junior_high", "高校生": "high_school",
  "大人": "adult", adult: "adult"
};
const AUDIT_COLUMNS = ["Column1", "Origin", "PC", "Joined", "Joined2", "refusal date", "Teacher", "how they reached out",
  "How they know Bee", "Type of lesson", "Age group S1", "Level S1", "Level s2", "コース", "FP", "Date received"];

function lookup(value, catalog, aliases = {}) {
  if (!text(value)) return null;
  const normalized = key(value);
  const proposed = aliases[normalized];
  const matches = catalog.filter((item) => item.status !== "inactive" &&
    (item.id === proposed || key(item.id) === normalized || key(item.label) === normalized));
  return matches.length === 1 ? matches[0].id : null;
}

export function interpretTaikenStatus(raw, date1904 = false) {
  const joinedValues = [raw.Joined, raw.Joined2].filter((value) => text(value));
  const yes = joinedValues.some((value) => ["yes", "y"].includes(key(value)));
  const no = joinedValues.some((value) => ["no", "n"].includes(key(value)));
  const dates = joinedValues.map((value) => parseTaikenDate(value, date1904)).filter(Boolean);
  const refusalDate = parseTaikenDate(raw["refusal date"], date1904);
  const unknown = joinedValues.filter((value) => !["yes", "y", "no", "n"].includes(key(value)) && !parseTaikenDate(value, date1904));
  if (text(raw["refusal date"]) && !refusalDate) unknown.push(raw["refusal date"]);
  const conflict = (yes || dates.length > 0) && (no || Boolean(refusalDate));
  const joinedCandidate = yes || dates.length > 0;
  if (conflict || unknown.length) return { status: null, joined_candidate: joinedCandidate, confirmed_joined: false, reason: "conflicting_or_unknown_conversion_evidence", refusal_date: refusalDate, possible_join_dates: dates, possible_status: joinedCandidate ? "joined" : null };
  if (yes) return { status: "joined", joined_candidate: true, confirmed_joined: true, reason: "explicit_yes_in_joined_field", refusal_date: refusalDate, possible_join_dates: dates };
  if (dates.length) return { status: null, joined_candidate: true, confirmed_joined: false, reason: "date_in_joined_field_requires_owner_confirmation", refusal_date: refusalDate, possible_join_dates: dates, possible_status: "joined" };
  if (no || refusalDate) return { status: "did_not_join", joined_candidate: false, confirmed_joined: false, reason: no ? "explicit_no_or_n" : "historical_refusal_date", refusal_date: refusalDate, possible_join_dates: [] };
  const cancellation = [raw["Age group S1"], raw["Type of lesson"]].some((value) => /(?:^|\/\s*)cancelled? same day$/i.test(text(value)) || /(?:^|\/\s*)canceled same day$/i.test(text(value)));
  if (cancellation) return { status: "cancelled", joined_candidate: false, confirmed_joined: false, reason: "explicit_canceled_same_day", refusal_date: null, possible_join_dates: [] };
  return { status: null, joined_candidate: false, confirmed_joined: false, reason: "attendance_or_outcome_not_recorded", refusal_date: null, possible_join_dates: [] };
}

function isLegend(raw) {
  return Object.entries(raw).filter(([, value]) => text(value)).every(([header]) => header === "FP") &&
    ["colors", "yellow: communication in process"].includes(key(raw.FP));
}

function nameFields(value) {
  const name = text(value);
  return { japanese_name: name || null, alphabet_name: name && /^[\p{Script=Latin}\p{M}\s.'’-]+$/u.test(name) ? name : null };
}

function usableFurigana(value) {
  const normalized = text(value);
  // The real column also contains operational notes. Do not put those in a person's name.
  return normalized && /^[\p{Script=Hiragana}\p{Script=Katakana}ー・\s]+$/u.test(normalized) ? normalized : null;
}

function unique(values) {
  return [...new Set(values)];
}

function hasUsableIdentity(raw, prospect, contacts, participants) {
  return Boolean(
    prospect.japanese_name || prospect.furigana || contacts.length || participants.length ||
    text(raw.Name) || text(raw.furigana) || text(raw.mail) || text(raw.phone) ||
    text(raw["name of student 1"]) || text(raw["name of student 2"])
  );
}

function hasMeaningfulTaikenHistory(raw, trial, status) {
  const historyColumns = [
    "day of taiken", "Time of Taiken", "how they reached out", "How they know Bee",
    "Type of lesson", "Age group S1", "Level S1", "Level s2", "コース",
    "Request", "notes", "Teacher", "Joined", "Joined2", "refusal date",
    "Column1", "Origin", "PC", "FP", "Date received", "adress", "address"
  ];
  return Boolean(
    trial.trial_date || trial.trial_time || trial.lesson_type || trial.level_id ||
    trial.customer_request || trial.internal_notes || trial.assigned_teacher_profile_id ||
    trial.status || status.refusal_date || status.possible_join_dates?.length ||
    historyColumns.some((column) => text(raw[column]))
  );
}

function addCurrentSchemaGaps({ prospect, trial, gaps }) {
  if (!prospect.japanese_name) gaps.push("prospects.japanese_name");
  if (!trial.trial_date) gaps.push("trial_lessons.trial_date");
  if (!trial.trial_time) gaps.push("trial_lessons.trial_time");
  if (!trial.lesson_type) gaps.push("trial_lessons.lesson_type");
  if (!trial.level_id) gaps.push("trial_lessons.level_id");
  if (!trial.status) gaps.push("trial_lessons.status");
}

function normalizeRow(source, workbook, snapshot, teacherMappings) {
  const raw = source.values;
  const target = snapshot.target;
  const scope = { organization_id: target.organization_id, school_id: target.school_id };
  const warnings = [];
  const blockers = [];
  const currentProductionSchemaGaps = [];
  const warn = (code, column) => warnings.push({ code, column });
  const contacts = [];
  const email = normalizeTaikenEmail(raw.mail);
  const phone = normalizeTaikenPhone(raw.phone);
  if (text(raw.mail) && !email) warn("invalid_email", "mail");
  if (text(raw.phone) && !phone) warn("invalid_phone", "phone");
  if (email) contacts.push({ ...scope, contact_type: "email", label: "Legacy Taiken", value: email, is_primary: true });
  if (phone) contacts.push({ ...scope, contact_type: "phone", label: "Legacy Taiken", value: phone, is_primary: true });
  const inquiry = lookup(raw["how they reached out"], snapshot.inquiry_methods, INQUIRY_ALIASES);
  const acquisition = lookup(raw["How they know Bee"], snapshot.acquisition_sources, ACQUISITION_ALIASES);
  if (text(raw["how they reached out"]) && !inquiry) warn("unresolved_inquiry_method", "how they reached out");
  if (text(raw["How they know Bee"]) && !acquisition) warn("unresolved_acquisition_source", "How they know Bee");
  const furigana = usableFurigana(raw.furigana);
  if (text(raw.furigana) && !furigana) warn("furigana_contains_unverified_name_or_notes", "furigana");
  const prospect = { ...scope, ...nameFields(raw.Name), furigana, inquiry_method_id: inquiry, acquisition_source_id: acquisition };
  if (!prospect.japanese_name) warn("missing_prospect_name", "Name");
  const participants = [];
  const participantMatches = [];
  let participantHouseholdNeedsReview = false;
  for (const slot of [1, 2]) {
    const participantName = raw[`name of student ${slot}`];
    const ageValue = slot === 1 ? raw["Age group S1"] : null;
    const levelValue = slot === 1 ? raw["Level S1"] : raw["Level s2"] ?? raw["Level S2"];
    if (!text(participantName)) {
      if (text(ageValue) || text(levelValue)) warn("participant_details_without_explicit_name", `name of student ${slot}`);
      continue;
    }
    const fragments = text(participantName).split(/\s+and\s+/iu).map(text);
    const multipleNames = fragments.length > 1;
    if (multipleNames) {
      warn("multiple_names_in_participant_cell", `name of student ${slot}`);
      participantHouseholdNeedsReview = true;
      // Preserve only explicitly written names. Relationship descriptions remain
      // raw evidence; splitting never supplies a shared surname or missing child.
      if (!fragments.every((fragment) => /^[\p{L}\p{M}\s.'?-]+$/u.test(fragment) && !/\b(?:mom|mother|dad|father|parent|parents|daughter|son|kid|kids|child|children|adult|adults)\b/iu.test(fragment))) {
        warn("participant_name_is_household_description", `name of student ${slot}`);
        continue;
      }
    }
    const ageGroup = multipleNames ? null : lookup(ageValue, snapshot.class_levels, LEVEL_ALIASES);
    const requestedLevel = multipleNames ? null : lookup(levelValue, snapshot.class_levels, LEVEL_ALIASES);
    if (text(ageValue) && !ageGroup) warn("unresolved_participant_age_group", "Age group S1");
    if (text(levelValue) && !requestedLevel) warn("unresolved_participant_level", `Level S${slot}`);
    for (const [fragmentIndex, fragment] of fragments.entries()) {
      if (/^[\p{Script=Latin}\p{M}'?-]+$/u.test(fragment)) warn("participant_name_may_be_incomplete", `name of student ${slot}`);
      const match = matchTaikenStudent({ names: [fragment], email, phone }, snapshot.students, target);
      participantMatches.push({ slot, source_fragment_index: fragmentIndex + 1, source_name: fragment, ...match });
      participants.push({ ...scope, ...nameFields(fragment), furigana: null, age_group_level_id: ageGroup, requested_level_id: requestedLevel, converted_student_id: null });
    }
  }
  // Named children take precedence over the contact person's identity. Never attach a parent as a child.
  const identityMatches = participantMatches.length ? participantMatches : [{ slot: null, ...matchTaikenStudent({ names: [raw.Name], email, phone }, snapshot.students, target) }];
  const strongIds = [...new Set(identityMatches.filter((match) => match.category === "A").map((match) => match.chosen_student_id))];
  const candidates = identityMatches.flatMap((match) => match.candidates.map((candidate) => ({ ...candidate, participant_slot: match.slot })));
  let category = strongIds.length === 1 && !identityMatches.some((match) => match.category === "B") ? "A" : candidates.length ? "B" : "C";
  const matching = { category, chosen_student_id: category === "A" ? strongIds[0] : null, candidates, participants: identityMatches };
  if (strongIds.length > 1) warn("multiple_converted_students_need_primary_link_review", "name of student 1");
  const status = interpretTaikenStatus(raw, workbook.date1904);
  if (!status.status || (status.joined_candidate && !status.confirmed_joined)) warn(status.reason, "Joined / Joined2 / refusal date");
  const typeFromType = lookup(raw["Type of lesson"], snapshot.schema.enums.class_lesson_type.map((id) => ({ id })), LESSON_ALIASES);
  const course = raw["コース"] ?? raw.course;
  const typeFromCourse = lookup(course, snapshot.schema.enums.class_lesson_type.map((id) => ({ id })), LESSON_ALIASES);
  let lessonType = typeFromType || (!text(raw["Type of lesson"]) ? typeFromCourse : null);
  if (typeFromType && typeFromCourse && typeFromType !== typeFromCourse) {
    lessonType = null;
    warn("conflicting_lesson_type_and_course", "コース");
  }
  if (text(course) && !typeFromCourse) warn("unresolved_course", "コース");
  const levelId = lookup(raw["Age group S1"], snapshot.class_levels, LEVEL_ALIASES);
  let teacherId = null;
  const approvedTeacherId = teacherMappings[text(raw.Teacher)];
  if (approvedTeacherId) {
    const teacher = snapshot.teachers.find((item) => item.profile_id === approvedTeacherId && item.school_id === target.school_id && item.eligible === true);
    if (!teacher) throw new Error(`Approved teacher mapping is not an eligible teacher in the target school: ${text(raw.Teacher)}`);
    teacherId = teacher.profile_id;
  }
  if (text(raw.Teacher) && !teacherId) warn("teacher_requires_exact_approved_mapping", "Teacher");
  const trial = {
    ...scope, trial_date: parseTaikenDate(raw["day of taiken"], workbook.date1904), trial_time: parseTaikenTime(raw["Time of Taiken"]),
    assigned_teacher_profile_id: teacherId, lesson_type: lessonType, level_id: levelId,
    customer_request: text(raw.Request) || null, internal_notes: text(raw.notes) || null, status: status.status,
    converted_student_id: status.confirmed_joined && category === "A" ? matching.chosen_student_id : null
  };
  for (const field of ["trial_date", "trial_time", "lesson_type", "level_id"]) if (!trial[field]) warn(`missing_or_unresolved_${field}`, field);
  if (text(raw["day of taiken"]) && !trial.trial_date) warn("invalid_trial_date", "day of taiken");
  if (text(raw["Time of Taiken"]) && !trial.trial_time) warn("invalid_trial_time", "Time of Taiken");
  if (!participants.length) warn("no_explicit_participant_name", "name of student 1");
  const householdText = [raw["Age group S1"], raw["name of student 1"], raw["name of student 2"], raw.notes, raw.Name].map(text).join(" ");
  const householdEvidence = /[23\uFF12\uFF13]\u4eba|and adult|adutls and kid|\bsisters\b|two kids|two children|2 children|\u59c9\u59b9|\u5144\u5f1f/i.test(householdText);
  if (householdEvidence || participantHouseholdNeedsReview) {
    participantHouseholdNeedsReview = true;
    warn("multiple_participants_require_identity_review", "name of student 1 / Age group S1 / notes");
    if (category === "A") {
      category = "B";
      matching.category = "B";
      matching.chosen_student_id = null;
      trial.converted_student_id = null;
    }
  }
  if (status.confirmed_joined && !participantHouseholdNeedsReview) {
    participants.forEach((participant, index) => {
      participant.converted_student_id = participantMatches[index].chosen_student_id;
    });
  }
  for (const column of ["Column1", "PC", "FP", "Origin"]) if (text(raw[column])) warn("unresolved_legacy_business_meaning", column);
  addCurrentSchemaGaps({ prospect, trial, gaps: currentProductionSchemaGaps });
  if (!hasUsableIdentity(raw, prospect, contacts, participants) && !hasMeaningfulTaikenHistory(raw, trial, status)) {
    blockers.push("no_usable_identity_or_history");
  }
  const uniqueBlockers = unique(blockers);
  const uniqueSchemaGaps = unique(currentProductionSchemaGaps);
  const row = {
    ...scope, import_kind: "taiken", source_file_sha256: workbook.file.sha256, source_sheet_name: "Taiken", source_row_number: source.rowNumber,
    source_identity: taikenSourceIdentity(target, workbook.file.sha256, source.rowNumber),
    raw_source_data: raw, normalized_candidate: {
      prospect, contacts, trial_lesson: trial, participants, status_evidence: status,
      historical_refusal_date: status.refusal_date, student_matching: matching, import_blockers: uniqueBlockers,
      current_production_schema_gaps: uniqueSchemaGaps
    },
    warnings, errors: [], unresolved: uniqueBlockers, duplicate_candidates: [],
    student_match_candidates: candidates, student_match_category: status.joined_candidate ? category : "not_applicable",
    chosen_converted_student_id: trial.converted_student_id, imported_trial_lesson_id: null, imported_prospect_id: null,
    import_status: "dry_run", validation_state: uniqueBlockers.length ? "error" : warnings.length || uniqueSchemaGaps.length ? "warning" : "valid"
  };
  return row;
}

function valueCounts(rows, column, mapper = null) {
  const buckets = new Map();
  for (const row of rows) {
    const raw = row.raw_source_data[column] ?? "";
    const identity = JSON.stringify(raw);
    const item = buckets.get(identity) || { raw_value: raw, count: 0, source_rows: [], ...(mapper ? { proposed_mapping: mapper(raw) } : {}) };
    item.count++;
    item.source_rows.push(row.source_row_number);
    buckets.set(identity, item);
  }
  return [...buckets.values()].sort((a, b) => b.count - a.count);
}

function duplicateGroups(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const trial = row.normalized_candidate.trial_lesson;
    const names = [row.raw_source_data.Name, row.raw_source_data["name of student 1"], row.raw_source_data["name of student 2"]].map(normalizeTaikenName);
    const identity = JSON.stringify([names, trial.trial_date, trial.trial_time]);
    if (!names.some(Boolean) || !trial.trial_date) continue;
    const group = buckets.get(identity) || [];
    group.push(row);
    buckets.set(identity, group);
  }
  const groups = [...buckets.values()].filter((group) => group.length > 1).map((group) => group.map((row) => row.source_row_number));
  for (const group of groups) for (const number of group) rows.find((row) => row.source_row_number === number).duplicate_candidates = group.filter((other) => other !== number).map((source_row_number) => ({ source_sheet_name: "Taiken", source_row_number }));
  return groups;
}

function rowNumbersByItem(rows, selector) {
  const buckets = {};
  for (const row of rows) {
    for (const item of selector(row)) {
      if (!buckets[item]) buckets[item] = [];
      buckets[item].push(row.source_row_number);
    }
  }
  return buckets;
}

function auditEntriesFromBuckets(buckets, currentSchemaRequired = false) {
  return Object.entries(buckets).map(([name, sourceRows]) => ({
    name,
    count: sourceRows.length,
    source_rows: sourceRows,
    current_production_schema_required: currentSchemaRequired
  }));
}

export function buildLegacyTaikenDryRun({ workbook, snapshot, teacherMappings = {} }) {
  if (workbook.sheets?.length !== 1 || workbook.sheets[0].name !== "Taiken") throw new Error("A strictly Taiken-only workbook is required.");
  if (!snapshot?.target?.school_id || !Array.isArray(snapshot.students) || !snapshot.fetched_at) throw new Error("A complete database snapshot is required; missing data is not an empty match population.");
  const sheet = workbook.sheets[0];
  const rows = sheet.rows.filter((source) => !isLegend(source.values)).map((source) => normalizeRow(source, workbook, snapshot, teacherMappings));
  const excludedRows = sheet.rows.filter((source) => isLegend(source.values)).map((source) => ({ source_row_number: source.rowNumber, reason: "FP-only color legend, no prospect/trial data", raw_source_data: source.values }));
  const duplicates = duplicateGroups(rows);
  const conversionCandidates = rows.filter((row) => row.normalized_candidate.status_evidence.joined_candidate);
  const joined = rows.filter((row) => row.normalized_candidate.trial_lesson.status === "joined");
  const count = (predicate) => rows.filter(predicate).length;
  const warningBuckets = rowNumbersByItem(rows, (row) => row.warnings.map((warning) => warning.code));
  const blockerBuckets = rowNumbersByItem(rows, (row) => row.normalized_candidate.import_blockers);
  const schemaGapBuckets = rowNumbersByItem(rows, (row) => row.normalized_candidate.current_production_schema_gaps || []);
  const uniqueValues = Object.fromEntries(AUDIT_COLUMNS.map((column) => [column, valueCounts(rows, column,
    column === "how they reached out" ? (value) => lookup(value, snapshot.inquiry_methods, INQUIRY_ALIASES) :
    column === "How they know Bee" ? (value) => lookup(value, snapshot.acquisition_sources, ACQUISITION_ALIASES) :
    column === "Age group S1" || column.startsWith("Level") ? (value) => lookup(value, snapshot.class_levels, LEVEL_ALIASES) :
    column === "Type of lesson" || column === "コース" ? (value) => lookup(value, snapshot.schema.enums.class_lesson_type.map((id) => ({ id })), LESSON_ALIASES) : null)]));
  const correlations = ["Joined", "Joined2", "refusal date"].map((column) => ({
    column, values: valueCounts(rows, column).map((bucket) => ({ ...bucket, matches: Object.fromEntries(["A", "B", "C"].map((category) => [category, rows.filter((row) => bucket.source_rows.includes(row.source_row_number) && row.normalized_candidate.student_matching.category === category).length])) }))
  }));
  const proposedMatches = joined.filter((row) => row.normalized_candidate.student_matching.category === "A").map((row) => ({
    source_row_number: row.source_row_number, student_id: row.normalized_candidate.student_matching.chosen_student_id,
    converted_student_id: row.chosen_converted_student_id, conversion_confirmed: row.normalized_candidate.status_evidence.confirmed_joined,
    signals: row.student_match_candidates.filter((candidate) => candidate.strong), profile_path: `/students/profile/?id=${row.normalized_candidate.student_matching.chosen_student_id}`
  }));
  const blockerCounts = Object.fromEntries(Object.entries(blockerBuckets).map(([name, sourceRows]) => [name, sourceRows.length]));
  const schemaGapCounts = Object.fromEntries(Object.entries(schemaGapBuckets).map(([name, sourceRows]) => [name, sourceRows.length]));
  const warningCounts = Object.fromEntries(Object.entries(warningBuckets).map(([name, sourceRows]) => [name, sourceRows.length]));
  return {
    mode: "dry_run_only", database_writes: 0, generated_at: new Date().toISOString(), database_snapshot_at: snapshot.fetched_at,
    target: snapshot.target, workbook: { file: workbook.file, date1904: workbook.date1904, sheet_name: "Taiken", dimension: sheet.dimension, header_row_number: sheet.headerRowNumber, columns: sheet.columns, headers: sheet.headers },
    summary: {
      total_physical_rows_including_header: sheet.physicalRowCount,
      total_taiken_data_rows: sheet.rows.length, genuine_data_rows: rows.length, excluded_legend_rows: excludedRows.length,
      existing_students_in_target_school: snapshot.students.length,
      populated_columns: sheet.headers.map((column) => ({ column, count: count((row) => text(row.raw_source_data[column])) })).filter((column) => column.count),
      empty_columns: sheet.headers.filter((column) => !count((row) => text(row.raw_source_data[column]))),
      dates_populated: count((row) => text(row.raw_source_data["day of taiken"])), trial_dates_parsed: count((row) => row.normalized_candidate.trial_lesson.trial_date),
      times_populated: count((row) => text(row.raw_source_data["Time of Taiken"])), trial_times_parsed: count((row) => row.normalized_candidate.trial_lesson.trial_time),
      rows_with_multiple_explicit_participants: count((row) => row.normalized_candidate.participants.length > 1),
      rows_with_multiple_participant_evidence: count((row) => row.warnings.some((warning) => warning.code === "multiple_participants_require_identity_review")),
      explicit_participant_rows: rows.reduce((sum, row) => sum + row.normalized_candidate.participants.length, 0),
      invalid_email_rows: count((row) => row.warnings.some((warning) => warning.code === "invalid_email")),
      invalid_phone_rows: count((row) => row.warnings.some((warning) => warning.code === "invalid_phone")),
      invalid_optional_contact_rows: count((row) => row.warnings.some((warning) => warning.code === "invalid_email" || warning.code === "invalid_phone")),
      joined_candidates: conversionCandidates.length, conversion_candidate_rows: conversionCandidates.length,
      confirmed_joined_rows: count((row) => row.normalized_candidate.status_evidence.confirmed_joined),
      joined_rows: joined.length,
      joined_exact_student_match: joined.filter((row) => row.student_match_category === "A").length,
      joined_ambiguous_student_match: joined.filter((row) => row.student_match_category === "B").length,
      joined_no_student_match: joined.filter((row) => row.student_match_category === "C").length,
      joined_requiring_owner_review: joined.filter((row) => row.student_match_category === "B").length,
      date_only_joined_review_rows: count((row) => row.normalized_candidate.status_evidence.reason === "date_in_joined_field_requires_owner_confirmation"),
      contradictory_joined_review_rows: count((row) => row.normalized_candidate.status_evidence.reason === "conflicting_or_unknown_conversion_evidence"),
      conversion_candidates_requiring_owner_review: conversionCandidates.filter((row) => !row.chosen_converted_student_id).length,
      non_joined_historical_rows: rows.length - joined.length,
      rows_missing_date: count((row) => !row.normalized_candidate.trial_lesson.trial_date),
      rows_missing_time: count((row) => !row.normalized_candidate.trial_lesson.trial_time),
      chosen_converted_student_ids: count((row) => row.chosen_converted_student_id),
      duplicate_candidate_groups: duplicates,
      production_importable_rows: count((row) => row.normalized_candidate.import_blockers.length === 0),
      completely_blocked_rows: count((row) => row.normalized_candidate.import_blockers.length > 0),
      warning_only_rows: count((row) => row.normalized_candidate.import_blockers.length === 0 && (row.warnings.length || row.normalized_candidate.current_production_schema_gaps?.length)),
      rows_with_import_blockers: count((row) => row.normalized_candidate.import_blockers.length > 0),
      rows_with_current_production_schema_gaps: count((row) => row.normalized_candidate.current_production_schema_gaps?.length),
      import_blocker_counts: blockerCounts,
      current_production_schema_gap_counts: schemaGapCounts,
      warning_counts: warningCounts,
      proposed_status_counts: Object.fromEntries([...new Set(rows.map((row) => row.normalized_candidate.trial_lesson.status || "unresolved"))].map((status) => [status, count((row) => (row.normalized_candidate.trial_lesson.status || "unresolved") === status)]))
    },
    unique_values: uniqueValues, status_student_correlations: correlations, proposed_student_matches: proposedMatches,
    import_blockers: auditEntriesFromBuckets(blockerBuckets, false),
    warning_categories: auditEntriesFromBuckets(warningBuckets, false),
    current_production_schema_gaps: auditEntriesFromBuckets(schemaGapBuckets, true),
    teachers: { approved_mappings: teacherMappings, eligible_profiles: snapshot.teachers.filter((teacher) => teacher.eligible), rule: "Only an exact raw-value mapping supplied by the owner to a live eligible Ohashi profile may populate assigned_teacher_profile_id." },
    production_field_mapping: productionFieldMapping(),
    unresolved_business_meanings: [
      "Column1 J/j/y, PC, FP and Origin have no approved business meaning; staging only.",
      "Joined and Joined2 mix yes/no/n and Excel date serials; explicit yes establishes conversion. Date-only positives and contradictions require owner confirmation and do not write a joined status.",
      "Legacy Teacher aliases need exact owner-approved profile UUID mappings; no users are created.",
      "Missing schedules, canonical class level/type and unknown outcomes are warnings and current production schema gaps, not reasons to discard historical rows. No invented values.",
      "Participant names are frequently absent or embedded in household descriptions. Contact Name is not automatically duplicated as a participant; review unnamed or multiple-person records without blocking the historical Taiken.",
      "Level S1 キッズ/初級 and ambiguous age/course/type text have no exact canonical match.",
      "Misplaced notes in furigana and acquisition/inquiry columns remain raw audit data pending review.",
      "Historical refusal date has no dedicated production field; retained in staging pending an approved existing-notes representation."
    ],
    excluded_rows: excludedRows, rows, schema: snapshot.schema,
    staging: { batches_table: "legacy_student_import_batches", rows_table: "legacy_student_import_rows", import_kind: "taiken", persisted: false,
      idempotency_key: ["school_id", "source_file_sha256", "source_sheet_name", "source_row_number"] }
  };
}

export function productionFieldMapping() {
  return [
    { source: "Name", target: "prospects.japanese_name; alphabet_name only for Latin-script source names", rule: "Preserve contact name as written. Missing names remain null in the historical candidate and require a schema/import-path adjustment before production." },
    { source: "furigana", target: "prospects.furigana", rule: "Kana-only names; other values retained in raw staging for review." },
    { source: "mail / phone", target: "prospect_contacts rows: contact_type, value, label, is_primary", rule: "Valid normalized email/phone only; invalid originals retained in raw staging." },
    { source: "how they reached out", target: "prospects.inquiry_method_id", rule: "Exact canonical value or obvious approved-in-code alias; unknown stays null." },
    { source: "How they know Bee", target: "prospects.acquisition_source_id", rule: "Independent acquisition mapping; no collapse into inquiry method." },
    { source: "day of taiken / Time of Taiken", target: "trial_lessons.trial_date / trial_time", rule: "Strict validated calendar date and time when available. Missing/invalid values remain null and require a schema/import-path adjustment; no dates or times are invented." },
    { source: "Type of lesson / コース", target: "trial_lessons.lesson_type", rule: "Explicit group/private only. Clear course type used only when Type of lesson is blank; conflicting or missing values remain null." },
    { source: "Age group S1", target: "trial_lessons.level_id; named participant 1 age_group_level_id", rule: "Exact canonical age-group mapping only, no inference from numeric age. Missing/unresolved values remain null." },
    { source: "Level S1 / Level s2", target: "trial_lesson_participants.requested_level_id", rule: "Existing canonical class_levels only; no new levels." },
    { source: "name of student 1 / name of student 2", target: "trial_lesson_participants rows: japanese_name, alphabet_name, furigana, age_group_level_id, requested_level_id, converted_student_id", rule: "One row per explicit named participant. Missing names and mixed households require review but do not discard the prospect/trial history." },
    { source: "Request / notes", target: "trial_lessons.customer_request / internal_notes", rule: "Preserve original values; no address copied into either field." },
    { source: "Teacher", target: "trial_lessons.assigned_teacher_profile_id", rule: "Explicit owner mapping to eligible Ohashi teacher only; otherwise null." },
    { source: "Joined / Joined2 / refusal date", target: "trial_lessons.status", rule: "Explicit yes writes joined, explicit no/refusal writes did_not_join, cancelled text writes cancelled. Blank/date-only/contradictory outcomes remain null pending owner review." },
    { source: "existing Student match", target: "trial_lessons.converted_student_id; named participant converted_student_id", rule: "Strong A only plus confirmed explicit conversion; ambiguous/no-match/date-only/contradictory rows keep null. No Student creation, merge or update." },
    { source: "adress / address", target: "raw_source_data only", rule: "Never include postal address in production candidates." },
    { source: "Bee School HQ / Ohashi", target: "organization_id / school_id on all rows", rule: "Resolve IDs by exact names in live DB; parent IDs attached transactionally by a future approved import." },
    { source: "Column1 / Origin / PC / FP / Date received / unmapped source values", target: "raw_source_data only", rule: "No guessed semantics or fabricated stable CustomerID." }
  ];
}
