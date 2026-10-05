const SLOT_SECONDS = 30 * 60;

function localSeconds(time) {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time || '');
  if (!match) throw new Error('Invalid school-local time.');
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || 0);
  if (hours > 23 || minutes > 59 || seconds > 59) throw new Error('Invalid school-local time.');
  return hours * 3600 + minutes * 60 + seconds;
}

function timeLabel(seconds) {
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String((seconds % 3600) / 60).padStart(2, '0')}`;
}

// Availability rows already contain school-local, occupancy-adjusted intervals.
export function generateCoachingSlots(availabilityRows) {
  const slots = [];
  for (const row of availabilityRows) {
    if (row.status !== 'calculated') continue;
    for (const interval of row.availableIntervals || []) {
      const start = localSeconds(interval.startTime);
      const end = localSeconds(interval.endTime);
      for (let slotStart = Math.ceil(start / SLOT_SECONDS) * SLOT_SECONDS;
        slotStart + SLOT_SECONDS <= end; slotStart += SLOT_SECONDS) {
        slots.push({
          staffId: row.staffId,
          coachName: row.coachName,
          schoolId: row.schoolId,
          programId: row.programId,
          date: row.date,
          timeZone: row.timeZone,
          startTime: timeLabel(slotStart),
          endTime: timeLabel(slotStart + SLOT_SECONDS)
        });
      }
    }
  }
  return slots.sort((a, b) => a.date.localeCompare(b.date) ||
    a.startTime.localeCompare(b.startTime) || a.staffId.localeCompare(b.staffId));
}
