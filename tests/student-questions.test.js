import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  changeStudentQuestionDate,
  createStudentQuestion,
  deleteStudentQuestion,
  fetchStudentQuestionBadgeCount,
  markStudentQuestionDone,
  studentQuestionSelect
} from "../lib/data.js";
import { formatCountBadgeValue } from "../lib/navigation-badges.js";
import { canManageStudentQuestions, getVisibleNavigation } from "../lib/roles.js";
import {
  buildStudentQuestionDatePatch,
  buildStudentQuestionDonePatch,
  countDueStudentQuestions,
  getStudentQuestionDisplayStatus,
  removeStudentQuestionById,
  replaceStudentQuestionById,
  sortOpenStudentQuestions,
  validateStudentQuestionForm
} from "../lib/student-questions.js";

const studentQuestionsSql = readFileSync(
  new URL("../supabase/migrations/20260828008000_student_questions.sql", import.meta.url),
  "utf8"
);
const adminShell = readFileSync(new URL("../components/AdminShell.js", import.meta.url), "utf8");
const studentProfilePage = readFileSync(new URL("../app/(app)/students/profile/page.js", import.meta.url), "utf8");
const questionsPage = readFileSync(new URL("../app/(app)/questions/page.js", import.meta.url), "utf8");

test("student questions migration creates a tenant-scoped RLS table", () => {
  assert.match(studentQuestionsSql, /create type public\.student_question_status as enum \('open', 'done'\)/);
  assert.match(studentQuestionsSql, /create table if not exists public\.student_questions/);
  assert.match(studentQuestionsSql, /\borganization_id uuid not null references public\.organizations \(id\) on delete restrict/);
  assert.match(studentQuestionsSql, /\bschool_id uuid not null references public\.schools \(id\) on delete restrict/);
  assert.match(studentQuestionsSql, /\bstudent_id uuid not null references public\.students \(id\) on delete cascade/);
  assert.match(studentQuestionsSql, /constraint student_questions_student_id_organization_id_school_id_fkey/);
  assert.match(studentQuestionsSql, /references public\.students \(id, organization_id, school_id\)/);
  assert.match(studentQuestionsSql, /alter table public\.student_questions enable row level security/);
  assert.doesNotMatch(studentQuestionsSql, /security definer/i);
});

test("student question RLS allows only school managers to access rows", () => {
  assert.match(studentQuestionsSql, /revoke all on public\.student_questions from anon, authenticated/);
  assert.match(studentQuestionsSql, /grant select, insert, update, delete on public\.student_questions to authenticated/);
  assert.match(studentQuestionsSql, /for select[\s\S]*using \(public\.can_manage_school\(school_id\)\)/);
  assert.match(studentQuestionsSql, /for insert[\s\S]*public\.can_access_org\(organization_id\)[\s\S]*public\.can_manage_school\(school_id\)/);
  assert.match(studentQuestionsSql, /for update[\s\S]*using \(public\.can_manage_school\(school_id\)\)/);
  assert.match(studentQuestionsSql, /for delete[\s\S]*using \(public\.can_manage_school\(school_id\)\)/);
  assert.match(studentQuestionsSql, /created_by = \(select auth\.uid\(\)\)/);
});

test("staff navigation exposes Questions but teacher navigation does not", () => {
  assert.equal(canManageStudentQuestions({ school_memberships: [{ role: "school_manager" }] }), true);
  assert.equal(canManageStudentQuestions({ school_memberships: [{ role: "teacher" }] }), false);
  assert.equal(
    getVisibleNavigation({ school_memberships: [{ role: "school_manager" }] }).some((item) => item.href === "/questions/"),
    true
  );
  assert.equal(
    getVisibleNavigation({ school_memberships: [{ role: "teacher" }] }).some((item) => item.href === "/questions/"),
    false
  );
});

