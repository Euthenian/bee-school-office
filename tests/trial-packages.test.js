import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  formatTrialPackageLessonTeacher,
  getTrialPackageProgress,
  sortTrialPackageLessons
} from "../lib/trial-packages.js";
import { trialPackageSelect } from "../lib/data.js";

const migrationSql = readFileSync(
  new URL("../supabase/migrations/20260926001000_trial_package_tracker.sql", import.meta.url),
  "utf8"
);
const trialLessonsPage = readFileSync(new URL("../app/(app)/trial-lessons/page.js", import.meta.url), "utf8");
const newTrialLessonPage = readFileSync(new URL("../app/(app)/trial-lessons/new/page.js", import.meta.url), "utf8");
const dataSource = readFileSync(new URL("../lib/data.js", import.meta.url), "utf8");

test("trial packages are modeled as a parent package with child occurrence rows", () => {
  assert.match(migrationSql, /create table if not exists public\.trial_packages/);
  assert.match(migrationSql, /create table if not exists public\.trial_package_lessons/);
  assert.match(migrationSql, /trial_package_id uuid not null references public\.trial_packages \(id\) on delete cascade/);
  assert.match(migrationSql, /unique \(trial_package_id, lesson_number\)/);
  assert.match(migrationSql, /total_lessons smallint not null default 4/);
  assert.doesNotMatch(migrationSql, /insert into public\.trial_lessons/);
});

test("trial package lessons use staff-based teacher assignment", () => {
  assert.match(migrationSql, /assigned_teacher_staff_id uuid/);
  assert.match(migrationSql, /references public\.staff \(id, organization_id\)/);
  assert.match(migrationSql, /has_active_staff_teacher_staff_assignment\(new\.school_id, new\.assigned_teacher_staff_id\)/);
  assert.match(trialPackageSelect, /assigned_teacher_staff_id/);
  assert.match(trialPackageSelect, /assigned_teacher_staff:staff!trial_package_lessons_teacher_staff_id_organization_id_fkey/);
  assert.doesNotMatch(trialPackageSelect, /assigned_teacher:profiles!trial_package/);
});

test("trial package lifecycle completion is derived from completed child lessons only", () => {
  assert.match(migrationSql, /create or replace function public\.refresh_trial_package_progress/);
  assert.match(migrationSql, /tpl\.status = 'completed'/);
  assert.match(migrationSql, /when v_completed_count >= v_package\.total_lessons then 'completed'/);
  assert.match(migrationSql, /else 'active'::public\.trial_package_status/);
  assert.match(migrationSql, /drop trigger if exists trial_package_lessons_refresh_package/);
});

test("trial package helpers expose progress, next lesson, and teacher display", () => {
  const trialPackage = {
    total_lessons: 4,
    trial_package_lessons: [
      { id: "lesson-3", lesson_number: 3, status: "not_scheduled" },
      { id: "lesson-1", lesson_number: 1, status: "completed" },
      {
        id: "lesson-2",
        lesson_number: 2,
        status: "scheduled",
        lesson_date: "2026-10-01",
        lesson_time: "16:30:00",
        assigned_teacher_staff: { display_name: "Aiko Teacher", legal_name: "Aiko Legal", email: "aiko@example.invalid" }
      },
      { id: "lesson-4", lesson_number: 4, status: "not_scheduled" }
    ]
  };

  assert.deepEqual(sortTrialPackageLessons(trialPackage.trial_package_lessons).map((lesson) => lesson.id), [
    "lesson-1",
    "lesson-2",
    "lesson-3",
    "lesson-4"
  ]);

  const progress = getTrialPackageProgress(trialPackage);
  assert.equal(progress.completed, 1);
  assert.equal(progress.total, 4);
  assert.equal(progress.unscheduled, 2);
  assert.equal(progress.nextLesson.id, "lesson-2");
  assert.equal(progress.nextScheduledLesson.id, "lesson-2");
  assert.equal(progress.label, "1 / 4 completed");
  assert.equal(formatTrialPackageLessonTeacher(progress.nextLesson), "Aiko Teacher");

  const laterScheduledProgress = getTrialPackageProgress({
    total_lessons: 4,
    trial_package_lessons: [
      { id: "lesson-1", lesson_number: 1, status: "completed" },
      { id: "lesson-2", lesson_number: 2, status: "not_scheduled" },
      { id: "lesson-3", lesson_number: 3, status: "scheduled", lesson_date: "2026-10-03", lesson_time: "15:00:00" },
      { id: "lesson-4", lesson_number: 4, status: "not_scheduled" }
    ]
  });
  assert.equal(laterScheduledProgress.nextLesson.id, "lesson-2");
  assert.equal(laterScheduledProgress.nextScheduledLesson.id, "lesson-3");
});

test("trial package UI is integrated into existing trial lesson pages", () => {
  assert.match(newTrialLessonPage, /4-lesson group trial package/);
  assert.match(newTrialLessonPage, /createTrialPackage\(supabase/);
  assert.match(newTrialLessonPage, /assignedTeacherStaffId/);
  assert.match(trialLessonsPage, /function TrialPackageTracker/);
  assert.match(trialLessonsPage, /fetchTrialPackages\(supabase, packageFilters\)/);
  assert.match(trialLessonsPage, /updateTrialPackageLesson\(supabase/);
  assert.match(trialLessonsPage, /updateTrialPackageStatus\(supabase/);
  assert.match(dataSource, /rpc\("create_trial_package_mvp"/);
  assert.match(dataSource, /rpc\("update_trial_package_lesson_mvp"/);
});
