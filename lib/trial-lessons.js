import { formatClassLevel, formatLessonDay, formatLessonTime, formatLessonType, formatTeacherName, lessonTypes } from "./class-details.js";
import { formatStudentAge } from "./format.js";

export const trialLessonStatuses = [
  { value: "inquiry", label: "Inquiry" },
  { value: "booked", label: "Booked" },
  { value: "completed", label: "Completed" },
  { value: "no_show", label: "No-show" },
  { value: "cancelled", label: "Cancelled" },
  { value: "joined", label: "Joined" },
  { value: "did_not_join", label: "Did not join" }
];

export function formatTrialStatus(value) {
  return trialLessonStatuses.find((status) => status.value === value)?.label || "Unknown";
}

export const trialLessonDateFilterPresets = [
  { value: "all", label: "All dates" },
  { value: "last_7_days", label: "Last 7 days" },
  { value: "last_15_days", label: "Last 15 days" },
  { value: "last_30_days", label: "Last 30 days" },
  { value: "last_3_months", label: "Last 3 months" },
  { value: "last_6_months", label: "Last 6 months" },
  { value: "custom", label: "Custom range" },
  { value: "no_date", label: "No date" }
];

export const defaultTrialLessonColumnFilters = {
  datePreset: "all",
  dateFrom: "",
  dateTo: "",
  time: "all",
  nameSearch: "",
  ageGroup: "all",
  level: "all",
  lessonType: "all",
  teacher: "all",
  inquirySource: "all",
  status: "all"
};

export const defaultTrialLessonSort = {
  column: "trial_date",
  direction: "asc"
};

const NO_TIME = "__no_time";
const NO_AGE_GROUP = "__no_age_group";
const NO_LEVEL = "__no_level";
const NO_LESSON_TYPE = "__no_lesson_type";
const NO_TEACHER = "__no_teacher";
const NO_SOURCE = "__no_source";
const UNRESOLVED_STATUS = "unresolved";

export function formatProspectName(prospect) {
  const alphabet = prospect?.alphabet_name ? ` (${prospect.alphabet_name})` : "";
  return prospect?.japanese_name ? `${prospect.japanese_name}${alphabet}` : "Unnamed prospect";
}

export function formatParticipantName(participant) {
  const alphabet = participant?.alphabet_name ? ` (${participant.alphabet_name})` : "";
  return participant?.japanese_name ? `${participant.japanese_name}${alphabet}` : "Unnamed participant";
}

export function formatParticipantAge(participant) {
  return formatStudentAge({
    date_of_birth: participant?.date_of_birth,
    age_override: participant?.age_override
  });
}

export function getPrimaryParticipant(trialLesson) {
  return trialLesson?.trial_lesson_participants?.[0] || null;
}

export function removeTrialLessonById(trialLessons, trialLessonId) {
  return (trialLessons || []).filter((trialLesson) => trialLesson?.id !== trialLessonId);
}

