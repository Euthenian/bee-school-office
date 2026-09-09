import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildLegacyFinanceBankingDryRun,
  financeBankingSourceIdentity,
  identifyLegacyFinanceBankingSheet,
  maskAccountNumber,
  matchFinanceBankingStudent,
  normalizeAccountNumber,
  normalizeAccountType,
  normalizeBankCode,
  normalizeBankDisplayName,
  normalizeBranchCode,
  normalizeDateRico,
  normalizeFeeValue
} from "../lib/legacy-finance-banking-imports.js";

const migrationSql = readFileSync(
  new URL("../supabase/migrations/20260909002000_legacy_finance_banking_import_staging.sql", import.meta.url),
  "utf8"
);
const productionSchemaSql = readFileSync(
  new URL("../supabase/migrations/20260909003000_student_finance_banking_profiles.sql", import.meta.url),
  "utf8"
);
const dryRunScript = readFileSync(
  new URL("../scripts/legacy-finance-banking-import-dry-run.js", import.meta.url),
  "utf8"
);
const productionImportScript = readFileSync(
  new URL("../scripts/legacy-finance-banking-import-production.js", import.meta.url),
  "utf8"
);

const target = { organization_id: "organization-ohashi", school_id: "school-ohashi" };
const student = (id, options = {}) => ({
  id,
  ...target,
  first_name: "Aki",
  last_name: "Tanaka",
  preferred_name: null,
  legacy_customer_id: "166",
  legacy_japanese_name: "田中 あき",
  status: "active",
  student_contacts: [{ contact_type: "phone", value: "090-1234-5678" }],
  ...options
});

test("detects Rico as the finance/banking worksheet from actual headers", () => {
  const detection = identifyLegacyFinanceBankingSheet(workbook([
    sheet("Students", [{ CustomerID: "166", NameJp: "田中" }]),
    ricoSheet([])
  ]));

  assert.equal(detection.selected_sheet_name, "Rico");
  assert.equal(detection.candidates[0].banking_headers.includes("Account Number:"), true);
});

test("normalizes direct-debit fields without inventing unknown mappings", () => {
  assert.deepEqual(normalizeAccountType("普通"), { raw_value: "普通", canonical: "ordinary", status: "mapped" });
  assert.deepEqual(normalizeAccountType("当座"), { raw_value: "当座", canonical: "current", status: "mapped" });
  assert.equal(normalizeAccountType("savings").status, "unresolved");
  assert.equal(normalizeBankCode("0190").status, "valid");
  assert.equal(normalizeBankCode("00-40").status, "malformed");
  assert.equal(normalizeBranchCode(21).normalized, "021");
  assert.equal(normalizeBranchCode("166301-17280").status, "malformed");
  assert.equal(normalizeBankDisplayName("西日本シティ", "0190"), "西日本シティ銀行");
  assert.deepEqual(normalizeFeeValue("9500"), { raw_value: "9500", monthly_fee_yen: 9500, status: "valid" });
  assert.equal(normalizeFeeValue("9,500").status, "invalid");
  assert.equal(normalizeDateRico(202507).parsed_month, "2025-07");
  assert.equal(normalizeDateRico("July 2025").interpretation, "unresolved");
});

test("masks account numbers and validates strict seven-digit account values", () => {
  assert.equal(maskAccountNumber("1234567"), "****567");
  assert.equal(normalizeAccountNumber("1234567").status, "valid");
  assert.equal(normalizeAccountNumber("1234567").digit_count, 7);
  assert.equal(normalizeAccountNumber("-1646581").status, "malformed");
  assert.equal(normalizeAccountNumber("123-456-789").status, "malformed");
  assert.equal(normalizeAccountNumber("").status, "missing");
  assert.equal(normalizeAccountNumber("123456").issue, "possible_leading_zero_loss");
  assert.equal(normalizeAccountNumber(123456).excel_formatting_assessment.startsWith("likely Excel numeric-cell"), true);
  assert.equal(normalizeAccountNumber("12345678").issue, "too_long");
});

