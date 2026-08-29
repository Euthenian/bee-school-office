import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deleteTrialLesson } from "../lib/data.js";
import { removeTrialLessonById } from "../lib/trial-lessons.js";

const trialLessonsPage = readFileSync(new URL("../app/(app)/trial-lessons/page.js", import.meta.url), "utf8");
const trialLessonDeleteSql = readFileSync(
  new URL("../supabase/migrations/20260828006000_trial_lesson_delete_rpc.sql", import.meta.url),
  "utf8"
);

const deleteFunctionSql =
  trialLessonDeleteSql.match(/create or replace function public\.delete_trial_lesson_mvp[\s\S]*?revoke all on function public\.delete_trial_lesson_mvp/)?.[0] ||
  "";

test("trial lesson delete action uses confirmation before deleting", () => {
  assert.match(trialLessonsPage, /className="danger-button" onClick=\{\(\) => onRequestDelete\(trialLesson\)\} type="button">\s*Delete\s*<\/button>/);
  assert.match(trialLessonsPage, /DeleteTrialLessonDialog/);
  assert.match(trialLessonsPage, /Delete this trial lesson\?/);
  assert.match(trialLessonsPage, /This action cannot be undone\./);
  assert.match(trialLessonsPage, />\s*Cancel\s*<\/button>/);
  assert.match(trialLessonsPage, /Delete trial lesson/);
});

test("cancelling trial lesson delete closes the dialog without calling the delete RPC", () => {
  const cancelHandler =
    trialLessonsPage.match(/function handleDeleteCancel\(\) \{[\s\S]*?\n  \}/)?.[0] ||
    "";
  const cancelButton =
    trialLessonsPage.match(/<button className="secondary-button" disabled=\{deleting\} onClick=\{onCancel\} type="button">[\s\S]*?<\/button>/)?.[0] ||
    "";

  assert.match(cancelHandler, /setDeleteTarget\(null\)/);
  assert.doesNotMatch(cancelHandler, /deleteTrialLesson|delete_trial_lesson_mvp/);
  assert.match(cancelButton, />\s*Cancel\s*<\/button>/);
  assert.doesNotMatch(cancelButton, /onConfirm|deleteTrialLesson|delete_trial_lesson_mvp/);
});

test("deleteTrialLesson calls the atomic trial lesson delete RPC", async () => {
  let rpcCall;
  const supabase = {
    async rpc(name, params) {
      rpcCall = { name, params };
      return { data: { status: "deleted", trial_lesson_id: "trial-booked" }, error: null };
    }
  };

  const result = await deleteTrialLesson(supabase, "trial-booked");

  assert.deepEqual(rpcCall, {
    name: "delete_trial_lesson_mvp",
    params: { p_trial_lesson_id: "trial-booked" }
  });
  assert.equal(result.data.status, "deleted");
  assert.equal(result.error, null);
});

test("deleting a booked trial removes only that row from the Trial Lessons list", () => {
  const rows = [
    { id: "trial-booked", status: "booked" },
    { id: "trial-other", status: "booked" }
  ];

  assert.deepEqual(removeTrialLessonById(rows, "trial-booked"), [{ id: "trial-other", status: "booked" }]);
  assert.match(trialLessonsPage, /Trial lesson deleted\./);
  assert.match(trialLessonsPage, /removeTrialLessonById\(current\.trialLessons, deleteTarget\.id\)/);
});

test("trial lesson delete RPC handles foreign keys in dependency order", () => {
  const unlinkImportIndex = deleteFunctionSql.indexOf("update public.pending_trial_booking_imports");
  const deleteActionsIndex = deleteFunctionSql.indexOf("delete from public.communication_integration_actions");
  const deleteCommunicationsIndex = deleteFunctionSql.indexOf("delete from public.communications");
  const deleteTrialIndex = deleteFunctionSql.indexOf("delete from public.trial_lessons");

  assert.ok(unlinkImportIndex > -1);
  assert.ok(deleteActionsIndex > unlinkImportIndex);
  assert.ok(deleteCommunicationsIndex > deleteActionsIndex);
  assert.ok(deleteTrialIndex > deleteCommunicationsIndex);
  assert.match(deleteFunctionSql, /converted_trial_lesson_id = null/);
  assert.match(deleteFunctionSql, /review_status = 'reviewed'/);
  assert.doesNotMatch(deleteFunctionSql, /disable trigger|drop constraint/i);
});

