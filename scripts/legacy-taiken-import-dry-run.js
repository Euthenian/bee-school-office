#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { readLegacyStudentWorkbook } from "../lib/legacy-student-imports.js";
import { buildLegacyTaikenDryRun } from "../lib/legacy-taiken-imports.js";
import { loadLegacyTaikenSnapshot } from "../lib/legacy-taiken-snapshot.js";

function parseArgs(argv) {
  const options = {};
  const flags = { "--file": "file", "--snapshot": "snapshot", "--teacher-map": "teacherMap", "--report-dir": "reportDir" };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") { options.help = true; continue; }
    if (!flags[flag]) throw new Error(`Unsupported argument ${flag}. This command only audits Taiken and has no write/import mode.`);
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
  const sections = [
    "# Legacy Taiken dry-run audit",
    `Generated: ${report.generated_at}. Database snapshot: ${report.database_snapshot_at} (${report.snapshot_source}).`,
    "**No database writes, staging writes, production import, deployment or push were performed by this command.**",
    `Source: ${report.workbook.file.name}; SHA-256: \`${report.workbook.file.sha256}\`; worksheet: Taiken only; dimension: ${report.workbook.dimension}.`,
    `Target: Bee School HQ (${report.target.organization_id}) / Ohashi (${report.target.school_id}). Current target-school Students: ${summary.existing_students_in_target_school}.`,
    "## Counts",
    table(["Measure", "Count"], Object.entries(summary).filter(([, value]) => typeof value === "number")),
    `Duplicate candidate groups: ${JSON.stringify(summary.duplicate_candidate_groups)}. These are flagged for review, never silently removed.`,
    "## Exact headers and populated columns",
    "Empty source headers are distinguished from generated JSON keys; counts exclude only explicitly identified non-data legend rows.",
    table(["Excel column", "Exact source header", "Audit JSON key", "Populated rows"],
      report.workbook.columns.map((column) => [column.column_letter, rawLabel(column.source_header), column.header, summary.populated_columns.find((entry) => entry.column === column.header)?.count || 0])),
    "## Every categorical raw value and proposed mapping",
    "Null mappings remain unresolved or blank. Numeric raw values remain numbers in JSON; no unexplained code is treated as CustomerID.",
    ...Object.entries(report.unique_values).flatMap(([column, values]) => [
      `### ${column}`,
      table(["Raw value", "Count", "Source rows", "Proposed canonical value"], values.map((item) => [
        rawLabel(item.raw_value), item.count, item.source_rows.join(", "), "proposed_mapping" in item ? item.proposed_mapping || "(unresolved/blank)" : "(see status evidence / staging only)"
      ]))
    ]),
    "## Status interpretation and Student correlations",
    "Explicit yes/Yes proposes Joined, unless another Joined column or refusal date conflicts. Explicit no/n proposes Did not join. Refusal dates preserve non-conversion evidence. Date-only Joined cells are owner-review candidates and do not write joined status. Exact cancellation phrases propose Cancelled. Blank outcomes remain unresolved; dates alone never establish attendance.",
    table(["Proposed status", "Rows"], Object.entries(summary.proposed_status_counts)),
    ...report.status_student_correlations.flatMap((entry) => [
      `### ${entry.column} versus current Student matches`,
      table(["Raw value", "Count", "A strong", "B ambiguous", "C no match"], entry.values.map((value) => [rawLabel(value.raw_value), value.count, value.matches.A, value.matches.B, value.matches.C]))
    ]),
    "## Proposed exact Student UUID links",
    "A requires one exact legacy ID if reliably available, or exact normalized email/phone plus an exact compatible identity. Names alone and shared/contradictory identities remain B. No reliable CustomerID exists in this Taiken sheet. Named participant identities take precedence over contact-person names. No Students will be created or merged.",
    report.proposed_student_matches.length ? table(["Source row", "Existing Student UUID", "Converted UUID to write", "Evidence", "Student profile"],
      report.proposed_student_matches.map((match) => [match.source_row_number, match.student_id, match.converted_student_id || "(withheld: conversion unresolved)", match.signals.map((signal) => signal.signals.join(" + ")).join("; "), match.profile_path]))
      : "No automatic Student UUID links are proposed.",
    "### Every conversion candidate requiring review or link confirmation",
    table(["Row", "Joined", "Joined2", "Category", "Candidate UUIDs and signals", "Outcome evidence"],
      report.rows.filter((row) => row.normalized_candidate.status_evidence.joined_candidate).map((row) => [
        row.source_row_number, rawLabel(row.raw_source_data.Joined), rawLabel(row.raw_source_data.Joined2), row.student_match_category,
        row.student_match_candidates.map((candidate) => `${candidate.student_id} (${candidate.signals.join(" + ")})`).join("; ") || "(none)",
        row.normalized_candidate.status_evidence.reason
      ])),
    "## Refusal date patterns",
    table(["Raw value", "Count", "Pattern", "Parsed historical date"],
      report.unique_values["refusal date"].map((item) => [rawLabel(item.raw_value), item.count, typeof item.raw_value === "number" ? "Excel date serial" : item.raw_value ? "text / unresolved" : "blank",
        report.rows.find((row) => row.source_row_number === item.source_rows[0])?.normalized_candidate.historical_refusal_date || "(none)"])),
    "## Teachers",
    "No alias-to-profile mapping is inferred from a first name. Only owner-supplied exact raw mappings to a currently eligible Ohashi profile are accepted.",
    `Approved mappings supplied: ${JSON.stringify(report.teachers.approved_mappings)}.`,
    table(["Existing profile UUID", "Name", "Eligible Ohashi teacher"],
      report.teachers.eligible_profiles.map((teacher) => [teacher.profile_id, teacher.staff_display_name || teacher.full_name, "yes"])),
    "## Production fields proposed",
    table(["Source", "Existing production target", "Rule"], report.production_field_mapping.map((entry) => [entry.source, entry.target, entry.rule])),
    "All prospective rows include organization_id and school_id. A future approved transaction would generate IDs and attach prospect_contacts.prospect_id, trial_lessons.prospect_id and trial_lesson_participants.trial_lesson_id. Each row's exact candidate values are in the companion JSON. Postal adress/address remains only in raw_source_data; no Student/Auth writes are proposed.",
    "## Remaining complete import blockers",
    Object.keys(summary.import_blocker_counts).length
      ? table(["Blocker", "Rows"], Object.entries(summary.import_blocker_counts))
      : "None. Every genuine Taiken row has enough identity or history to preserve as a historical record.",
    "## Current production schema gaps, not import blockers",
    "These fields are still NOT NULL in the current production schema or otherwise required by the existing production write path. They require an approved schema/import-path adjustment before a real import; the dry run does not fabricate values.",
    report.current_production_schema_gaps.length
      ? table(["Schema field", "Count", "Source rows"], report.current_production_schema_gaps.map((entry) => [entry.name, entry.count, entry.source_rows.join(", ")]))
      : "None.",
    ...report.unresolved_business_meanings.map((meaning) => `- ${meaning}`),
    "## Row-by-row audit",
    table(["Source row", "Date", "Time", "Status", "Participants", "Match category", "Chosen Student UUID", "Warnings / blockers"],
      report.rows.map((row) => {
        const candidate = row.normalized_candidate;
        return [row.source_row_number, candidate.trial_lesson.trial_date, candidate.trial_lesson.trial_time, candidate.trial_lesson.status || "unresolved",
          candidate.participants.length, row.student_match_category, row.chosen_converted_student_id,
          [...row.warnings.map((warning) => `${warning.code}: ${warning.column}`), ...candidate.import_blockers].join("; ")];
      })),
    "## Staging and rerun safety",
    "The unapplied migration extends legacy_student_import_batches and legacy_student_import_rows with import_kind=taiken. Source identity is school_id + source_file_sha256 + Taiken + source_row_number, enforced across batches. Raw source, normalized candidates, warnings, matching evidence, chosen existing UUIDs and future production receipts remain auditable. This dry run writes only these local reports. No production executor is exposed; a reviewed, atomic executor and resolution of historical required fields are still needed before importing.",
    "## Excluded non-data rows",
    report.excluded_rows.length ? table(["Source row", "Reason"], report.excluded_rows.map((row) => [row.source_row_number, row.reason])) : "None. All populated source rows are preserved.",
    "The reports contain personal data and remain in the ignored local taiken-audit directory."
  ];
  return sections.join("\n\n") + "\n";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/legacy-taiken-import-dry-run.js [--file workbook.xlsm] [--snapshot read-only-snapshot.json] [--teacher-map approved.json] [--report-dir private-directory]\nOnly worksheet Taiken is read. Live read-only DB lookup is the default. --snapshot explicitly replays a prior snapshot. There is no execute, import, stage, deploy or push option.");
    return;
  }
  const workbook = readLegacyStudentWorkbook(resolve(args.file || "data/legacy/students-legacy.xlsm"), { sheetNames: ["Taiken"] });
  const snapshot = args.snapshot ? JSON.parse(readFileSync(resolve(args.snapshot), "utf8")) : await loadLegacyTaikenSnapshot();
  const teacherMappings = args.teacherMap ? JSON.parse(readFileSync(resolve(args.teacherMap), "utf8")) : {};
  const report = buildLegacyTaikenDryRun({ workbook, snapshot, teacherMappings });
  report.snapshot_source = args.snapshot ? "explicit offline snapshot replay" : "live read-only transaction";
  const directory = resolve(args.reportDir || "data/legacy/taiken-audit");
  const jsonPath = resolve(directory, "taiken-dry-run.json");
  const markdownPath = resolve(directory, "taiken-dry-run.md");
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n");
  writeFileSync(markdownPath, renderReport(report));
  console.log(JSON.stringify({ mode: report.mode, database_writes: 0, ...report.summary, reports: [jsonPath, markdownPath] }, null, 2));
}

main().catch(() => {
  // Driver errors may contain credentials, host details or source PII.
  console.error("Taiken audit failed; no production import was attempted. Check arguments, the selected workbook, DB credentials/read permissions, snapshot schema, and approved teacher mappings.");
  process.exitCode = 1;
});