test("CustomerID is the only automatic Student link and fallback evidence remains review-only", () => {
  assert.equal(matchFinanceBankingStudent({
    legacyCustomerId: "166",
    students: [student("student-166")],
    target
  }).category, "A");

  assert.equal(matchFinanceBankingStudent({
    legacyCustomerId: "166",
    students: [student("one"), student("two")],
    target
  }).category, "B");

  const fallback = matchFinanceBankingStudent({
    legacyCustomerId: null,
    phone: "09012345678",
    japaneseName: "田中あき",
    students: [student("student-166")],
    target
  });
  assert.equal(fallback.category, "B");
  assert.equal(fallback.chosen_student_id, null);
  assert.equal(fallback.confidence, "reviewed_fallback_phone_and_compatible_name");

  assert.equal(matchFinanceBankingStudent({
    legacyCustomerId: "166",
    students: [student("other", { school_id: "other-school" })],
    target
  }).category, "C");
});

test("dry run preserves masked source data, reports schema gaps, and performs no writes", () => {
  const report = buildLegacyFinanceBankingDryRun({
    workbook: workbook([ricoSheet([{
      CustomerID: 166,
      Active: "y",
      NameJp: "田中 あき",
      Katakana: "タナカ アキ",
      "Phone Number:": "090-1234-5678",
      Address: "PRIVATE ADDRESS",
      "Bank Name": "福岡銀行",
      "Branch Name": "大橋",
      Yomigana: "オオハシ",
      "Account Type": "普通",
      "Account Number:": "1234567",
      "Bank Code:": "0177",
      "Branch Code": 273,
      Fee: 7000,
      "Date Rico Start": 202507
    }])]),
    snapshot: databaseSnapshot()
  });

  assert.equal(report.mode, "dry_run_only");
  assert.equal(report.database_writes, 0);
  assert.equal(report.summary.genuine_finance_rows, 1);
  assert.equal(report.summary.exact_student_matches_by_customer_id, 1);
  assert.equal(report.rows[0].source_data_masked["Account Number:"], "****567");
  assert.equal(report.rows[0].source_data_masked.Address, "[present]");
  assert.equal(report.rows[0].source_data_masked["Phone Number:"], "*******5678");
  assert.equal(report.rows[0].normalized_candidate.bank_account.account_number_masked, "****567");
  assert.equal(report.rows[0].normalized_candidate.bank_account.account_number_status, "valid");
  assert.equal(report.rows[0].normalized_candidate.bank_account.bank_code_normalization, "as_source_string");
  assert.equal(report.rows[0].normalized_candidate.bank_account.account_holder_katakana, "タナカ アキ");
  assert.equal(report.rows[0].normalized_candidate.bank_account.branch_name_yomigana, "オオハシ");
  assert.equal(report.rows[0].normalized_candidate.billing_profile.monthly_fee_yen, 7000);
  assert.equal(report.rows[0].normalized_candidate.address.target, "student_addresses.postal_address");
  assert.equal(report.staging.persisted, false);
  assert.doesNotMatch(JSON.stringify(report), /1234567|PRIVATE ADDRESS|090-1234-5678|09012345678/);
  assert.match(JSON.stringify(report.production_schema), /student_bank_accounts/);
  assert.match(JSON.stringify(report.final_production_policy), /Only category A rows/);
  assert.match(JSON.stringify(report.rls_policy), /Teachers and office_staff get zero/);
});

test("malformed bank fields are warnings and missing identity becomes helper or unmatched category", () => {
  const report = buildLegacyFinanceBankingDryRun({
    workbook: workbook([ricoSheet([
      { CustomerID: "999", NameJp: "No Match", "Account Number:": "-1646581", "Bank Code:": "00-40", "Branch Code": "166301-17280", Fee: "abc" },
      { "MACRO LAUNCH PYTHON": "button only" }
    ])]),
    snapshot: databaseSnapshot()
  });

  assert.equal(report.rows[0].student_match_category, "C");
  assert.equal(report.rows[0].normalized_candidate.bank_account.bank_details_status, "review");
  assert.equal(report.rows[0].warnings.some((warning) => warning.code === "malformed_account_number"), true);
  assert.equal(report.rows[0].warnings.some((warning) => warning.code === "invalid_fee"), true);
  assert.equal(report.rows[1].student_match_category, "D");
  assert.equal(report.summary.non_student_helper_rows, 1);
  assert.equal(report.malformed_account_number_analysis[0].raw_string_length, 8);
  assert.equal(report.malformed_account_number_analysis[0].issue, "other");
});

