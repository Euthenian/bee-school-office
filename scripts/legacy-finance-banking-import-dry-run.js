#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildLegacyFinanceBankingDryRun } from "../lib/legacy-finance-banking-imports.js";
import { loadLegacyFinanceBankingSnapshot } from "../lib/legacy-finance-banking-snapshot.js";
import { readLegacyStudentWorkbook } from "../lib/legacy-student-imports.js";

function parseArgs(argv) {
  const options = {};
  const flags = { "--file": "file", "--snapshot": "snapshot", "--report-dir": "reportDir" };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") { options.help = true; continue; }
    if (!flags[flag]) throw new Error(`Unsupported argument ${flag}. This command only audits finance/banking data and has no write/import mode.`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}.`);
    options[flags[flag]] = value;
  }
  return options;
}

const cell = (value) => String(value ?? "(blank)").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
const table = (headers, rows) => [
  `| ${headers.map(cell).join(" | ")} |`,
  `| ${headers.map(() => "---").join(" | ")} |`,
  ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`)
].join("\n");
const rawLabel = (value) => value === "" || value == null ? "(blank)" : JSON.stringify(value);

function renderReport(report) {
  const summary = report.summary;
  return [
    "# Legacy finance/banking dry-run audit",
    `Generated: ${report.generated_at}. Database snapshot: ${report.database_snapshot_at} (${report.snapshot_source}).`,
    "**No database writes, staging writes, production import, migration apply, deployment or push were performed by this command.**",
    `Source: ${report.workbook.file.name}; SHA-256: \`${report.workbook.file.sha256}\`; worksheet used: ${report.workbook.sheet_name}; dimension: ${report.workbook.dimension}.`,
    `Target: Bee School HQ (${report.target.organization_id}) / Ohashi (${report.target.school_id}). Current target-school Students: ${summary.existing_students_in_target_school}.`,
    "## Worksheet verification",
    table(["Candidate sheet", "Rows", "Matched finance headers", "Banking headers", "Score"],
      report.worksheet_detection.candidates.map((candidate) => [
        candidate.name,
        candidate.row_count,
        candidate.matched_headers.join(", "),
        candidate.banking_headers.join(", "),
        candidate.score
      ])),
    "## Required counts",
    table(["Measure", "Value"], [
      ["1. exact worksheet used", report.workbook.sheet_name],
      ["2. total genuine finance rows", summary.genuine_finance_rows],
      ["5. exact Student matches by CustomerID", summary.exact_student_matches_by_customer_id],
      ["6. ambiguous matches", summary.ambiguous_student_matches],
      ["7. unmatched rows", summary.unmatched_rows],
      ["8. rows with valid bank details", summary.rows_with_valid_bank_details],
      ["9. rows missing bank details", summary.rows_missing_bank_details],
      ["14. valid account numbers", summary.valid_account_numbers],
      ["15. malformed account numbers", summary.malformed_account_numbers],
      ["17. Address coverage", summary.address_coverage],
      ["18. Fee coverage", summary.fee_coverage],
      ["Invalid Fee rows", summary.invalid_fee_rows],
      ["Date Rico YYYYMM rows", summary.date_rico_yyyymm_rows],
      ["Non-student/helper rows", summary.non_student_helper_rows],
      ["11. production-importable rows", summary.production_importable_rows],
      ["12. rows requiring partial import", summary.rows_requiring_partial_import],
      ["13. rows completely blocked", summary.rows_completely_blocked]
    ]),
    "## Final preview: 1. Rows 15 and 26 resolution",
    table(["Row", "CustomerID", "NameJp", "Katakana", "Masked phone", "Recommendation", "Reason"],
      report.ambiguous_customer_id_resolution.map((entry) => [
        entry.source_row_number,
        entry.customer_id,
        entry.name_jp,
        entry.katakana,
        entry.masked_phone || "(blank)",
        entry.recommendation,
        entry.reason
      ])),
    table(["Row", "Candidate Student UUID", "Candidate name", "Candidate legacy_customer_id", "Matching signals", "Conflicting signals"],
      report.ambiguous_customer_id_resolution.flatMap((entry) => entry.candidate_students.map((candidate) => [
        entry.source_row_number,
        candidate.student_id,
        candidate.student_name,
        candidate.legacy_customer_id,
        candidate.matching_signals.join(", ") || "(none)",
        candidate.conflicting_signals.join(", ") || "(none)"
      ]))),
    "## Final preview: 2. Exact Student UUIDs proposed",
    report.final_production_policy.production_importable_source_rows.length
      ? table(["Source row", "Student UUID"], report.rows
        .filter((row) => row.student_match_category === "A")
        .map((row) => [row.source_row_number, row.matched_student_id]))
      : "No production Student UUID links are proposed.",
    "## 3. Exact headers and 4. populated columns",
    table(["Excel column", "Exact source header", "Audit JSON key", "Populated rows"],
      report.workbook.columns.map((column) => [
        column.column_letter,
        rawLabel(column.source_header),
        column.header,
        report.populated_columns.find((entry) => entry.column === column.header)?.count || 0
      ])),
    "## 10. Unique bank names",
    table(["Bank name", "Count", "Rows"], report.unique_values.bank_names.map((entry) => [rawLabel(entry.raw_value), entry.count, entry.source_rows.join(", ")])),
    "## 11. Unique account types",
    table(["Raw value", "Count", "Canonical", "Status", "Rows"],
      report.unique_values.account_types.map((entry) => [
        rawLabel(entry.raw_value),
        entry.count,
        entry.normalized.canonical || "(unresolved/blank)",
        entry.normalized.status,
        entry.source_rows.join(", ")
      ])),
    "## 12. Bank-code formats and 13. Branch-code formats",
    table(["Field", "Format", "Count", "Rows"], [
      ...report.unique_values.bank_code_formats.map((entry) => ["Bank Code", entry.format, entry.count, entry.source_rows.join(", ")]),
      ...report.unique_values.branch_code_formats.map((entry) => ["Branch Code", entry.format, entry.count, entry.source_rows.join(", ")])
    ]),
    "### Final preview: 4. Bank-code/branch-code normalization",
    table(["Field", "Expected length", "Storage type", "Valid", "Malformed", "Missing", "Normalization policy"], [
      ["Bank Code", report.bank_code_branch_code_policy.bank_code.expected_length, report.bank_code_branch_code_policy.bank_code.storage_type, report.bank_code_branch_code_policy.bank_code.valid_count, report.bank_code_branch_code_policy.bank_code.malformed_count, report.bank_code_branch_code_policy.bank_code.missing_count, report.bank_code_branch_code_policy.bank_code.normalization_safe],
      ["Branch Code", report.bank_code_branch_code_policy.branch_code.expected_length, report.bank_code_branch_code_policy.branch_code.storage_type, report.bank_code_branch_code_policy.branch_code.valid_count, report.bank_code_branch_code_policy.branch_code.malformed_count, report.bank_code_branch_code_policy.branch_code.missing_count, report.bank_code_branch_code_policy.branch_code.normalization_safe]
    ]),
    "### Final preview: 5. Bank-name normalization policy",
    table(["Raw bank name", "Legacy Bank Code", "Canonical display name", "Rule", "Rows"],
      report.bank_name_normalization_policy.map((entry) => [
        rawLabel(entry.raw_bank_name),
        entry.legacy_bank_code || "(blank)",
        entry.canonical_display_name || "(unresolved)",
        entry.rule,
        entry.source_rows.join(", ")
      ])),
    "## 16. Account-number masking",
    "All generated report fields use account_number_masked / masked source data only. Full account numbers are not written to JSON, Markdown, console output, public assets or logs by this dry run.",
    table(["Row", "CustomerID", "Masked account", "Status", "Digit count"],
      report.rows.filter((row) => row.student_match_category !== "D").map((row) => [
        row.source_row_number,
        row.legacy_customer_id,
        row.normalized_candidate.bank_account.account_number_masked || "(blank)",
        row.normalized_candidate.bank_account.account_number_status,
        row.normalized_candidate.bank_account.account_number_digit_count
      ])),
    "### Final preview: 3. Malformed account-number analysis",
    table(["Row", "Bank name", "Masked account", "Raw string length", "Character-type issue", "Issue", "Excel formatting assessment"],
      report.malformed_account_number_analysis.map((entry) => [
        entry.source_row_number,
        entry.bank_name || "(blank)",
        entry.masked_account_number || "(blank)",
        entry.raw_string_length,
        entry.character_type_issue,
        entry.issue,
        entry.excel_formatting_assessment
      ])),
    "## 19. Fee distinct values/patterns",
    table(["Raw value", "Count", "Normalized monthly_fee_yen", "Status", "Rows"],
      report.unique_values.fee_values.map((entry) => [
        rawLabel(entry.raw_value),
        entry.count,
        entry.normalized.monthly_fee_yen ?? "(none)",
        entry.normalized.status,
        entry.source_rows.join(", ")
      ])),
    `Final preview: 6. Valid monthly Fee rows: ${summary.fee_coverage}. Clean values become student_billing_profiles.monthly_fee_yen as integer JPY.`,
    `Final preview: 7. Invalid Fee row count: ${summary.invalid_fee_rows}. Invalid values stay staged as warnings and leave production monthly_fee_yen NULL.`,
    `Final preview: 8. Address importable count: ${summary.address_coverage}. Rows without address remain valid.`,
    "## 20. Katakana interpretation and 21. Yomigana interpretation",
    report.correlations.katakana_yomigana.interpretation,
    `Both present: ${report.correlations.katakana_yomigana.both_present_count}. Same normalized value: ${report.correlations.katakana_yomigana.same_normalized_value_count}.`,
    "## 22. Date Rico interpretation",
    "Values are staged as raw YYYYMM-like month markers. They most likely indicate a Rico/direct-debit start month, but the dry run keeps Date Rico Start staging-only and writes no production effective/start date.",
    table(["Raw value", "Count", "Parsed month", "Rows"],
      report.unique_values.date_rico_values.map((entry) => [
        rawLabel(entry.raw_value),
        entry.count,
        entry.normalized.parsed_month || "(unresolved)",
        entry.source_rows.join(", ")
      ])),
    "Date Rico by Active value:",
    `\`${JSON.stringify(report.correlations.date_rico_by_active)}\``,
    "## 23. Exact proposed production schema",
    ...report.production_schema.map((entry) => `- ${entry}`),
    "## 24. Exact RLS/access policy",
    ...report.rls_policy.map((entry) => `- ${entry}`),
    "## Current finance/billing architecture audit",
    "Existing tables are student_charges, student_payments, student_payment_allocations and student_refunds, guarded by can_manage_student_billing_org. There is no existing dedicated recurring tuition profile, student bank-account table or enrolled-student address table in the inspected migrations/snapshot.",
    "## 25. Exact fields that would be imported",
    table(["Source", "Production target", "Rule"], report.production_field_mapping.map((entry) => [entry.source, entry.target, entry.rule])),
    "## Final preview: 11-13. Production import policy",
    report.final_production_policy.policy,
    table(["Measure", "Rows"], [
      ["Production-importable rows", `${summary.production_importable_rows}: ${report.final_production_policy.production_importable_source_rows.join(", ")}`],
      ["Rows requiring partial import", `${summary.rows_requiring_partial_import}: ${report.final_production_policy.partial_import_source_rows.join(", ")}`],
      ["Rows completely blocked", `${summary.rows_completely_blocked}: ${report.final_production_policy.completely_blocked_source_rows.join(", ")}`]
    ]),
    "## 26. Fields remaining unresolved",
    ...report.unresolved_fields.map((entry) => `- ${entry}`),
    "## Row-by-row link audit",
    table(["Row", "CustomerID", "Category", "Matched student UUID", "Confidence", "Bank status", "Warnings"],
      report.rows.map((row) => [
        row.source_row_number,
        row.legacy_customer_id || "(blank)",
        row.student_match_category,
        row.matched_student_id || "(none)",
        row.match_confidence,
        row.normalized_candidate.bank_account.bank_details_status,
        row.warnings.map((warning) => warning.code).join("; ") || "(none)"
      ])),
    "## Staging",
    `Unapplied staging target: ${report.staging.batches_table} / ${report.staging.rows_table}. Idempotency key: ${report.staging.idempotency_key.join(" + ")}. Persisted by this dry run: ${report.staging.persisted}.`,
    report.staging.report_sensitive_policy,
    "These reports are generated under an ignored local audit directory."
  ].join("\n\n") + "\n";
}

