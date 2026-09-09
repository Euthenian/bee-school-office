import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildTrialLessonColumnFilterOptions,
  defaultTrialLessonColumnFilters,
  defaultTrialLessonSort,
  filterAndSortTrialLessons,
  hasActiveTrialLessonColumnFilters,
  hasActiveTrialLessonSort,
  resetTrialLessonTableFilters
} from "../lib/trial-lessons.js";

const trialLessonsPage = readFileSync(new URL("../app/(app)/trial-lessons/page.js", import.meta.url), "utf8");
const today = "2026-09-09";

function trialLesson(id, overrides = {}) {
  return {
    id,
    trial_date: valueOrDefault(overrides, "trial_date", "2026-09-09"),
    trial_time: valueOrDefault(overrides, "trial_time", "16:30:00"),
    lesson_type: valueOrDefault(overrides, "lesson_type", "group"),
    status: valueOrDefault(overrides, "status", "booked"),
    converted_student_id: valueOrDefault(overrides, "converted_student_id", null),
    assigned_teacher: valueOrDefault(overrides, "assigned_teacher", {
      id: "teacher-a",
      full_name: "Aiko Teacher",
      email: "aiko@example.invalid"
    }),
    class_levels: valueOrDefault(overrides, "class_levels", { id: "level-a", label: "Elementary" }),
    prospects: valueOrDefault(overrides, "prospects", {
      japanese_name: "Yamada Taro",
      alphabet_name: "Taro Yamada",
      inquiry_methods: { id: "source-a", label: "Website" },
      acquisition_sources: { id: "source-b", label: "Friend" },
      prospect_contacts: []
    }),
    trial_lesson_participants: valueOrDefault(overrides, "trial_lesson_participants", [
      {
        id: `${id}-participant`,
        japanese_name: "Yamada Hanako",
        alphabet_name: "Hanako Yamada",
        age_override: 8,
        date_of_birth: null,
        converted_student_id: null,
        age_group: { id: "age-a", label: "Kids" },
        requested_level: { id: "level-a", label: "Elementary" }
      }
    ])
  };
}

function valueOrDefault(source, key, fallback) {
  return Object.hasOwn(source, key) ? source[key] : fallback;
}

function filteredIds(rows, columnFilters, sort = defaultTrialLessonSort) {
  return filterAndSortTrialLessons(rows, {
    columnFilters: { ...defaultTrialLessonColumnFilters, ...columnFilters },
    sort,
    today
  }).map((row) => row.id);
}

test("trial lesson date presets use real date windows and exclude future or missing dates", () => {
  const rows = [
    trialLesson("today", { trial_date: "2026-09-09" }),
    trialLesson("seven-day-window-start", { trial_date: "2026-09-03" }),
    trialLesson("before-seven-day-window", { trial_date: "2026-09-02" }),
    trialLesson("future", { trial_date: "2026-09-10" }),
    trialLesson("no-date", { trial_date: null })
  ];

  assert.deepEqual(filteredIds(rows, { datePreset: "last_7_days" }), ["seven-day-window-start", "today"]);
  assert.deepEqual(filteredIds(rows, { datePreset: "no_date" }), ["no-date"]);
});

test("trial lesson date filters cover 30-day, month, and custom ranges", () => {
  const rows = [
    trialLesson("thirty-day-window-start", { trial_date: "2026-08-11" }),
    trialLesson("before-thirty-day-window", { trial_date: "2026-08-10" }),
    trialLesson("three-month-window-start", { trial_date: "2026-06-09" }),
    trialLesson("before-three-month-window", { trial_date: "2026-06-08" }),
    trialLesson("future", { trial_date: "2026-10-01" })
  ];

  assert.deepEqual(filteredIds(rows, { datePreset: "last_30_days" }), ["thirty-day-window-start"]);
  assert.deepEqual(filteredIds(rows, { datePreset: "last_3_months" }), [
    "three-month-window-start",
    "before-thirty-day-window",
    "thirty-day-window-start"
  ]);
  assert.deepEqual(filteredIds(rows, { datePreset: "custom", dateFrom: "2026-08-01", dateTo: "2026-10-01" }), [
    "before-thirty-day-window",
    "thirty-day-window-start"
  ]);
});

test("trial lesson date and time sorting keep null values last", () => {
  const rows = [
    trialLesson("missing", { trial_date: null, trial_time: null }),
    trialLesson("older-late", { trial_date: "2026-08-20", trial_time: "18:00:00" }),
    trialLesson("newer-early", { trial_date: "2026-09-01", trial_time: "09:00:00" })
  ];

  assert.deepEqual(filteredIds(rows, {}, { column: "trial_date", direction: "asc" }), [
    "older-late",
    "newer-early",
    "missing"
  ]);
  assert.deepEqual(filteredIds(rows, {}, { column: "trial_date", direction: "desc" }), [
    "newer-early",
    "older-late",
    "missing"
  ]);
  assert.deepEqual(filteredIds(rows, {}, { column: "trial_time", direction: "asc" }), [
    "newer-early",
    "older-late",
    "missing"
  ]);
});