test("duplicate CustomerID rows remain owner-review unless secondary signals choose one Student", () => {
  const report = buildLegacyFinanceBankingDryRun({
    workbook: workbook([ricoSheet([{
      CustomerID: "178",
      NameJp: "在澤英俊",
      Katakana: "アリサワ ヒデトシ",
      "Account Number:": "1234567",
      "Bank Code:": "0177",
      "Branch Code": "273",
      "Account Type": "普通",
      "Bank Name": "福岡銀行",
      "Branch Name": "大橋",
      Fee: 7000
    }])]),
    snapshot: databaseSnapshot({
      students: [
        student("active-duplicate", { legacy_customer_id: "178", legacy_japanese_name: "在澤研人", status: "active" }),
        student("inactive-duplicate", { legacy_customer_id: "178", legacy_japanese_name: "在澤研人", status: "inactive" })
      ]
    })
  });

  const resolution = report.ambiguous_customer_id_resolution[0];
  assert.equal(resolution.recommendation, "OWNER REVIEW");
  assert.equal(resolution.candidate_students.length, 2);
  assert.equal(resolution.candidate_students.every((candidate) => candidate.matching_signals.includes("legacy_customer_id")), true);
  assert.equal(resolution.candidate_students.every((candidate) => candidate.conflicting_signals.includes("source_phone_blank")), true);
  assert.equal(report.summary.rows_completely_blocked, 1);
});

test("deterministic finance source identity is scoped to school, sheet row and workbook hash", () => {
  const hash = "a".repeat(64);
  assert.equal(financeBankingSourceIdentity(target, hash, 3), financeBankingSourceIdentity(target, hash, 3));
  assert.notEqual(financeBankingSourceIdentity(target, hash, 3), financeBankingSourceIdentity(target, hash, 4));
  assert.notEqual(financeBankingSourceIdentity(target, hash, 3), financeBankingSourceIdentity({ ...target, school_id: "other" }, hash, 3));
  assert.throws(() => financeBankingSourceIdentity(target, "bad", 3));
});

test("finance/banking staging migration is restricted and keeps teachers away from bank data", () => {
  assert.match(migrationSql, /create table if not exists public\.legacy_finance_banking_import_batches/);
  assert.match(migrationSql, /create table if not exists public\.legacy_finance_banking_import_rows/);
  assert.match(migrationSql, /raw_sensitive_source_data jsonb not null default '\{\}'::jsonb/);
  assert.match(migrationSql, /masked_source_data jsonb not null default '\{\}'::jsonb/);
  assert.match(migrationSql, /student_match_category in \('A', 'B', 'C', 'D'\)/);
  assert.match(migrationSql, /imported_at is null or student_match_category = 'A'/);
  assert.match(migrationSql, /import_status in \('dry_run', 'staged', 'imported', 'owner_review', 'skipped', 'failed'\)/);
  assert.match(migrationSql, /alter table public\.legacy_finance_banking_import_rows enable row level security/);
  assert.match(migrationSql, /can_manage_student_bank_accounts_org\(organization_id, school_id\)/);
  assert.match(migrationSql, /array\['franchise_owner', 'office_staff'\]::public\.membership_role\[\]/);
  assert.match(migrationSql, /array\['school_manager', 'office_staff'\]::public\.membership_role\[\]/);
  assert.match(migrationSql, /array\['franchise_owner'\]::public\.membership_role\[\]/);
  assert.match(migrationSql, /array\['school_manager'\]::public\.membership_role\[\]/);
  assert.doesNotMatch(migrationSql, /array\[[^\]]*'teacher'/);
  assert.doesNotMatch(migrationSql, /disable row level security/i);
});