function printConsoleSummary(report) {
  const summary = report.summary;
  console.log("Legacy finance/banking dry run");
  console.log("================================");
  console.log("Mode: dry_run_only; database writes: 0; migrations applied: 0; production import: no");
  console.log(`Worksheet used: ${report.workbook.sheet_name}`);
  console.log(`Genuine finance rows: ${summary.genuine_finance_rows}`);
  console.log(`Exact CustomerID student matches: ${summary.exact_student_matches_by_customer_id}`);
  console.log(`Ambiguous matches: ${summary.ambiguous_student_matches}`);
  console.log(`Unmatched rows: ${summary.unmatched_rows}`);
  console.log(`Valid bank-detail rows: ${summary.rows_with_valid_bank_details}`);
  console.log(`Missing bank-detail rows: ${summary.rows_missing_bank_details}`);
  console.log(`Valid account numbers: ${summary.valid_account_numbers}`);
  console.log(`Malformed account numbers: ${summary.malformed_account_numbers}`);
  console.log(`Address coverage: ${summary.address_coverage}`);
  console.log(`Fee coverage: ${summary.fee_coverage}`);
  console.log(`Reports contain masked account numbers only.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/legacy-finance-banking-import-dry-run.js [--file workbook.xlsm] [--snapshot read-only-snapshot.json] [--report-dir private-directory]\nThe command identifies and audits the Rico finance/banking worksheet. There is no execute, import, stage, migration-apply, deploy or push option.");
    return;
  }
  const workbook = readLegacyStudentWorkbook(resolve(args.file || "data/legacy/students-legacy.xlsm"));
  const snapshot = args.snapshot ? JSON.parse(readFileSync(resolve(args.snapshot), "utf8")) : await loadLegacyFinanceBankingSnapshot();
  const report = buildLegacyFinanceBankingDryRun({ workbook, snapshot });
  report.snapshot_source = args.snapshot ? "explicit offline snapshot replay" : "live read-only transaction";
  const directory = resolve(args.reportDir || "data/legacy/finance-banking-audit");
  const jsonPath = resolve(directory, "finance-banking-dry-run.json");
  const markdownPath = resolve(directory, "finance-banking-dry-run.md");
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n");
  writeFileSync(markdownPath, renderReport(report));
  printConsoleSummary(report);
  console.log(`Wrote masked JSON report: ${jsonPath}`);
  console.log(`Wrote masked Markdown report: ${markdownPath}`);
}

main().catch(() => {
  console.error("Finance/banking audit failed; no production import, staging write, migration apply or deployment was attempted. Check arguments, workbook availability, DB credentials/read permissions, snapshot schema and local PostgreSQL client setup.");
  process.exitCode = 1;
});