test("global Questions badge counts due and overdue open questions only", async () => {
  const { calls, supabase } = createSupabaseRecorder({ count: 3, error: null });

  const result = await fetchStudentQuestionBadgeCount(supabase, "2026-09-03");

  assert.equal(result.count, 3);
  assert.deepEqual(calls, [
    ["from", "student_questions"],
    ["select", "id", { count: "exact", head: true }],
    ["eq", "status", "open"],
    ["lte", "reminder_date", "2026-09-03"]
  ]);
  assert.match(adminShell, /fetchStudentQuestionBadgeCount/);
  assert.match(adminShell, /item\.href === "\/questions\/"/);
  assert.match(adminShell, /className="nav-count-badge"/);
  assert.equal(formatCountBadgeValue(3), "3");
});

test("creating a question for a student trims text and inserts only a question row", async () => {
  const { calls, supabase } = createSupabaseRecorder({
    data: { id: "question-1", question: "Ask about Wednesday class", status: "open" },
    error: null
  });

  const result = await createStudentQuestion(supabase, {
    createdBy: "profile-1",
    organizationId: "org-1",
    question: "  Ask about Wednesday class  ",
    reminderDate: "2026-09-03",
    schoolId: "school-1",
    studentId: "student-1"
  });

  assert.equal(validateStudentQuestionForm({ question: "Ask", reminderDate: "2026-09-03" }), true);
  assert.equal(validateStudentQuestionForm({ question: "", reminderDate: "2026-09-03" }), false);
  assert.deepEqual(result.row, {
    created_by: "profile-1",
    organization_id: "org-1",
    question: "Ask about Wednesday class",
    reminder_date: "2026-09-03",
    school_id: "school-1",
    status: "open",
    student_id: "student-1"
  });
  assert.deepEqual(calls.slice(0, 3), [
    ["from", "student_questions"],
    ["insert", result.row],
    ["select", studentQuestionSelect]
  ]);
});

test("question badge eligibility excludes future questions and includes due or overdue questions", () => {
  const questions = [
    { id: "future", reminder_date: "2026-09-04", status: "open" },
    { id: "today", reminder_date: "2026-09-03", status: "open" },
    { id: "overdue", reminder_date: "2026-09-02", status: "open" },
    { id: "done", reminder_date: "2026-09-01", status: "done" }
  ];

  assert.equal(countDueStudentQuestions([questions[0]], "2026-09-03"), 0);
  assert.equal(countDueStudentQuestions([questions[1]], "2026-09-03"), 1);
  assert.equal(countDueStudentQuestions([questions[2]], "2026-09-03"), 1);
  assert.equal(countDueStudentQuestions(questions, "2026-09-03"), 2);
  assert.equal(getStudentQuestionDisplayStatus(questions[0], "2026-09-03"), "open");
  assert.equal(getStudentQuestionDisplayStatus(questions[1], "2026-09-03"), "due_today");
  assert.equal(getStudentQuestionDisplayStatus(questions[2], "2026-09-03"), "overdue");
});

test("mark done removes a question from badge eligibility", async () => {
  const completedAt = "2026-09-03T10:00:00.000Z";
  const donePatch = buildStudentQuestionDonePatch(completedAt);
  const question = { id: "question-1", reminder_date: "2026-09-02", status: "open" };
  const { calls, supabase } = createSupabaseRecorder({ data: { ...question, ...donePatch }, error: null });

  const result = await markStudentQuestionDone(supabase, question.id);

  assert.deepEqual(donePatch, { completed_at: completedAt, status: "done" });
  assert.equal(countDueStudentQuestions([{ ...question, ...donePatch }], "2026-09-03"), 0);
  assert.equal(result.patch.status, "done");
  assert.deepEqual(calls.slice(0, 4), [
    ["from", "student_questions"],
    ["update", result.patch],
    ["eq", "id", "question-1"],
    ["select", studentQuestionSelect]
  ]);
});

