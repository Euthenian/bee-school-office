import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLegacyTaikenDryRun,
  interpretTaikenStatus,
  matchTaikenStudent,
  normalizeTaikenEmail,
  normalizeTaikenName,
  normalizeTaikenPhone,
  parseTaikenDate,
  parseTaikenTime,
  taikenSourceIdentity
} from "../lib/legacy-taiken-imports.js";

const target = { organization_id: "organization-ohashi", school_id: "school-ohashi" };
const student = (id, options = {}) => ({
  id,
  ...target,
  first_name: "Aki",
  last_name: "Tanaka",
  legacy_japanese_name: "\u7530\u4e2d \u3042\u304d",
  student_contacts: [{ contact_type: "email", value: "aki@example.com" }, { contact_type: "phone", value: "090-1234-5678" }],
  ...options
});

const match = (identity, students) => matchTaikenStudent(identity, students, target);

test("exact email and compatible full name propose only the existing Student UUID", () => {
  const result = match({ names: ["Tanaka Aki"], email: "aki@example.com" }, [student("student-existing")]);
  assert.equal(result.category, "A");
  assert.equal(result.chosen_student_id, "student-existing");
  assert.deepEqual(result.candidates[0].signals.sort(), ["email", "exact_name"]);
});

test("exact phone and Japanese name support a strong match across spaces and full-width forms", () => {
  const phone = normalizeTaikenPhone("+81 (90) 1234-5678");
  const result = match({ names: ["\u7530\u4e2d\u3000\u3042\u304d"], phone }, [student("student-existing")]);
  assert.equal(result.category, "A");
  assert.equal(result.chosen_student_id, "student-existing");
});

test("single weak name, email, or phone signals remain review candidates", () => {
  for (const identity of [{ names: ["Aki Tanaka"] }, { email: "aki@example.com" }, { phone: "09012345678" }]) {
    const result = match(identity, [student("student-existing")]);
    assert.equal(result.category, "B");
    assert.equal(result.chosen_student_id, null);
  }
});

test("household contact sharing cannot auto-link either of two compatible names", () => {
  const result = match({ names: ["Aki Tanaka", "Ren Tanaka"], email: "aki@example.com" }, [
    student("student-aki"),
    student("student-ren", { first_name: "Ren", legacy_japanese_name: "" })
  ]);
  assert.equal(result.category, "B");
  assert.equal(result.chosen_student_id, null);
  assert.equal(result.candidates.length, 2);
});

test("same exact full name on multiple Students remains ambiguous", () => {
  const result = match({ names: ["Aki Tanaka"] }, [student("one"), student("two")]);
  assert.equal(result.category, "B");
  assert.equal(result.chosen_student_id, null);
});

test("Student matches are strictly scoped to both organization and Ohashi school", () => {
  const result = match({ names: ["Aki Tanaka"], email: "aki@example.com" }, [
    student("other-school", { school_id: "different-school" }),
    student("other-organization", { organization_id: "different-organization" })
  ]);
  assert.equal(result.category, "C");
  assert.equal(result.chosen_student_id, null);
  assert.deepEqual(result.candidates, []);
});

test("missing identity never matches an empty name or empty contact", () => {
  const result = match({ names: ["", " "] }, [student("empty", { first_name: "", last_name: "", legacy_japanese_name: "", student_contacts: [{ contact_type: "email", value: "" }] })]);
  assert.equal(result.category, "C");
  assert.equal(result.chosen_student_id, null);
});

test("stable legacy identifiers require a unique scoped Student", () => {
  const identity = { legacyCustomerId: "B-100" };
  assert.equal(match(identity, [student("unique", { legacy_customer_id: "B-100" })]).category, "A");
  const ambiguous = match(identity, [student("one", { legacy_customer_id: "B-100" }), student("two", { legacy_customer_id: "B-100" })]);
  assert.equal(ambiguous.category, "B");
  assert.equal(ambiguous.chosen_student_id, null);
});

test("email and phone normalization retains invalid source values for review rather than repairing them", () => {
  assert.equal(normalizeTaikenEmail(" Aki@Example.com "), "aki@example.com");
  for (const raw of ["not-an-email", "a@@example.com", "a@example", "a b@example.com", ""]) assert.equal(normalizeTaikenEmail(raw), null);
  assert.equal(normalizeTaikenPhone("090-1234-5678"), "09012345678");
  assert.equal(normalizeTaikenPhone("\uff10\uff19\uff10\uff11\uff12\uff13\uff14\uff15\uff16\uff17\uff18"), "09012345678");
  for (const raw of [9012345678, "call 09012345678", "090123", ""]) assert.equal(normalizeTaikenPhone(raw), null);
});

