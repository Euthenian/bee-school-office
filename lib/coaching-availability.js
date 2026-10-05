const DAY_SECONDS = 24 * 60 * 60;

function localDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) throw new Error("Use a YYYY-MM-DD school-local date.");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error("Invalid school-local date.");
  }
  return date;
}

function dateLabel(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function seconds(time) {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time || "");
  if (!match) throw new Error("Invalid local time.");
  const [, hours, minutes, remainingSeconds] = match.map(Number);
  if (hours > 23 || minutes > 59 || (remainingSeconds || 0) > 59) throw new Error("Invalid local time.");
  return hours * 3600 + minutes * 60 + (remainingSeconds || 0);
}

function timeLabel(value) {
  const hours = String(Math.floor(value / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((value % 3600) / 60)).padStart(2, "0");
  const remainder = value % 60;
  return `${hours}:${minutes}${remainder ? `:${String(remainder).padStart(2, "0")}` : ""}`;
}

function normalized(intervals) {
  const sorted = intervals.filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const result = [];
  for (const [start, end] of sorted) {
    const last = result.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else result.push([start, end]);
  }
  return result;
}

function subtract(windows, occupied) {
  let available = normalized(windows);
  for (const [blockStart, blockEnd] of normalized(occupied)) {
    available = available.flatMap(([start, end]) => {
      if (blockEnd <= start || blockStart >= end) return [[start, end]];
      return [[start, Math.min(end, blockStart)], [Math.max(start, blockEnd), end]]
        .filter(([partStart, partEnd]) => partEnd > partStart);
    });
  }
  return available;
}

function effectiveOn(date, start, end) {
  return (!start || start <= date) && (!end || end >= date);
}

// All dates and times in the input are wall-clock values for facts.timeZone.
// Date.UTC is used only for calendar arithmetic; no instant is converted to UTC.
export function calculateCoachingAvailability(facts) {
  const start = localDate(facts.startDate);
  const end = localDate(facts.endDate);
  if (end < start || (end - start) / 86400000 > 30) throw new Error("Date range must be at most 31 days.");
  if (!facts.schoolId || !facts.timeZone || !facts.programId) throw new Error("School, timezone, and program are required.");

  const result = [];
  for (const coach of facts.coaches || []) {
    if (coach.status !== "active" || coach.assignmentStatus !== "active" || !coach.enabled ||
      !coach.programIds?.includes(facts.programId)) continue;

    for (let day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
      const date = dateLabel(day);
      if (!effectiveOn(date, coach.employmentStartDate, coach.employmentEndDate) ||
        !effectiveOn(date, coach.assignmentStartDate, coach.assignmentEndDate)) continue;

      const weekday = (day.getUTCDay() + 6) % 7;
      const windows = (facts.windows || [])
        .filter((row) => row.staffId === coach.id && row.weekday === weekday)
        .map((row) => [seconds(row.startTime), seconds(row.endTime)]);
      const base = normalized(windows);
      const unresolvedSources = new Set();
      const occupied = (facts.blocks || [])
        .filter((row) => row.staffId === coach.id && row.localDate === date)
        .map((row) => [seconds(row.startTime), seconds(row.endTime)]);

      occupied.push(...(facts.coachingReservations || [])
        .filter((row) => row.staffId === coach.id && row.localDate === date)
        .map((row) => [seconds(row.startTime), seconds(row.endTime)]));

      // A class is one schedule slot; multiple students may share it. Keep the
      // longest known lesson for this coach/class, and fail closed on any gap.
      const classIntervals = new Map();
      for (const offset of [0, -1]) {
        const lessonDay = new Date(day);
        lessonDay.setUTCDate(lessonDay.getUTCDate() + offset);
        const lessonDate = dateLabel(lessonDay);
        const lessonWeekday = (lessonDay.getUTCDay() + 6) % 7;
        for (const lesson of facts.regularLessons || []) {
          if (lesson.staffId !== coach.id || lesson.weekday !== lessonWeekday ||
            !effectiveOn(lessonDate, lesson.startDate, lesson.endDate)) continue;
          const duration = Number(lesson.durationMinutes);
          if (lesson.durationMinutes == null || !Number.isInteger(duration) || duration <= 0 || duration > 1440) {
            unresolvedSources.add("regular_class_duration");
            continue;
          }
          const begin = seconds(lesson.startTime) + offset * DAY_SECONDS;
          const finish = begin + duration * 60;
          if (finish <= 0 || begin >= DAY_SECONDS) continue;
          const key = `${lesson.classId}:${offset}`;
          const previous = classIntervals.get(key);
          classIntervals.set(key, previous ? [begin, Math.max(previous[1], finish)] : [begin, finish]);
        }
      }
      for (const [begin, finish] of classIntervals.values()) occupied.push([begin, finish]);

      if ((facts.trialLessons || []).some((row) => row.staffId === coach.id && row.localDate === date)) {
        unresolvedSources.add("trial_lesson_duration");
      }
      if ((facts.packageLessons || []).some((row) => row.staffId === coach.id && row.localDate === date)) {
        unresolvedSources.add("package_lesson_duration");
      }

      const status = unresolvedSources.size ? "unresolved_occupancy" :
        !base.length ? "no_recurring_availability" : "calculated";
      result.push({
        staffId: coach.id,
        coachName: coach.name,
        schoolId: facts.schoolId,
        timeZone: facts.timeZone,
        programId: facts.programId,
        date,
        status,
        unresolvedSources: [...unresolvedSources],
        availableIntervals: status === "calculated"
          ? subtract(base, occupied).map(([begin, finish]) => ({ startTime: timeLabel(begin), endTime: timeLabel(finish) }))
          : []
      });
    }
  }
  return result;
}