export function getLocalDateKey(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

export function resetTrialLessonTableFilters() {
  return {
    columnFilters: { ...defaultTrialLessonColumnFilters },
    sort: { ...defaultTrialLessonSort }
  };
}

export function hasActiveTrialLessonColumnFilters(filters = defaultTrialLessonColumnFilters) {
  return Object.entries(defaultTrialLessonColumnFilters)
    .some(([key, value]) => (filters[key] ?? value) !== value);
}

export function hasActiveTrialLessonSort(sort = defaultTrialLessonSort) {
  return sort.column !== defaultTrialLessonSort.column || sort.direction !== defaultTrialLessonSort.direction;
}

export function getTrialLessonDisplayValues(trialLesson) {
  const participant = getPrimaryParticipant(trialLesson);
  const prospect = trialLesson?.prospects || {};
  const inquirySource = prospect.inquiry_methods?.label || "";
  const acquisitionSource = prospect.acquisition_sources?.label || "";

  return {
    trial_date: trialLesson?.trial_date || null,
    trial_time: trialLesson?.trial_time || null,
    name: [formatProspectName(prospect), participant ? formatParticipantName(participant) : ""].filter(Boolean).join(" / "),
    age_group: getParticipantAgeGroupLabel(participant),
    level: participant?.requested_level?.label || trialLesson?.class_levels?.label || null,
    lesson_type: trialLesson?.lesson_type || null,
    lesson_type_label: formatLessonType(trialLesson?.lesson_type),
    teacher_id: trialLesson?.assigned_teacher?.id || null,
    teacher: trialLesson?.assigned_teacher ? formatTeacherName(trialLesson.assigned_teacher) : null,
    inquiry_sources: [inquirySource, acquisitionSource].filter(Boolean),
    inquiry_source_label: [inquirySource, acquisitionSource].filter(Boolean).join(" / ") || null,
    status: trialLesson?.status || UNRESOLVED_STATUS
  };
}

export function buildTrialLessonColumnFilterOptions(trialLessons = []) {
  const values = trialLessons.map(getTrialLessonDisplayValues);

  return {
    times: [
      { value: "all", label: "All times" },
      ...distinctOptions(values.map((item) => item.trial_time).filter(Boolean), (value) => formatLessonTime(value)),
      { value: NO_TIME, label: "No time" }
    ],
    ageGroups: [
      { value: "all", label: "All age groups" },
      ...distinctOptions(values.map((item) => item.age_group).filter(Boolean)),
      { value: NO_AGE_GROUP, label: "No age group" }
    ],
    levels: [
      { value: "all", label: "All levels" },
      ...distinctOptions(values.map((item) => item.level).filter(Boolean)),
      { value: NO_LEVEL, label: "No level" }
    ],
    lessonTypes: [
      { value: "all", label: "All lesson types" },
      ...lessonTypes.filter((type) => values.some((item) => item.lesson_type === type.value)),
      { value: NO_LESSON_TYPE, label: "No lesson type" }
    ],
    teachers: [
      { value: "all", label: "All teachers" },
      ...distinctOptionsByValue(
        trialLessons
          .filter((trialLesson) => trialLesson.assigned_teacher?.id)
          .map((trialLesson) => ({
            value: trialLesson.assigned_teacher.id,
            label: formatTeacherName(trialLesson.assigned_teacher)
          }))
      ),
      { value: NO_TEACHER, label: "No teacher assigned" }
    ],
    inquirySources: [
      { value: "all", label: "All sources" },
      ...distinctOptions(values.flatMap((item) => item.inquiry_sources)),
      { value: NO_SOURCE, label: "No source" }
    ],
    statuses: [
      { value: "all", label: "All statuses" },
      ...trialLessonStatuses.filter((status) => values.some((item) => item.status === status.value)),
      ...(values.some((item) => item.status === UNRESOLVED_STATUS) ? [{ value: UNRESOLVED_STATUS, label: "Unresolved" }] : [])
    ]
  };
}

export function filterAndSortTrialLessons(trialLessons = [], options = {}) {
  const filters = { ...defaultTrialLessonColumnFilters, ...(options.columnFilters || {}) };
  const sort = { ...defaultTrialLessonSort, ...(options.sort || {}) };
  const today = options.today || getLocalDateKey();

  return [...trialLessons]
    .filter((trialLesson) => matchesTrialLessonColumnFilters(trialLesson, filters, today))
    .sort((left, right) => compareTrialLessons(left, right, sort));
}

export function matchesTrialLessonColumnFilters(trialLesson, filters, today = getLocalDateKey()) {
  const values = getTrialLessonDisplayValues(trialLesson);

  if (!dateMatches(values.trial_date, filters, today)) return false;
  if (!nullableValueMatches(values.trial_time, filters.time, NO_TIME)) return false;
  if (filters.nameSearch?.trim() && !values.name.toLowerCase().includes(filters.nameSearch.trim().toLowerCase())) return false;
  if (!nullableValueMatches(values.age_group, filters.ageGroup, NO_AGE_GROUP)) return false;
  if (!nullableValueMatches(values.level, filters.level, NO_LEVEL)) return false;
  if (!nullableValueMatches(values.lesson_type, filters.lessonType, NO_LESSON_TYPE)) return false;
  if (!nullableValueMatches(values.teacher_id, filters.teacher, NO_TEACHER)) return false;
  if (filters.inquirySource !== "all") {
    if (filters.inquirySource === NO_SOURCE) {
      if (values.inquiry_sources.length) return false;
    } else if (!values.inquiry_sources.includes(filters.inquirySource)) {
      return false;
    }
  }
  if (filters.status !== "all" && values.status !== filters.status) return false;

  return true;
}

export function formatTrialLevel(trialLesson) {
  return trialLesson?.class_levels?.label || "Not set";
}

export function formatParticipantAgeGroup(participant) {
  return participant?.age_group?.label || formatParticipantAge(participant);
}

export function formatTrialSchedule(trialLesson) {
  return [formatLessonDay(trialLesson?.lesson_day), formatLessonTime(trialLesson?.trial_time)]
    .filter((item) => item !== "Not set")
    .join(" ");
}

export function formatTrialClassDetails(trialLesson) {
  const participant = getPrimaryParticipant(trialLesson);
  return [
    formatClassLevel({ class_levels: trialLesson?.class_levels }, { level: participant?.requested_level?.label }),
    formatLessonType(trialLesson?.lesson_type),
    formatTrialSchedule(trialLesson)
  ]
    .filter((item) => item && item !== "Not set")
    .join(" / ");
}

function getParticipantAgeGroupLabel(participant) {
  if (!participant) return null;
  const ageGroup = participant.age_group?.label || "";
  if (ageGroup) return ageGroup;
  const age = formatParticipantAge(participant);
  return age === "\u2014" ? null : age;
}

function dateMatches(value, filters, today) {
  if (filters.datePreset === "all") return true;
  if (filters.datePreset === "no_date") return !value;
  if (!value) return false;

  const date = parseDateOnly(value);
  if (!date) return false;

  const todayDate = parseDateOnly(today);
  if (!todayDate) return false;

  if (filters.datePreset === "custom") {
    const from = parseDateOnly(filters.dateFrom);
    const to = parseDateOnly(filters.dateTo);
    const effectiveTo = to && to < todayDate ? to : todayDate;
    return (!from || date >= from) && date <= effectiveTo;
  }

  const start = dateWindowStart(filters.datePreset, todayDate);
  return Boolean(start && date >= start && date <= todayDate);
}

function dateWindowStart(preset, today) {
  if (preset === "last_7_days") return addDays(today, -6);
  if (preset === "last_15_days") return addDays(today, -14);
  if (preset === "last_30_days") return addDays(today, -29);
  if (preset === "last_3_months") return addMonths(today, -3);
  if (preset === "last_6_months") return addMonths(today, -6);
  return null;
}

function parseDateOnly(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null;
  const [year, month, day] = String(value).split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
}

function nullableValueMatches(value, filter, nullOption) {
  if (filter === "all") return true;
  if (filter === nullOption) return !value;
  return value === filter;
}

function compareTrialLessons(left, right, sort) {
  const leftValues = getTrialLessonDisplayValues(left);
  const rightValues = getTrialLessonDisplayValues(right);
  const direction = sort.direction === "desc" ? -1 : 1;
  const column = sort.column || "trial_date";

  if (column === "trial_date") return compareNullable(leftValues.trial_date, rightValues.trial_date, direction, parseDateOnly);
  if (column === "trial_time") return compareNullable(leftValues.trial_time, rightValues.trial_time, direction);
  if (column === "name") return compareNullable(leftValues.name, rightValues.name, direction, normalizeSortText);
  if (column === "age_group") return compareNullable(leftValues.age_group, rightValues.age_group, direction, normalizeSortText);
  if (column === "level") return compareNullable(leftValues.level, rightValues.level, direction, normalizeSortText);
  if (column === "lesson_type") {
    return compareNullable(
      leftValues.lesson_type ? leftValues.lesson_type_label : null,
      rightValues.lesson_type ? rightValues.lesson_type_label : null,
      direction,
      normalizeSortText
    );
  }
  if (column === "teacher") return compareNullable(leftValues.teacher, rightValues.teacher, direction, normalizeSortText);
  if (column === "inquiry_source") return compareNullable(leftValues.inquiry_source_label, rightValues.inquiry_source_label, direction, normalizeSortText);
  if (column === "status") return compareNullable(statusSortLabel(leftValues.status), statusSortLabel(rightValues.status), direction, normalizeSortText);
  return 0;
}

function compareNullable(left, right, direction, mapper = (value) => value) {
  const leftMissing = left === null || left === undefined || left === "";
  const rightMissing = right === null || right === undefined || right === "";
  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;
  const normalizedLeft = mapper(left);
  const normalizedRight = mapper(right);
  if (normalizedLeft < normalizedRight) return -1 * direction;
  if (normalizedLeft > normalizedRight) return 1 * direction;
  return 0;
}

function normalizeSortText(value) {
  return String(value || "").normalize("NFKC").toLowerCase();
}

function statusSortLabel(value) {
  if (value === UNRESOLVED_STATUS) return "Unresolved";
  return formatTrialStatus(value);
}

function distinctOptions(values, labelFor = (value) => value) {
  return distinctOptionsByValue(values.map((value) => ({ value, label: labelFor(value) })));
}

function distinctOptionsByValue(options) {
  const seen = new Set();
  return options
    .filter((option) => {
      if (!option.value || seen.has(option.value)) return false;
      seen.add(option.value);
      return true;
    })
    .sort((left, right) => normalizeSortText(left.label).localeCompare(normalizeSortText(right.label)));
}

export function createInitialParticipant(levelId = "") {
  return {
    id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    japaneseName: "",
    furigana: "",
    alphabetName: "",
    dateOfBirth: "",
    ageOverride: "",
    ageGroupLevelId: levelId,
    requestedLevelId: levelId
  };
}

export function serializeParticipants(participants) {
  return participants.map((participant) => ({
    japanese_name: participant.japaneseName.trim(),
    furigana: emptyToNull(participant.furigana),
    alphabet_name: emptyToNull(participant.alphabetName),
    date_of_birth: emptyToNull(participant.dateOfBirth),
    age_override: normalizeAgeOverride(participant.ageOverride),
    age_group_level_id: emptyToNull(participant.ageGroupLevelId),
    requested_level_id: emptyToNull(participant.requestedLevelId)
  }));
}

function emptyToNull(value) {
  if (typeof value !== "string") {
    return value ?? null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeAgeOverride(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const age = Number(value);
  return Number.isInteger(age) ? age : value;
}