test("name normalization is exact Unicode normalization and does not transliterate or fuzzily match", () => {
  assert.equal(normalizeTaikenName(" \uff21\uff4b\uff49\u3000Tanaka "), "akitanaka");
  assert.notEqual(normalizeTaikenName("Aki Tanaka"), normalizeTaikenName("Aki Tanakae"));
  assert.notEqual(normalizeTaikenName("\u7530\u4e2d\u3042\u304d"), normalizeTaikenName("Aki Tanaka"));
});

test("date parsing rejects missing years and impossible dates and respects Excel date systems", () => {
  assert.equal(parseTaikenDate(45843), "2025-07-05");
  assert.equal(parseTaikenDate(1), "1900-01-01");
  assert.equal(parseTaikenDate(59), "1900-02-28");
  assert.equal(parseTaikenDate(60), null);
  assert.equal(parseTaikenDate(61), "1900-03-01");
  assert.equal(parseTaikenDate(1, true), "1904-01-02");
  assert.equal(parseTaikenDate(0, true), "1904-01-01");
  assert.equal(parseTaikenDate("2026\u5e743\u670828\u65e5"), "2026-03-28");
  assert.equal(parseTaikenDate("2026\u5e74 6\u670815\u65e5"), "2026-06-15");
  assert.equal(parseTaikenDate("7/14/2026"), "2026-07-14");
  assert.equal(parseTaikenDate("14/7/2026"), "2026-07-14");
  assert.equal(parseTaikenDate("6/7/2026"), null);
  for (const raw of ["4\u670828\u65e5", "2026-02-29", "2025-13-01", 45843.5, NaN, Infinity]) assert.equal(parseTaikenDate(raw), null);
});

test("time parsing correctly handles fractional Excel values and rejects ambiguous numeric clock data", () => {
  assert.equal(parseTaikenTime(0), "00:00:00");
  assert.equal(parseTaikenTime(17 / 24), "17:00:00");
  assert.equal(parseTaikenTime("9:05"), "09:05:00");
  assert.equal(parseTaikenTime("18:00:30"), "18:00:30");
  for (const raw of [1100, 18, 1, -1, NaN, "24:00", "11:60", "hello"]) assert.equal(parseTaikenTime(raw), null);
});

test("deterministic Taiken source identity distinguishes each sheet row, school, and workbook hash", () => {
  const hash = "a".repeat(64);
  const identity = taikenSourceIdentity(target, hash, 2);
  assert.equal(identity, taikenSourceIdentity(target, hash, 2));
  assert.notEqual(identity, taikenSourceIdentity(target, hash, 3));
  assert.notEqual(identity, taikenSourceIdentity(target, "b".repeat(64), 2));
  assert.notEqual(identity, taikenSourceIdentity({ ...target, school_id: "other-school" }, hash, 2));
  assert.throws(() => taikenSourceIdentity({}, hash, 2));
  assert.throws(() => taikenSourceIdentity(target, "invalid-hash", 2));
  assert.throws(() => taikenSourceIdentity(target, hash, 0));
});

function databaseSnapshot(overrides = {}) {
  return {
    fetched_at: "2026-09-08T00:00:00.000Z",
    target: { ...target, organization_name: "Bee School HQ", school_name: "Ohashi" },
    students: [student("student-existing")],
    teachers: [{ ...target, profile_id: "teacher-existing", eligible: true }],
    inquiry_methods: [{ id: "email", label: "Email" }, { id: "phone", label: "Phone" }, { id: "walk_in", label: "Walk in" }],
    acquisition_sources: [{ id: "bee_school_website", label: "Bee School Website" }],
    class_levels: [{ id: "adult", label: "Adult" }],
    schema: { enums: { class_lesson_type: ["group", "private"] } },
    ...overrides
  };
}

function taikenWorkbook(values) {
  const rows = values.map((value, index) => ({ rowNumber: index + 2, values: value }));
  return {
    date1904: false,
    file: { sha256: "a".repeat(64), name: "legacy.xlsm" },
    sheets: [{ name: "Taiken", headers: [...new Set(values.flatMap((row) => Object.keys(row)))], rows, physicalRowCount: rows.length + 1, headerRowNumber: 1 }]
  };
}

function audit(values, options = {}) {
  return buildLegacyTaikenDryRun({ workbook: taikenWorkbook(values), snapshot: databaseSnapshot(), ...options });
}

