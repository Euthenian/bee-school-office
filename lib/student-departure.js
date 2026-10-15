export function billingMonthFromDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value).slice(0, 7) : "";
}

export function getTokyoDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function isValidDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function isValidBillingMonth(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || "")) && Number(value.slice(0, 4)) > 0;
}

export function minimumBillingMonthFromNotice(noticeDate) {
  if (!isValidDateKey(noticeDate)) return "";
  const month = noticeDate.slice(0, 7);
  if (Number(noticeDate.slice(8, 10)) <= 15) return month;
  const nextMonth = Number(noticeDate.slice(5, 7)) + 1;
  const nextYear = Number(noticeDate.slice(0, 4)) + (nextMonth === 13 ? 1 : 0);
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth === 13 ? 1 : nextMonth).padStart(2, "0")}`;
}

export function validateDepartureConfirmation({ noticeDate, finalLessonDate, finalBillingMonth, billingProfileId, billingStartDate } = {}) {
  if (!noticeDate) return "Departure notice date is required.";
  if (!isValidDateKey(noticeDate)) return "Enter a valid departure notice date.";
  if (!finalLessonDate) return "Final lesson date is required.";
  if (!finalBillingMonth) return "Final billing month is required. Use YYYY-MM (e.g. 2026-11).";
  if (!isValidBillingMonth(finalBillingMonth)) {
    return "Final billing month must use YYYY-MM (e.g. 2026-11).";
  }
  if (!isValidDateKey(finalLessonDate)) return "Enter a valid final lesson date.";
  const minimumBillingMonth = minimumBillingMonthFromNotice(noticeDate);
  if (finalBillingMonth < minimumBillingMonth) {
    return `Final billing month must be ${minimumBillingMonth} or later under the 15th-day notice rule.`;
  }
  if (!billingProfileId) return "A valid billing profile is required. Complete Student Finance first.";
  if (billingStartDate && finalLessonDate < billingStartDate) return "Final lesson date conflicts with billing start date.";
  return "";
}
