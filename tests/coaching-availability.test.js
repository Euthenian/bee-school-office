import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { calculateCoachingAvailability } from "../lib/coaching-availability.js";

const monday = "2026-10-05";
const pedro = { id: "pedro", name: "Pedro", status: "active", assignmentStatus: "active",
  enabled: true, programIds: ["kids", "icao"] };
const other = { id: "other", name: "Other Coach", status: "active", assignmentStatus: "active",
  enabled: true, programIds: ["kids"] };

function facts(overrides = {}) {
  return {
    schoolId: "ohashi", timeZone: "Asia/Tokyo", programId: "kids",
    startDate: monday, endDate: monday,
    coaches: [pedro],
    windows: [{ staffId: "pedro", weekday: 0, startTime: "12:00", endTime: "21:00" }],
    blocks: [], regularLessons: [], trialLessons: [], packageLessons: [],
    ...overrides
  };
}

function intervals(overrides = {}) {
  return calculateCoachingAvailability(facts(overrides))[0]?.availableIntervals;
}

const range = (startTime, endTime) => ({ startTime, endTime });
const regular = (overrides = {}) => ({ staffId: "pedro", classId: "class-1", weekday: 0,
  startTime: "18:00", durationMinutes: 50, ...overrides });

test("disabled and wrong-program Coaches are excluded", () => {
  assert.deepEqual(calculateCoachingAvailability(facts({ coaches: [{ ...pedro, enabled: false }] })), []);
  assert.deepEqual(calculateCoachingAvailability(facts({ programId: "eiken" })), []);
  assert.deepEqual(calculateCoachingAvailability(facts({ programId: "icao" })).map((row) => row.staffId), ["pedro"]);
  assert.deepEqual(calculateCoachingAvailability(facts({ coaches: [{ ...pedro, assignmentStatus: "inactive" }] })), []);
});

test("local Monday window is returned; Friday and Sunday without windows are empty", () => {
  assert.deepEqual(intervals(), [range("12:00", "21:00")]);
  for (const date of ["2026-10-09", "2026-10-11"]) {
    const row = calculateCoachingAvailability(facts({ startDate: date, endDate: date }))[0];
    assert.equal(row.date, date);
    assert.equal(row.timeZone, "Asia/Tokyo");
    assert.equal(row.status, "no_recurring_availability");
    assert.deepEqual(row.availableIntervals, []);
  }
});

test("one-off blocks split, clip, cover, overlap, and adjoin without zero-length intervals", () => {
  const block = (startTime, endTime) => ({ staffId: "pedro", localDate: monday, startTime, endTime });
  assert.deepEqual(intervals({ blocks: [block("15:00", "16:30")] }),
    [range("12:00", "15:00"), range("16:30", "21:00")]);
  assert.deepEqual(intervals({ blocks: [block("11:00", "13:00"), block("20:00", "22:00")] }),
    [range("13:00", "20:00")]);
  assert.deepEqual(intervals({ blocks: [block("11:00", "22:00")] }), []);
  assert.deepEqual(intervals({ blocks: [block("15:00", "16:00"), block("16:00", "17:00"), block("16:30", "18:00")] }),
    [range("12:00", "15:00"), range("18:00", "21:00")]);
});

test("confirmed Coaching reservations subtract occupied time; cancelled ones do not", () => {
  const confirmed = { staffId: "pedro", localDate: monday, startTime: "14:00", endTime: "14:30" };
  assert.deepEqual(intervals({ coachingReservations: [confirmed] }),
    [range("12:00", "14:00"), range("14:30", "21:00")]);
  assert.deepEqual(intervals({ coachingReservations: [] }), [range("12:00", "21:00")]);
});

test("regular Bee occupancy subtracts by Coach and class, including multiple lessons", () => {
  assert.deepEqual(intervals({ regularLessons: [regular()] }),
    [range("12:00", "18:00"), range("18:50", "21:00")]);
  assert.deepEqual(intervals({ regularLessons: [regular(), regular()] }),
    [range("12:00", "18:00"), range("18:50", "21:00")]);
  assert.deepEqual(intervals({ regularLessons: [regular(), regular({ durationMinutes: 60 })] }),
    [range("12:00", "18:00"), range("19:00", "21:00")]);
  assert.deepEqual(intervals({ regularLessons: [regular(), regular({ classId: "class-2", startTime: "18:50", durationMinutes: 40 })] }),
    [range("12:00", "18:00"), range("19:30", "21:00")]);
  assert.deepEqual(intervals({ regularLessons: [regular({ staffId: "other" })] }),
    [range("12:00", "21:00")]);
});

test("another Coach keeps independent windows and teacher occupancy", () => {
  const rows = calculateCoachingAvailability(facts({
    coaches: [pedro, other],
    windows: [...facts().windows, { staffId: "other", weekday: 0, startTime: "14:00", endTime: "17:00" }],
    regularLessons: [regular()]
  }));
  assert.deepEqual(rows.map((row) => [row.staffId, row.availableIntervals]), [
    ["pedro", [range("12:00", "18:00"), range("18:50", "21:00")]],
    ["other", [range("14:00", "17:00")]]
  ]);
});

test("missing regular duration and undetermined trial/package durations fail closed explicitly", () => {
  const sources = [
    [{ regularLessons: [regular({ durationMinutes: null })] }, "regular_class_duration"],
    [{ trialLessons: [{ staffId: "pedro", localDate: monday }] }, "trial_lesson_duration"],
    [{ packageLessons: [{ staffId: "pedro", localDate: monday }] }, "package_lesson_duration"]
  ];
  for (const [input, reason] of sources) {
    const row = calculateCoachingAvailability(facts(input))[0];
    assert.equal(row.status, "unresolved_occupancy");
    assert.deepEqual(row.availableIntervals, []);
    assert.deepEqual(row.unresolvedSources, [reason]);
  }
  assert.deepEqual(intervals({ regularLessons: [regular({ staffId: null, durationMinutes: null })] }),
    [range("12:00", "21:00")]);
});

test("school-local dates determine weekday and enrollment effective dates", () => {
  const rows = calculateCoachingAvailability(facts({
    startDate: "2026-10-05", endDate: "2026-10-06",
    windows: [...facts().windows, { staffId: "pedro", weekday: 1, startTime: "12:00", endTime: "21:00" }],
    regularLessons: [regular({ startDate: "2026-10-06" })]
  }));
  assert.deepEqual(rows.map((row) => row.availableIntervals),
    [[range("12:00", "21:00")], [range("12:00", "21:00")]]);
});

test("a prior-day class crossing midnight occupies the next local day", () => {
  const row = calculateCoachingAvailability(facts({
    startDate: "2026-10-06", endDate: "2026-10-06",
    windows: [{ staffId: "pedro", weekday: 1, startTime: "00:00", endTime: "01:00" }],
    regularLessons: [regular({ startTime: "23:45", durationMinutes: 30 })]
  }))[0];
  assert.deepEqual(row.availableIntervals, [range("00:15", "01:00")]);
});

test("RPC is internal, read-only, school-scoped, and never returns student billing details", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261005001000_internal_coaching_availability_facts.sql", import.meta.url), "utf8");
  assert.match(sql, /public\.can_manage_staff_org\(v_school\.organization_id\).*public\.can_manage_school\(p_school_id\)/);
  assert.match(sql, /revoke all on function public\.get_internal_coaching_availability_facts[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.get_internal_coaching_availability_facts[\s\S]*to authenticated/);
  assert.match(sql, /student_billing_profiles sbp/);
  assert.doesNotMatch(sql, /\b(insert into|update public\.|delete from|grant execute[^;]*to anon)\b/i);
});