const completeRow = {
  Name: "Aki Tanaka",
  Joined: "yes",
  mail: "aki@example.com",
  phone: "09012345678",
  "how they reached out": "Mail",
  "How they know Bee": "homepage",
  "day of taiken": "2026-03-28",
  "Time of Taiken": 17 / 24,
  "Age group S1": "Adult",
  "Type of lesson": "Group"
};

test("independent contact evidence pointing to different Students remains ambiguous", () => {
  const result = match({ names: ["Aki Tanaka"], email: "aki@example.com", phone: "08055556666" }, [
    student("student-aki", { student_contacts: [{ contact_type: "email", value: "aki@example.com" }] }),
    student("student-ren", { first_name: "Ren", legacy_japanese_name: "", student_contacts: [{ contact_type: "phone", value: "08055556666" }] })
  ]);
  assert.equal(result.category, "B");
  assert.equal(result.chosen_student_id, null);
});

test("audit preserves all genuine CRM rows including side legends, nameless contacts and non-joiners", () => {
  const report = audit([
    { ...completeRow, Joined: "no", FP: "Colors" },
    { ...completeRow, Name: "", Joined: "", FP: "Yellow: Communication in process" },
    { FP: "Colors" }
  ]);
  assert.equal(report.summary.total_taiken_data_rows, 3);
  assert.equal(report.summary.genuine_data_rows, 2);
  assert.equal(report.summary.excluded_legend_rows, 1);
  assert.equal(report.rows[0].normalized_candidate.trial_lesson.status, "did_not_join");
  assert.equal(report.rows[0].chosen_converted_student_id, null);
  assert.equal(report.rows[1].source_row_number, 3);
});

test("audit is read-only, leaves Student inputs intact, and keeps addresses exclusively in raw staging", () => {
  const workbook = taikenWorkbook([{ ...completeRow, adress: "PRIVATE-ADDRESS-A", address: "PRIVATE-ADDRESS-B", Request: "Request preserved", notes: "Notes preserved" }]);
  const snapshot = databaseSnapshot();
  const before = structuredClone({ workbook, snapshot });
  const report = buildLegacyTaikenDryRun({ workbook, snapshot });
  assert.deepEqual({ workbook, snapshot }, before);
  assert.equal(report.mode, "dry_run_only");
  assert.equal(report.database_writes, 0);
  assert.equal(report.staging.persisted, false);
  assert.equal(report.rows[0].raw_source_data.adress, "PRIVATE-ADDRESS-A");
  assert.doesNotMatch(JSON.stringify(report.rows[0].normalized_candidate), /PRIVATE-ADDRESS/);
  assert.equal(report.rows[0].normalized_candidate.trial_lesson.customer_request, "Request preserved");
  assert.equal(report.rows[0].normalized_candidate.trial_lesson.internal_notes, "Notes preserved");
  assert.equal(report.rows[0].imported_trial_lesson_id, null);
  assert.equal(report.rows[0].imported_prospect_id, null);
  assert.equal(report.rows[0].chosen_converted_student_id, "student-existing");
});

test("inquiry method and acquisition source remain independent canonical fields", () => {
  const report = audit([completeRow]);
  const prospect = report.rows[0].normalized_candidate.prospect;
  assert.equal(prospect.inquiry_method_id, "email");
  assert.equal(prospect.acquisition_source_id, "bee_school_website");
});

test("explicit participants form separate relational candidates without adding the contact parent", () => {
  const snapshot = databaseSnapshot({ students: [student("parent", { first_name: "Parent" }), student("child-aki"), student("child-ren", { first_name: "Ren", legacy_japanese_name: "" })] });
  const report = audit([{ ...completeRow, Name: "Parent Tanaka", "name of student 1": "Aki Tanaka", "name of student 2": "Ren Tanaka" }], { snapshot });
  const row = report.rows[0];
  assert.equal(row.normalized_candidate.participants.length, 2);
  assert.deepEqual(row.normalized_candidate.participants.map((participant) => participant.alphabet_name), ["Aki Tanaka", "Ren Tanaka"]);
  assert.equal(row.chosen_converted_student_id, null);
  assert.equal(report.summary.rows_with_multiple_explicit_participants, 1);
  assert.deepEqual(row.normalized_candidate.participants.map((participant) => participant.converted_student_id), ["child-aki", "child-ren"]);
});

