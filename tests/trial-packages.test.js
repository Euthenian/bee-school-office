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
const trialPackageLinkMigrationSql = readFileSync(
  new URL("../supabase/migrations/20260927001000_trial_package_trial_lesson_links.sql", import.meta.url),
  "utf8"
);
const trialPackageRlsFixMigrationSql = readFileSync(
  new URL("../supabase/migrations/20260927002000_fix_trial_package_school_manager_rls.sql", import.meta.url),
  "utf8"
);
const trialPackageSchedulingMigrationSql = readFileSync(
  new URL("../supabase/migrations/20260927003000_link_scheduled_trial_package_lessons.sql", import.meta.url),
  "utf8"
);
const trialPackageRescheduleMigrationSql = readFileSync(
  new URL("../supabase/migrations/20260929001000_reschedule_linked_trial_package_lessons.sql", import.meta.url),
  "utf8"
);
const trialLessonsPage = readFileSync(new URL("../app/(app)/trial-lessons/page.js", import.meta.url), "utf8");
const newTrialLessonPage = readFileSync(new URL("../app/(app)/trial-lessons/new/page.js", import.meta.url), "utf8");
const dataSource = readFileSync(new URL("../lib/data.js", import.meta.url), "utf8");
const importReviewPage = readFileSync(new URL("../app/(app)/trial-lessons/imports/review/page.js", import.meta.url), "utf8");

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

test("existing group trial lessons can create an idempotent linked 4-lesson package", () => {
  assert.match(trialPackageLinkMigrationSql, /add column if not exists trial_lesson_id uuid/);
  assert.match(
    trialPackageLinkMigrationSql,
    /foreign key \(trial_lesson_id, organization_id, school_id\)[\s\S]*references public\.trial_lessons \(id, organization_id, school_id\)/
  );
  assert.match(
    trialPackageLinkMigrationSql,
    /create unique index if not exists trial_package_lessons_trial_lesson_id_uidx[\s\S]*where trial_lesson_id is not null/
  );
  assert.match(trialPackageLinkMigrationSql, /create or replace function public\.create_trial_package_from_trial_lesson_mvp/);
  assert.match(trialPackageLinkMigrationSql, /if v_trial\.lesson_type <> 'group'::public\.class_lesson_type then/);
  assert.match(trialPackageLinkMigrationSql, /perform pg_advisory_xact_lock\(hashtext\(p_trial_lesson_id::text\), 20260927\)/);
  assert.match(trialPackageLinkMigrationSql, /where tpl\.trial_lesson_id = p_trial_lesson_id[\s\S]*return v_package_id/);
  assert.match(trialPackageLinkMigrationSql, /v_lesson_number in 1\.\.4/);
  assert.match(trialPackageLinkMigrationSql, /case when v_lesson_number = 1 then v_trial\.id else null end/);
  assert.match(trialPackageLinkMigrationSql, /case when v_lesson_number = 1 then v_trial\.trial_date else null end/);
  assert.match(trialPackageLinkMigrationSql, /case when v_lesson_number = 1 then v_trial\.trial_time else null end/);
  assert.match(trialPackageLinkMigrationSql, /else 'not_scheduled'::public\.trial_package_lesson_status/);
});