test("prepared production finance schema stores sensitive bank data in restricted text columns", () => {
  assert.match(productionSchemaSql, /create table if not exists public\.student_billing_profiles/);
  assert.match(productionSchemaSql, /create table if not exists public\.student_addresses/);
  assert.match(productionSchemaSql, /create table if not exists public\.student_bank_accounts/);
  assert.match(productionSchemaSql, /\bbank_code text\b/);
  assert.match(productionSchemaSql, /\bbranch_code text\b/);
  assert.match(productionSchemaSql, /\baccount_number text\b/);
  assert.doesNotMatch(productionSchemaSql, /\baccount_number text not null\b/);
  assert.match(productionSchemaSql, /\baccount_holder_katakana text\b/);
  assert.match(productionSchemaSql, /\bbranch_name_yomigana text\b/);
  assert.doesNotMatch(productionSchemaSql, /\baccount_holder_yomigana text\b/);
  assert.match(productionSchemaSql, /\bpostal_address text not null\b/);
  assert.match(productionSchemaSql, /student_bank_accounts_account_number_check\s+check \(account_number is null or account_number ~ '\^\[0-9\]\{7\}\$'\)/);
  assert.match(productionSchemaSql, /references public\.students \(id, organization_id, school_id\)\s+on delete restrict/);
  assert.match(productionSchemaSql, /alter table public\.student_bank_accounts enable row level security/);
  assert.match(productionSchemaSql, /can_manage_student_bank_accounts_org\(organization_id, school_id\)/);
  assert.doesNotMatch(productionSchemaSql, /array\[[^\]]*'teacher'/);
  assert.doesNotMatch(productionSchemaSql, /disable row level security/i);
});

test("dry-run script exposes no import or migration apply mode", () => {
  assert.match(dryRunScript, /legacy-finance-banking-import-dry-run/);
  assert.match(dryRunScript, /There is no execute, import, stage, migration-apply, deploy or push option/);
  assert.doesNotMatch(dryRunScript, /supabase db push|INSERT INTO|UPDATE public|DELETE FROM|CREATE TABLE/i);
});

test("production import script is guarded, idempotent, and maps owner-approved bank fields", () => {
  assert.match(productionImportScript, /--execute/);
  assert.match(productionImportScript, /OWNER_REVIEW_ROWS = \[15, 26\]/);
  assert.match(productionImportScript, /EXPECTED_GENUINE_ROWS = 28/);
  assert.match(productionImportScript, /EXPECTED_EXACT_LINKS = 26/);
  assert.match(productionImportScript, /account_holder_katakana/);
  assert.match(productionImportScript, /branch_name_yomigana/);
  assert.match(productionImportScript, /on conflict on constraint student_bank_accounts_source_row_unique do update/);
  assert.match(productionImportScript, /student_bank_accounts/);
  assert.match(productionImportScript, /teacher_bank_rows_visible !== 0/);
  assert.match(productionImportScript, /office_staff_bank_rows_visible !== 0/);
  assert.match(productionImportScript, /assertNoSensitiveLeak/);
  assert.doesNotMatch(productionImportScript, /supabase db push|git push|deploy/i);
});

function workbook(sheets) {
  return {
    date1904: false,
    file: { sha256: "a".repeat(64), name: "legacy.xlsm" },
    sheets
  };
}

function sheet(name, rows) {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return { name, headers, columns: headers.map((header, index) => ({ column_letter: String.fromCharCode(65 + index), source_header: header, header })), rows: rows.map((values, index) => ({ rowNumber: index + 2, values })), physicalRowCount: rows.length + 1, headerRowNumber: 1 };
}

function ricoSheet(rows) {
  const headers = [
    "CustomerID",
    "Active",
    "NameJp",
    "Katakana",
    "Phone Number:",
    "Address",
    "Bank Name",
    "Branch Name",
    "Yomigana",
    "Account Type",
    "Account Number:",
    "Bank Code:",
    "Branch Code",
    "Fee",
    "Date Rico Start",
    "MACRO LAUNCH PYTHON"
  ];
  return {
    name: "Rico",
    headers,
    columns: headers.map((header, index) => ({ column_letter: String.fromCharCode(65 + index), source_header: header, header })),
    rows: rows.map((values, index) => ({ rowNumber: index + 3, values: Object.fromEntries(headers.map((header) => [header, values[header] ?? ""])) })),
    physicalRowCount: rows.length + 2,
    headerRowNumber: 2,
    dimension: "A1:P208"
  };
}

function databaseSnapshot(overrides = {}) {
  return {
    fetched_at: "2026-09-09T00:00:00.000Z",
    target: { ...target, organization_name: "Bee School HQ", school_name: "Ohashi" },
    students: [student("student-166")],
    schema: {
      tables: ["student_charges", "student_payments", "student_payment_allocations", "student_refunds"],
      columns: [{ table_name: "student_charges", column_name: "amount" }]
    },
    ...overrides
  };
}