test("conflicting Joined fields and date-only Joined evidence never populate conversion links", () => {
  const report = audit([
    { ...completeRow, Joined: "yes", Joined2: "n", "refusal date": 45811 },
    { ...completeRow, Joined: 45843 },
    { ...completeRow, Joined: "" }
  ]);
  for (const row of report.rows) assert.equal(row.chosen_converted_student_id, null);
  assert.equal(report.rows[0].normalized_candidate.trial_lesson.status, null);
  assert.equal(report.rows[1].normalized_candidate.status_evidence.confirmed_joined, false);
  assert.equal(report.rows[2].normalized_candidate.trial_lesson.status, null);
  assert.equal(interpretTaikenStatus({ Joined: "n" }).status, "did_not_join");
  assert.equal(interpretTaikenStatus({ "Age group S1": "high school / Canceled same day" }).status, "cancelled");
});

test("only exact approved teacher aliases resolve to eligible target-school profiles", () => {
  const raw = { ...completeRow, Teacher: "Alex" };
  assert.equal(audit([raw]).rows[0].normalized_candidate.trial_lesson.assigned_teacher_profile_id, null);
  assert.equal(audit([raw], { teacherMappings: { alex: "teacher-existing" } }).rows[0].normalized_candidate.trial_lesson.assigned_teacher_profile_id, null);
  assert.equal(audit([raw], { teacherMappings: { Alex: "teacher-existing" } }).rows[0].normalized_candidate.trial_lesson.assigned_teacher_profile_id, "teacher-existing");
  assert.throws(() => audit([raw], { teacherMappings: { Alex: "nonexistent-profile" } }), /not an eligible teacher/);
});

test("audit rejects missing snapshots and mixed worksheets instead of treating missing evidence as no matches", () => {
  assert.throws(() => buildLegacyTaikenDryRun({ workbook: taikenWorkbook([completeRow]), snapshot: {} }), /snapshot/);
  const mixed = taikenWorkbook([completeRow]);
  mixed.sheets.push({ name: "Students", rows: [] });
  assert.throws(() => buildLegacyTaikenDryRun({ workbook: mixed, snapshot: databaseSnapshot() }), /Taiken-only/);
});

test("duplicate source candidates are reported while every historical source row retains a distinct identity", () => {
  const report = audit([completeRow, { ...completeRow }]);
  assert.equal(report.rows.length, 2);
  assert.deepEqual(report.summary.duplicate_candidate_groups, [[2, 3]]);
  assert.notEqual(report.rows[0].source_identity, report.rows[1].source_identity);
  assert.equal(report.rows[0].duplicate_candidates[0].source_row_number, 3);
});

test("multiple names written inside S1 create separate source fragments while household conversion stays blocked", () => {
  const snapshot = databaseSnapshot({ students: [student("masami", { first_name: "Masami", last_name: "", legacy_japanese_name: "" })] });
  const report = audit([{ ...completeRow, "name of student 1": "Masami and Fumiyo" }], { snapshot });
  const row = report.rows[0];
  assert.deepEqual(row.normalized_candidate.participants.map((participant) => participant.alphabet_name), ["Masami", "Fumiyo"]);
  assert.deepEqual(row.normalized_candidate.student_matching.participants.map((participant) => [participant.slot, participant.source_fragment_index]), [[1, 1], [1, 2]]);
  assert.equal(row.chosen_converted_student_id, null);
  assert.equal(row.normalized_candidate.participants.every((participant) => participant.converted_student_id === null), true);
  assert.equal(row.normalized_candidate.participants.every((participant) => participant.age_group_level_id === null), true);
  assert.equal(row.normalized_candidate.import_blockers.includes("participant_household_needs_review"), true);
});

test("ambiguous shared surname fragments remain verbatim and are never expanded into invented names", () => {
  const report = audit([{ ...completeRow, "name of student 1": "Taiga Uta and Asa" }]);
  const row = report.rows[0];
  assert.deepEqual(row.normalized_candidate.participants.map((participant) => participant.alphabet_name), ["Taiga Uta", "Asa"]);
  assert.equal(row.warnings.some((warning) => warning.code === "participant_name_may_be_incomplete"), true);
  assert.equal(row.normalized_candidate.import_blockers.includes("participant_household_needs_review"), true);
});

test("relationship-only participant descriptions remain staged without fabricating participant identities", () => {
  const report = audit([{ ...completeRow, "name of student 1": "Mom and daughter" }]);
  const row = report.rows[0];
  assert.equal(row.normalized_candidate.participants.length, 0);
  assert.equal(row.raw_source_data["name of student 1"], "Mom and daughter");
  assert.equal(row.chosen_converted_student_id, null);
  assert.equal(row.normalized_candidate.import_blockers.includes("participant_household_needs_review"), true);
});