test("linked package lessons keep the original trial lesson authoritative", () => {
  assert.match(
    trialPackageLinkMigrationSql,
    /comment on column public\.trial_package_lessons\.trial_lesson_id is[\s\S]*trial_lessons remains the source of truth/
  );
  assert.match(trialPackageLinkMigrationSql, /create trigger trial_lessons_sync_package_lesson/);
  assert.match(trialPackageLinkMigrationSql, /after update of trial_date, trial_time, status/);
  assert.match(trialPackageLinkMigrationSql, /trial_package_lesson_status_from_trial_lesson_status/);
  assert.match(trialPackageLinkMigrationSql, /when 'completed' then 'completed'/);
  assert.match(trialPackageLinkMigrationSql, /when 'no_show' then 'no_show'/);
  assert.match(trialPackageLinkMigrationSql, /when 'cancelled' then 'cancelled'/);
  assert.match(trialPackageLinkMigrationSql, /else 'scheduled'/);
  assert.match(trialPackageLinkMigrationSql, /if v_lesson\.trial_lesson_id is not null then/);
  assert.match(trialLessonsPage, /Linked Trial Lesson:/);
  assert.match(trialLessonsPage, /formatTrialPackageLessonSchedule\(lesson\) \|\| "Not scheduled"/);
  assert.match(trialLessonsPage, /linkedTrialLesson \? \(/);
});

test("group Gmail import conversion creates a package while non-group conversion stays single", () => {
  assert.match(trialPackageLinkMigrationSql, /if v_lesson_type = 'group'::public\.class_lesson_type then\s+v_trial_package_id = public\.create_trial_package_from_trial_lesson_mvp\(v_trial_lesson_id\);/);
  assert.match(trialPackageLinkMigrationSql, /'trial_package_id', v_trial_package_id/);
  assert.match(trialPackageLinkMigrationSql, /Only group trial lessons can create a 4-lesson trial package/);
  assert.match(importReviewPage, /convertPendingTrialBookingImport\(supabase/);
});

test("trial lessons page exposes package creation for unlinked group lessons and keeps packages under search", () => {
  assert.match(dataSource, /rpc\("create_trial_package_from_trial_lesson_mvp"/);
  assert.match(dataSource, /trial_lesson_id/);
  assert.match(dataSource, /linked_trial_lesson:trial_lessons!trial_package_lessons_trial_lesson_id_organization_id_school_id/);
  assert.doesNotMatch(dataSource, /linked_trial_lesson:trial_lessons!trial_package_lessons_trial_lesson_id_organization_id_school_id_fkey/);
  assert.match(dataSource, /lesson\.linked_trial_lesson\?\.assigned_teacher\?\.full_name/);
  assert.match(trialLessonsPage, /createTrialPackageFromTrialLesson\(supabase, trialLesson\.id\)/);
  assert.match(trialLessonsPage, /Create 4-Lesson Trial Package/);
  assert.match(trialLessonsPage, /trialLesson\.lesson_type === "group"/);
  assert.match(trialLessonsPage, /const hasLinkedPackage = packagedTrialLessonIds\.has\(trialLesson\.id\)/);
  assert.match(trialLessonsPage, /const prospectId = getTrialLessonProspectId\(trialLesson\)/);
  assert.match(trialLessonsPage, /!hasProspectPackage/);
  assert.match(trialLessonsPage, /isPackageEligibilityLoading/);
  assert.match(dataSource, /\bprospect_id\b/);
  assert.match(trialLessonsPage, /fetchTrialPackages\(supabase, packageFilters\)/);
  assert.match(trialLessonsPage, /packageFilters = \{\s+search,/);
});

test("trial package select RLS permits insert-returning without broadening writes", () => {
  assert.match(trialPackageRlsFixMigrationSql, /drop policy if exists "trial_packages_select_visible"/);
  assert.match(
    trialPackageRlsFixMigrationSql,
    /create policy "trial_packages_select_visible"[\s\S]*for select[\s\S]*using \([\s\S]*public\.can_manage_school\(school_id\)/
  );
  assert.match(
    trialPackageRlsFixMigrationSql,
    /exists \([\s\S]*from public\.trial_package_lessons tpl[\s\S]*join public\.staff st[\s\S]*tpl\.trial_package_id = public\.trial_packages\.id[\s\S]*st\.profile_id = \(select auth\.uid\(\)\)/
  );
  assert.doesNotMatch(trialPackageRlsFixMigrationSql, /trial_packages_insert_staff/);
  assert.doesNotMatch(trialPackageRlsFixMigrationSql, /trial_package_lessons_insert_staff/);
  assert.doesNotMatch(trialPackageRlsFixMigrationSql, /with check/i);
});

test("scheduled package lesson save creates and links one canonical trial lesson", () => {
  assert.match(trialPackageSchedulingMigrationSql, /create or replace function public\.update_trial_package_lesson_mvp/);
  assert.match(trialPackageSchedulingMigrationSql, /perform pg_advisory_xact_lock\(hashtext\(p_trial_package_lesson_id::text\), 2026092703\)/);
  assert.match(trialPackageSchedulingMigrationSql, /from public\.trial_package_lessons tpl[\s\S]*for update;/);
  assert.match(trialPackageSchedulingMigrationSql, /from public\.trial_packages tp[\s\S]*for update;/);
  assert.match(trialPackageSchedulingMigrationSql, /if v_status = 'scheduled' and \(p_lesson_date is null or p_lesson_time is null\)/);
  assert.match(trialPackageSchedulingMigrationSql, /if v_status <> 'scheduled' then[\s\S]*update public\.trial_package_lessons[\s\S]*return v_lesson\.id;/);
  assert.match(trialPackageSchedulingMigrationSql, /order by tpl\.lesson_number, tpl\.created_at, tpl\.id/);
  assert.match(trialPackageSchedulingMigrationSql, /from public\.trial_lesson_participants tlp[\s\S]*where tlp\.trial_lesson_id = v_source_trial_lesson_id/);
  assert.match(trialPackageSchedulingMigrationSql, /'japanese_name', tlp\.japanese_name/);
  assert.match(trialPackageSchedulingMigrationSql, /'requested_level_id', tlp\.requested_level_id/);
  assert.match(trialPackageSchedulingMigrationSql, /select st\.profile_id into v_assigned_teacher_profile_id/);
  assert.match(trialPackageSchedulingMigrationSql, /v_assigned_teacher_profile_id = null/);
  assert.doesNotMatch(trialPackageSchedulingMigrationSql, /gen_random_uuid\(\).*assigned_teacher_profile/i);
  assert.match(trialPackageSchedulingMigrationSql, /v_trial_lesson_id = public\.create_trial_lesson_for_prospect_mvp/);
  assert.match(trialPackageSchedulingMigrationSql, /v_package\.school_id,\s+v_package\.prospect_id,\s+'\[\]'::jsonb,\s+p_lesson_date,\s+p_lesson_time,\s+v_assigned_teacher_profile_id/);
  assert.match(trialPackageSchedulingMigrationSql, /v_package\.lesson_type,\s+v_package\.level_id,\s+'booked'/);
  assert.match(trialPackageSchedulingMigrationSql, /update public\.trial_package_lessons[\s\S]*trial_lesson_id = v_trial_lesson_id[\s\S]*where id = v_lesson\.id[\s\S]*and trial_lesson_id is null/);
  assert.match(trialPackageSchedulingMigrationSql, /raise exception 'Trial package lesson % was linked by another request\. Retry the save\.'/);
});

test("linked scheduled package lessons can be rescheduled through their canonical trial lesson", () => {
  assert.match(trialLessonsPage, /const \[editingLinkedLesson, setEditingLinkedLesson\] = useState\(false\)/);
  assert.match(trialLessonsPage, /const closedPackageLessonStatuses = \["completed", "cancelled", "no_show"\]/);
  assert.match(trialLessonsPage, /const closedTrialLessonStatuses = \["completed", "joined", "did_not_join", "cancelled", "no_show"\]/);
  assert.match(trialLessonsPage, /!closedPackageLessonStatuses\.includes\(lesson\.status\)/);
  assert.match(trialLessonsPage, /!closedTrialLessonStatuses\.includes\(linkedTrialLesson\.status\)/);
  assert.match(trialLessonsPage, />\s*Reschedule\s*<\/button>/);
  assert.match(trialLessonsPage, /setDraft\(buildTrialPackageLessonDraft\(lesson\)\)/);
  assert.match(trialLessonsPage, /onClick=\{saveLesson\}/);
  assert.match(trialPackageRescheduleMigrationSql, /if v_lesson\.trial_lesson_id is not null then/);
  assert.match(trialPackageRescheduleMigrationSql, /from public\.trial_lessons tl[\s\S]*where tl\.id = v_lesson\.trial_lesson_id[\s\S]*for update;/);
  assert.match(trialPackageRescheduleMigrationSql, /raise exception 'Linked trial package lessons cannot be changed back to not scheduled/);
  assert.match(trialPackageRescheduleMigrationSql, /update public\.trial_lessons[\s\S]*trial_date = p_lesson_date[\s\S]*trial_time = p_lesson_time/);
  assert.match(trialPackageRescheduleMigrationSql, /assigned_teacher_profile_id = v_assigned_teacher_profile_id/);
  assert.match(trialPackageRescheduleMigrationSql, /status = v_trial_status/);
  assert.match(trialPackageRescheduleMigrationSql, /update public\.trial_package_lessons[\s\S]*assigned_teacher_staff_id = p_assigned_teacher_staff_id[\s\S]*notes = v_notes/);
  assert.match(trialPackageRescheduleMigrationSql, /return v_lesson\.id;/);
  assert.doesNotMatch(
    trialPackageRescheduleMigrationSql.match(/if v_lesson\.trial_lesson_id is not null then[\s\S]*?return v_lesson\.id;/)?.[0] || "",
    /create_trial_lesson_for_prospect_mvp/
  );
});