test("changing reminder date updates badge behavior and question ordering", async () => {
  const questions = [
    { id: "question-1", created_at: "2026-09-01T00:00:00Z", reminder_date: "2026-09-02", status: "open" },
    { id: "question-2", created_at: "2026-09-01T00:00:01Z", reminder_date: "2026-09-05", status: "open" }
  ];
  const updatedQuestion = { ...questions[0], reminder_date: "2026-09-06" };
  const { calls, supabase } = createSupabaseRecorder({ data: updatedQuestion, error: null });

  const result = await changeStudentQuestionDate(supabase, "question-1", "2026-09-06");

  assert.deepEqual(buildStudentQuestionDatePatch("2026-09-06"), { reminder_date: "2026-09-06" });
  assert.equal(countDueStudentQuestions([updatedQuestion], "2026-09-03"), 0);
  assert.deepEqual(
    replaceStudentQuestionById(questions, updatedQuestion).map((question) => question.id),
    ["question-2", "question-1"]
  );
  assert.deepEqual(calls.slice(0, 4), [
    ["from", "student_questions"],
    ["update", result.patch],
    ["eq", "id", "question-1"],
    ["select", studentQuestionSelect]
  ]);
});

test("delete removes only the question row and never targets students", async () => {
  const { calls, supabase } = createSupabaseRecorder({ data: { id: "question-1", student_id: "student-1" }, error: null });

  const result = await deleteStudentQuestion(supabase, "question-1");

  assert.deepEqual(removeStudentQuestionById([{ id: "question-1" }, { id: "question-2" }], "question-1"), [{ id: "question-2" }]);
  assert.equal(result.data.id, "question-1");
  assert.equal(calls.some((call) => call[0] === "from" && call[1] === "student_questions"), true);
  assert.equal(calls.some((call) => call[0] === "from" && call[1] === "students"), false);
  assert.doesNotMatch(studentQuestionsSql, /delete from public\.students\b/);
  assert.match(studentProfilePage, /QuestionDeleteDialog/);
  assert.match(questionsPage, /QuestionDeleteDialog/);
});

test("open questions are ordered overdue, due today, then future", () => {
  assert.deepEqual(
    sortOpenStudentQuestions([
      { id: "future", created_at: "2026-09-01T00:00:00Z", reminder_date: "2026-09-05" },
      { id: "overdue", created_at: "2026-09-01T00:00:00Z", reminder_date: "2026-09-01" },
      { id: "today", created_at: "2026-09-01T00:00:00Z", reminder_date: "2026-09-03" }
    ]).map((question) => question.id),
    ["overdue", "today", "future"]
  );
  assert.match(questionsPage, /isStudentQuestionOverdue\(question, today\) \? "overdue-row" : ""/);
  assert.match(questionsPage, /getStudentQuestionDisplayStatus\(question, today\)/);
});

test("student profile and Questions page expose the MVP fields and actions without an answer field", () => {
  assert.match(studentProfilePage, /Questions to ask/);
  assert.match(studentProfilePage, /Add question/);
  assert.match(studentProfilePage, /Question text/);
  assert.match(studentProfilePage, /Reminder date/);
  assert.match(questionsPage, /Due date/);
  assert.match(questionsPage, /View student/);
  assert.match(questionsPage, /Mark done/);
  assert.match(questionsPage, /Change date/);
  assert.match(questionsPage, /Delete/);
  assert.doesNotMatch(studentQuestionsSql, /\banswer\b/i);
  assert.doesNotMatch(studentProfilePage, /\banswer\b/i);
  assert.doesNotMatch(questionsPage, /\banswer\b/i);
});

function createSupabaseRecorder(result) {
  const calls = [];
  const query = {
    delete() {
      calls.push(["delete"]);
      return query;
    },
    eq(column, value) {
      calls.push(["eq", column, value]);
      return query;
    },
    insert(row) {
      calls.push(["insert", row]);
      return query;
    },
    limit(value) {
      calls.push(["limit", value]);
      return query;
    },
    lte(column, value) {
      calls.push(["lte", column, value]);
      return query;
    },
    maybeSingle() {
      calls.push(["maybeSingle"]);
      return Promise.resolve(result);
    },
    order(column, options) {
      calls.push(["order", column, options]);
      return query;
    },
    select(columns, options) {
      calls.push(options ? ["select", columns, options] : ["select", columns]);
      return query;
    },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    },
    update(patch) {
      calls.push(["update", patch]);
      return query;
    }
  };

  return {
    calls,
    supabase: {
      from(table) {
        calls.push(["from", table]);
        return query;
      }
    }
  };
}