test("authorized same-tenant managers can execute the trial lesson delete RPC", () => {
  assert.match(deleteFunctionSql, /if not public\.can_manage_school\(v_trial\.school_id\) then/);
  assert.match(deleteFunctionSql, /raise exception 'You do not have permission to delete this trial lesson\.'/);
  assert.match(trialLessonDeleteSql, /grant execute on function public\.delete_trial_lesson_mvp\(uuid\) to authenticated/);
  assert.match(trialLessonDeleteSql, /revoke all on function public\.delete_trial_lesson_mvp\(uuid\) from public, anon/);
});

test("cross-tenant trial lesson UUIDs fail before destructive delete statements run", () => {
  const permissionCheckIndex = deleteFunctionSql.indexOf("if not public.can_manage_school(v_trial.school_id) then");
  const firstMutationIndex = Math.min(
    deleteFunctionSql.indexOf("update public.pending_trial_booking_imports"),
    deleteFunctionSql.indexOf("delete from public.communication_integration_actions"),
    deleteFunctionSql.indexOf("delete from public.communications"),
    deleteFunctionSql.indexOf("delete from public.trial_lessons")
  );

  assert.ok(permissionCheckIndex > -1);
  assert.ok(firstMutationIndex > permissionCheckIndex);
  assert.match(deleteFunctionSql, /where tl\.id = p_trial_lesson_id[\s\S]*for update/);
  assert.match(deleteFunctionSql, /public\.can_manage_school\(v_trial\.school_id\)/);
});

test("anonymous users cannot call the destructive trial lesson delete RPC", () => {
  assert.match(trialLessonDeleteSql, /revoke all on function public\.delete_trial_lesson_mvp\(uuid\) from public, anon/);
  assert.doesNotMatch(trialLessonDeleteSql, /grant execute on function public\.delete_trial_lesson_mvp\(uuid\) to anon/);
  assert.doesNotMatch(trialLessonDeleteSql, /grant execute on function public\.delete_trial_lesson_mvp\(uuid\) to public/);
});

test("trial lesson delete RPC has a safe SECURITY DEFINER search path", () => {
  assert.match(deleteFunctionSql, /security definer/);
  assert.match(deleteFunctionSql, /set search_path = public, pg_temp/);
});

test("joined trial deletion removes only trial-specific records and never deletes student data", () => {
  for (const tableName of [
    "students",
    "student_contacts",
    "student_guardians",
    "student_enrollments",
    "student_notes",
    "classes",
    "student_charges",
    "student_payments",
    "student_payment_allocations",
    "student_refunds"
  ]) {
    assert.doesNotMatch(deleteFunctionSql, new RegExp(`delete from public\\.${tableName}\\b`));
  }

  assert.match(deleteFunctionSql, /delete from public\.trial_lessons/);
  assert.match(deleteFunctionSql, /from public\.trial_lesson_participants/);
  assert.match(deleteFunctionSql, /update public\.communications c\s+set trial_lesson_id = null[\s\S]*c\.student_id is not null/);
});

test("trial lesson delete RPC preserves another trial linked to the same prospect", () => {
  assert.match(
    deleteFunctionSql,
    /delete from public\.prospects pr[\s\S]*not exists \([\s\S]*from public\.trial_lessons tl[\s\S]*where tl\.prospect_id = pr\.id[\s\S]*\)/
  );
  assert.match(
    deleteFunctionSql,
    /delete from public\.prospects pr[\s\S]*not exists \([\s\S]*from public\.communications c[\s\S]*where c\.prospect_id = pr\.id[\s\S]*\)/
  );
});
