import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deleteTrialLessons } from "../lib/data.js";

const trialLessonsPage = readFileSync(new URL("../app/(app)/trial-lessons/page.js", import.meta.url), "utf8");
const bulkDeleteSql = readFileSync(
  new URL("../supabase/migrations/20260909001000_trial_lesson_bulk_delete_rpc.sql", import.meta.url),
  "utf8"
);

test("bulk selection is ID-based and visible-rows-aware", () => {
  assert.ok(trialLessonsPage.includes("const [selectedTrialLessonIds, setSelectedTrialLessonIds] = useState(() => new Set());"));
  assert.ok(trialLessonsPage.includes("const ids = [...deletingIds];"));
  assert.ok(trialLessonsPage.includes("const validSelectedTrialLessonIds = useMemo(() => {"));
  assert.ok(trialLessonsPage.includes("state.trialLessons.filter((trialLesson) => validSelectedTrialLessonIds.has(trialLesson.id)),\n    [state.trialLessons, validSelectedTrialLessonIds]"));
  assert.ok(trialLessonsPage.includes("const selectedTrialLessonCount = validSelectedTrialLessonIds.size;"));
  assert.ok(trialLessonsPage.includes("visibleSelectedTrialLessonCount"));
  assert.ok(trialLessonsPage.includes("for (const lesson of visibleTrialLessons)"));
});

test("select-all checkbox only targets filtered visible rows", () => {
  assert.ok(
    trialLessonsPage.includes('aria-label="Select all visible trial lessons"') &&
      trialLessonsPage.includes("onChange={toggleSelectAllVisible}")
  );
  assert.ok(trialLessonsPage.includes("allVisibleSelected"));
  assert.ok(trialLessonsPage.includes("selectedTrialLessonCount = validSelectedTrialLessonIds.size;"));
});

test("row selection stays stable across sorts and filters", () => {
  assert.ok(trialLessonsPage.includes("validSelectedTrialLessonIds.has(trialLesson.id)"));
  assert.ok(trialLessonsPage.includes("onSelectionChange={setTrialLessonSelection}"));
  assert.ok(trialLessonsPage.includes("onChange={(event) => onSelectionChange(trialLesson.id, event.target.checked)}"));
  assert.ok(trialLessonsPage.includes("selectedTrialLessons = useMemo("));
});

test("selection bar appears when rows are selected and exposes bulk actions", () => {
  assert.ok(trialLessonsPage.includes("selectedTrialLessonCount > 0 && mayManage ? ("));
  assert.ok(trialLessonsPage.includes("onClick={handleBulkEmailOpen}"));
  assert.ok(trialLessonsPage.includes("Delete {selectedTrialLessonCount}"));
  assert.ok(trialLessonsPage.includes("Clear selection"));
});

test("bulk delete dialog confirms selected count and irreversible action", () => {
  assert.ok(trialLessonsPage.includes("Delete {deleteCount} selected Trial Lessons?"));
  assert.ok(trialLessonsPage.includes("This action cannot be undone."));
  assert.ok(trialLessonsPage.includes("<BulkDeleteTrialLessonDialog"));
});

test("bulk delete action uses one server-side bulk trial lesson delete RPC", async () => {
  let rpcCall;
  const supabase = {
    async rpc(name, params) {
      rpcCall = { name, params };
      return { data: { status: "deleted", requested: 2, deleted: 2 }, error: null };
    }
  };

  const result = await deleteTrialLessons(supabase, ["trial-a", "trial-b"]);

  assert.deepEqual(rpcCall, {
    name: "delete_trial_lessons_mvp",
    params: { p_trial_lesson_ids: ["trial-a", "trial-b"] }
  });
  assert.equal(result.data.status, "deleted");
  assert.equal(result.error, null);
});

test("bulk-delete SQL exists and only invokes single-delete function for each explicit input ID", () => {
  assert.ok(
    bulkDeleteSql.includes(
      "create or replace function public.delete_trial_lessons_mvp(p_trial_lesson_ids uuid[])"
    )
  );
  assert.ok(bulkDeleteSql.includes("for v_trial_lesson_id in ("));
  assert.ok(bulkDeleteSql.includes("select distinct unnest(p_trial_lesson_ids) as trial_lesson_id"));
  assert.ok(bulkDeleteSql.includes("v_result := public.delete_trial_lesson_mvp(v_trial_lesson_id);"));
  assert.ok(bulkDeleteSql.includes("revoke all on function public.delete_trial_lessons_mvp(uuid[]) from public, anon;"));
  assert.ok(bulkDeleteSql.includes("grant execute on function public.delete_trial_lessons_mvp(uuid[]) to authenticated;"));
});

test("bulk composer renders recipient counts and skip summary", () => {
  assert.ok(trialLessonsPage.includes("{trialLessons.length} selected"));
  assert.ok(trialLessonsPage.includes("{sendableRecipients.length} sendable"));
  assert.ok(trialLessonsPage.includes("{skippedRecipientCount} skipped"));
});

test("bulk composer sends one email per valid selected recipient and preserves per-recipient context", () => {
  assert.ok(trialLessonsPage.includes("sendableRecipients = useMemo"));
  assert.ok(trialLessonsPage.includes("function getDraftForRecipient(recipient)"));
  assert.ok(trialLessonsPage.includes("buildCommunicationDraft(form.messageType, recipient.context)"));
  assert.ok(trialLessonsPage.includes("for (const recipient of sendableRecipients)"));
  assert.ok(trialLessonsPage.includes("trialLessonId: recipient.trialLessonId"));
  assert.ok(trialLessonsPage.includes("recipient: recipient.email"));
  assert.ok(!trialLessonsPage.includes("bcc:"));
  assert.ok(!trialLessonsPage.includes("cc:"));
});

test("bulk composer validates recipient email addresses before queueing", () => {
  assert.ok(trialLessonsPage.includes("trialLessonEmailPattern"));
  assert.ok(trialLessonsPage.includes("isValidTrialLessonEmail"));
  assert.ok(trialLessonsPage.includes("validEmail: isValidTrialLessonEmail(email)"));
});