test("trial lesson name sorting and contains filter use displayed prospect and participant names", () => {
  const rows = [
    trialLesson("bravo", {
      prospects: { japanese_name: "Bravo Prospect", alphabet_name: "", inquiry_methods: null, acquisition_sources: null },
      trial_lesson_participants: [
        { id: "bravo-participant", japanese_name: "Shared Student", alphabet_name: "", requested_level: null, age_group: null }
      ]
    }),
    trialLesson("alpha", {
      prospects: { japanese_name: "Alpha Prospect", alphabet_name: "", inquiry_methods: null, acquisition_sources: null },
      trial_lesson_participants: [
        { id: "alpha-participant", japanese_name: "Needle Student", alphabet_name: "", requested_level: null, age_group: null }
      ]
    })
  ];

  assert.deepEqual(filteredIds(rows, {}, { column: "name", direction: "asc" }), ["alpha", "bravo"]);
  assert.deepEqual(filteredIds(rows, { nameSearch: "needle" }, { column: "name", direction: "asc" }), ["alpha"]);
});

test("trial lesson status and teacher column filters combine", () => {
  const rows = [
    trialLesson("joined-a", { status: "joined", assigned_teacher: { id: "teacher-a", full_name: "Aiko Teacher" } }),
    trialLesson("booked-a", { status: "booked", assigned_teacher: { id: "teacher-a", full_name: "Aiko Teacher" } }),
    trialLesson("joined-b", { status: "joined", assigned_teacher: { id: "teacher-b", full_name: "Ben Teacher" } })
  ];

  assert.deepEqual(filteredIds(rows, { status: "joined", teacher: "teacher-a" }), ["joined-a"]);
});

test("trial lesson lesson-type and no-value filters handle canonical and null data", () => {
  const typeRows = [
    trialLesson("group", { lesson_type: "group" }),
    trialLesson("private", { lesson_type: "private" }),
    trialLesson("no-type", { lesson_type: null })
  ];
  const noValueRows = [
    trialLesson("no-teacher", { assigned_teacher: null }),
    trialLesson("no-source", {
      prospects: { japanese_name: "No Source", alphabet_name: "", inquiry_methods: null, acquisition_sources: null }
    })
  ];
  const rows = [...typeRows, ...noValueRows];
  const options = buildTrialLessonColumnFilterOptions(rows);
  const noLessonType = options.lessonTypes.find((option) => option.label === "No lesson type").value;
  const noTeacher = options.teachers.find((option) => option.label === "No teacher assigned").value;
  const noSource = options.inquirySources.find((option) => option.label === "No source").value;

  assert.deepEqual(filteredIds(typeRows, { lessonType: "group" }), ["group"]);
  assert.deepEqual(filteredIds(typeRows, { lessonType: "private" }), ["private"]);
  assert.deepEqual(filteredIds(typeRows, { lessonType: noLessonType }), ["no-type"]);
  assert.deepEqual(filteredIds(noValueRows, { teacher: noTeacher }), ["no-teacher"]);
  assert.deepEqual(filteredIds(noValueRows, { inquirySource: noSource }), ["no-source"]);
});

test("trial lesson clear-all resets column filters and primary sort", () => {
  assert.equal(hasActiveTrialLessonColumnFilters({ ...defaultTrialLessonColumnFilters, lessonType: "private" }), true);
  assert.equal(hasActiveTrialLessonSort({ column: "name", direction: "desc" }), true);

  const reset = resetTrialLessonTableFilters();

  assert.deepEqual(reset.columnFilters, defaultTrialLessonColumnFilters);
  assert.deepEqual(reset.sort, defaultTrialLessonSort);
  assert.equal(hasActiveTrialLessonColumnFilters(reset.columnFilters), false);
  assert.equal(hasActiveTrialLessonSort(reset.sort), false);
  assert.match(trialLessonsPage, /Clear all filters/);
});

test("trial lesson column filters layer on fetched rows and leave actions unfiltered", () => {
  assert.match(trialLessonsPage, /filterAndSortTrialLessons\(state\.trialLessons/);
  assert.match(trialLessonsPage, /visibleTrialLessons\.map/);
  assert.match(trialLessonsPage, /mayManage \? <th>Actions<\/th> : null/);
  assert.match(trialLessonsPage, /const linkedStudentId = trialLesson\.converted_student_id \|\| convertedParticipant\?\.converted_student_id/);
  assert.match(trialLessonsPage, />\s*View student\s*</);
  assert.doesNotMatch(trialLessonsPage, /label="Actions"[\s\S]*ColumnFilterHeader/);
});
