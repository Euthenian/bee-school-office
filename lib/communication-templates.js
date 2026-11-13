import { formatLessonTime, formatLessonType, formatTeacherName } from "./class-details.js";
import { groupStudentContacts } from "./contacts.js";
import { formatDate, formatPersonName } from "./format.js";
import { formatParticipantName, formatProspectName, getPrimaryParticipant } from "./trial-lessons.js";

export const communicationMessageTypes = [
  {
    value: "trial_lesson_confirmation",
    label: "Trial lesson confirmation",
    templateKey: "trial_lesson_confirmation"
  },
  {
    value: "trial_reminder",
    label: "Trial reminder",
    templateKey: "trial_reminder"
  },
  {
    value: "no_show_follow_up",
    label: "No-show follow-up",
    templateKey: "no_show_follow_up"
  },
  {
    value: "schedule_change",
    label: "Schedule change",
    templateKey: "schedule_change"
  },
  {
    value: "welcome_enrollment",
    label: "Welcome / enrollment",
    templateKey: "welcome_enrollment"
  },
  {
    value: "payment_information",
    label: "Payment information",
    templateKey: "payment_information"
  },
  {
    value: "general_message",
    label: "General message",
    templateKey: "general_message"
  },
  {
    value: "custom",
    label: "Custom",
    templateKey: ""
  }
];

export const communicationTemplates = {
  trial_lesson_confirmation: {
    subject: "【BEE SCHOOL】体験レッスンご予約確認",
    body: `{{student_japanese_name}}様

この度は体験レッスンにお申し込みいただき、ありがとうございます。

{{confirmed_date_jp}}（{{confirmed_weekday_jp}}）{{confirmed_time}}～にて、{{course_name}}の体験レッスンをご予約いたしました。

当日、お待ちしております。
どうぞお気をつけてお越しくださいませ。

よろしくお願いいたします。

BEE SCHOOL`
  },
  trial_reminder: {
    subject: "Bee School trial lesson reminder - {{confirmed_date}} {{confirmed_time}}",
    body: `Hello {{recipient_name}},

This is a reminder for the upcoming Bee School trial lesson.

Student: {{student_name}}
Date: {{confirmed_date}}
Time: {{confirmed_time}}
School: {{school_name}}

Bee School`
  },
  no_show_follow_up: {
    subject: "Bee School trial lesson follow-up",
    body: `Hello {{recipient_name}},

We missed you at the scheduled Bee School trial lesson.

Please reply when you would like to rebook, or call us if you prefer to arrange a new time by phone.

Bee School`
  },
  schedule_change: {
    subject: "Bee School schedule update",
    body: `Hello {{recipient_name}},

We are writing with an update about your Bee School schedule.

Bee School`
  },
  welcome_enrollment: {
    subject: "Welcome to Bee School",
    body: `Hello {{recipient_name}},

Welcome to Bee School. We are happy to have {{student_name}} join us.

Bee School`
  },
  payment_information: {
    subject: "Bee School payment information",
    body: `Hello {{recipient_name}},

Here is the Bee School payment information you requested.

Bee School`
  },
  general_message: {
    subject: "Bee School",
    body: `Hello {{recipient_name}},


Bee School`
  }
};

export function getCommunicationMessageType(value) {
  return communicationMessageTypes.find((type) => type.value === value) || communicationMessageTypes.at(-1);
}

export function buildCommunicationDraft(messageType, context = {}) {
  const type = getCommunicationMessageType(messageType);
  const template = type.templateKey ? communicationTemplates[type.templateKey] : null;

  return {
    communicationType: type.value,
    templateKey: type.templateKey,
    subject: template ? renderTemplate(template.subject, context) : "",
    body: template ? renderTemplate(template.body, context) : ""
  };
}

export function renderTemplate(template, context = {}) {
  return String(template || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    const value = context[key];
    return value === null || value === undefined ? "" : String(value);
  });
}

export function buildStudentCommunicationContext(student) {
  const studentName = formatPersonName(student);

  return {
    recipient_name: studentName,
    student_name: studentName,
    prospect_name: "",
    confirmed_date: "",
    confirmed_time: "",
    school_name: student?.schools?.name || "Bee School",
    lesson_type: "",
    teacher: ""
  };
}

export function buildTrialLessonCommunicationContext(trialLesson) {
  const prospect = trialLesson?.prospects;
  const participant = getPrimaryParticipant(trialLesson);
  const prospectName = formatProspectName(prospect);
  const studentName = participant ? formatParticipantName(participant) : prospectName;
  const dateParts = formatJapaneseTrialDate(trialLesson?.trial_date);
  const bookingImport = Array.isArray(trialLesson?.booking_import)
    ? trialLesson.booking_import[0]
    : trialLesson?.booking_import;

  return {
    recipient_name: prospectName,
    prospect_name: prospectName,
    student_name: studentName,
    student_japanese_name: participant?.japanese_name?.trim() || prospect?.japanese_name?.trim() || studentName,
    confirmed_date: formatDate(trialLesson?.trial_date),
    confirmed_date_jp: dateParts.date,
    confirmed_weekday_jp: dateParts.weekday,
    confirmed_time: formatLessonTime(trialLesson?.trial_time),
    course_name: bookingImport?.course?.trim() || trialLesson?.class_levels?.label || "",
    school_name: trialLesson?.schools?.name || "Bee School",
    lesson_type: formatLessonType(trialLesson?.lesson_type),
    teacher: formatTeacherName(trialLesson?.assigned_teacher)
  };
}

function formatJapaneseTrialDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").slice(0, 10));
  if (!match) return { date: "", weekday: "" };

  const date = new Date(`${match[0]}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return { date: "", weekday: "" };
  const parts = new Intl.DateTimeFormat("ja-JP", {
    day: "numeric", month: "numeric", timeZone: "Asia/Tokyo"
  }).formatToParts(date);
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return {
    date: `${month}月${day}日`,
    weekday: new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", weekday: "short" }).format(date)
  };
}

export function getDefaultStudentEmail(student) {
  const groups = groupStudentContacts(student?.student_contacts || []);
  return groups.emails[0]?.value || "";
}

export function getDefaultTrialLessonEmail(trialLesson) {
  return getPreferredContactValue(trialLesson?.prospects?.prospect_contacts || [], "email");
}

export function getDefaultTrialLessonPhone(trialLesson) {
  return getPreferredContactValue(trialLesson?.prospects?.prospect_contacts || [], "phone");
}

function getPreferredContactValue(contacts, type) {
  return [...contacts]
    .filter((contact) => contact.contact_type === type && contact.value)
    .sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)))[0]?.value || "";
}
