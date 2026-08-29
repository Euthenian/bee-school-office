import { formatClassLevel, formatLessonDay, formatLessonTime, formatLessonType } from "./class-details.js";
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
