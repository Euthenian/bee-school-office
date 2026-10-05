import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateCoachingAvailability } from '../lib/coaching-availability.js';
import { fetchInternalCoachingSlots } from '../lib/coaching-availability-data.js';
import { generateCoachingSlots } from '../lib/coaching-slots.js';

const monday = '2026-10-05';
const pedro = { id: 'pedro', name: 'Pedro', status: 'active', assignmentStatus: 'active',
  enabled: true, programIds: ['kids', 'icao'] };

function facts(overrides = {}) {
  return {
    schoolId: 'ohashi', timeZone: 'Asia/Tokyo', programId: 'kids',
    startDate: monday, endDate: monday, coaches: [pedro],
    windows: [{ staffId: 'pedro', weekday: 0, startTime: '12:00', endTime: '18:00' }],
    blocks: [], regularLessons: [], trialLessons: [], packageLessons: [],
    ...overrides
  };
}

function slots(overrides = {}) {
  return generateCoachingSlots(calculateCoachingAvailability(facts(overrides)));
}

function times(rows) {
  return rows.map((row) => `${row.startTime}-${row.endTime}`);
}

function window(startTime, endTime, weekday = 0, staffId = 'pedro') {
  return { staffId, weekday, startTime, endTime };
}

test('full 12:00-18:00 window yields twelve contained half-hour slots', () => {
  const result = slots();
  assert.equal(result.length, 12);
  assert.deepEqual(times(result), Array.from({ length: 12 }, (_, index) => {
    const start = 12 * 60 + index * 30;
    const label = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    return `${label(start)}-${label(start + 30)}`;
  }));
  assert.deepEqual(result[0], { staffId: 'pedro', coachName: 'Pedro', schoolId: 'ohashi',
    programId: 'kids', date: monday, timeZone: 'Asia/Tokyo', startTime: '12:00', endTime: '12:30' });
});

test('18:50-21:00 starts at 19:00; partial edges never become slots', () => {
  assert.deepEqual(times(slots({ windows: [window('18:50', '21:00')] })),
    ['19:00-19:30', '19:30-20:00', '20:00-20:30', '20:30-21:00']);
  assert.deepEqual(times(slots({ windows: [window('12:10', '13:10')] })), ['12:30-13:00']);
  assert.deepEqual(times(slots({ windows: [window('12:29:59', '13:00')] })), ['12:30-13:00']);
});

test('short intervals produce no slots and exact half-hours produce one', () => {
  assert.deepEqual(slots({ windows: [window('12:00', '12:29')] }), []);
  assert.deepEqual(times(slots({ windows: [window('12:30', '13:00')] })), ['12:30-13:00']);
  assert.deepEqual(slots({ windows: [window('12:10', '12:40')] }), []);
});

test('both available intervals on one date contribute slots', () => {
  assert.deepEqual(times(slots({ windows: [window('12:00', '13:00'), window('18:50', '20:00')] })),
    ['12:00-12:30', '12:30-13:00', '19:00-19:30', '19:30-20:00']);
});

test('confirmed Coaching booking disappears from slots and cancellation releases it', () => {
  const reservation = { staffId: 'pedro', localDate: monday,
    startTime: '14:00', endTime: '14:30' };
  const booked = slots({ coachingReservations: [reservation] });
  assert.equal(booked.length, 11);
  assert.equal(times(booked).includes('14:00-14:30'), false);
  assert.equal(times(slots({ coachingReservations: [] })).includes('14:00-14:30'), true);
});

test('disabled and unqualified Coaches have no slots', () => {
  assert.deepEqual(slots({ coaches: [{ ...pedro, enabled: false }] }), []);
  assert.deepEqual(slots({ programId: 'eiken' }), []);
  assert.equal(slots({ programId: 'icao' }).length, 12);
});

test('Friday and Sunday without recurring windows have no slots', () => {
  for (const date of ['2026-10-09', '2026-10-11']) {
    assert.deepEqual(slots({ startDate: date, endDate: date }), []);
  }
});

test('one-off blocks and Bee occupancy remove affected grid slots', () => {
  assert.deepEqual(times(slots({
    blocks: [{ staffId: 'pedro', localDate: monday, startTime: '12:45', endTime: '13:15' }],
    windows: [window('12:00', '14:00')]
  })), ['12:00-12:30', '13:30-14:00']);

  assert.deepEqual(times(slots({
    windows: [window('17:00', '21:00')],
    regularLessons: [{ staffId: 'pedro', classId: 'class-1', weekday: 0,
      startTime: '18:00', durationMinutes: 50 }]
  })), ['17:00-17:30', '17:30-18:00', '19:00-19:30',
    '19:30-20:00', '20:00-20:30', '20:30-21:00']);
});

test('unresolved occupancy exposes zero slots even if intervals are supplied', () => {
  const row = calculateCoachingAvailability(facts({
    trialLessons: [{ staffId: 'pedro', localDate: monday }]
  }))[0];
  assert.equal(row.status, 'unresolved_occupancy');
  assert.deepEqual(generateCoachingSlots([{ ...row, availableIntervals: [
    { startTime: '12:00', endTime: '18:00' }
  ] }]), []);
  assert.deepEqual(slots({ regularLessons: [{ staffId: 'pedro', classId: 'class-1',
    weekday: 0, startTime: '14:00', durationMinutes: null }] }), []);
});

test('two qualified Coaches remain separate at the same clock time', () => {
  const second = { ...pedro, id: 'coach-b', name: 'Coach B' };
  const result = slots({ coaches: [pedro, second],
    windows: [window('17:00', '17:30'), window('17:00', '17:30', 0, 'coach-b')] });
  assert.deepEqual(result.map((row) => [row.startTime, row.staffId]),
    [['17:00', 'coach-b'], ['17:00', 'pedro']]);
});

test('school-local JST dates determine weekdays across UTC date boundaries', () => {
  const result = slots({ startDate: '2026-10-06', endDate: '2026-10-06',
    windows: [window('00:00', '01:00', 1)] });
  assert.deepEqual(times(result), ['00:00-00:30', '00:30-01:00']);
  assert.equal(result[0].date, '2026-10-06');
  assert.equal(result[0].timeZone, 'Asia/Tokyo');
});

test('fetch helper uses existing RPC and returns slots or upstream errors', async () => {
  const input = facts();
  const calls = [];
  const supabase = { rpc: async (name, params) => {
    calls.push([name, params]);
    return { data: input, error: null };
  } };
  const options = { schoolId: 'ohashi', programId: 'kids', startDate: monday };
  const result = await fetchInternalCoachingSlots(supabase, options);
  assert.equal(result.error, null);
  assert.equal(result.data.length, 12);
  assert.deepEqual(calls, [['get_internal_coaching_availability_with_reservations', {
    p_school_id: 'ohashi', p_program_id: 'kids', p_start_date: monday, p_end_date: monday
  }]]);

  const error = new Error('Access denied');
  const failed = await fetchInternalCoachingSlots({ rpc: async () => ({ data: null, error }) }, options);
  assert.deepEqual(failed, { data: [], error });
});
