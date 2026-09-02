#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildLegacyStudentImportDryRun, readLegacyStudentWorkbook } from "../lib/legacy-student-imports.js";

const args = parseArgs(process.argv.slice(2));

if (!args.file) {
  printUsage();
  process.exit(1);
}

const workbook = readLegacyStudentWorkbook(resolve(args.file));
const teacherMappings = args.teacherMap ? JSON.parse(readFileSync(resolve(args.teacherMap), "utf8")) : {};
const existingStudents = args.existingStudents ? JSON.parse(readFileSync(resolve(args.existingStudents), "utf8")) : [];
const dryRun = buildLegacyStudentImportDryRun({
  workbook,
  sheetName: args.sheet,
  targetSchoolName: args.school || "Ohashi",
  teacherMappings,
  existingStudents
});

printDryRunSummary(dryRun);

if (args.writeReport) {
  writeFileSync(resolve(args.writeReport), `${JSON.stringify(dryRun, null, 2)}\n`);
  console.log(`\nWrote dry-run report: ${resolve(args.writeReport)}`);
}

function parseArgs(values) {
  const parsed = {};

  for (let index = 0; index < values.length; index += 1) {
    const arg = values[index];
    const next = values[index + 1];

    if (arg === "--file") {
      parsed.file = next;
      index += 1;
    } else if (arg === "--sheet") {
      parsed.sheet = next;
      index += 1;
    } else if (arg === "--school") {
      parsed.school = next;
      index += 1;
    } else if (arg === "--teacher-map") {
      parsed.teacherMap = next;
      index += 1;
    } else if (arg === "--existing-students") {
      parsed.existingStudents = next;
      index += 1;
    } else if (arg === "--write-report") {
      parsed.writeReport = next;
      index += 1;
    }
  }

  return parsed;
}

function printUsage() {
  console.error(`Usage:
  node scripts/legacy-student-import-dry-run.js --file <legacy.xlsx> [options]

Options:
  --sheet <sheet name>              Dry-run one sheet only.
  --school <school name>            Target school label for the preview. Defaults to Ohashi.
  --teacher-map <mapping.json>      Approved legacy teacher-name to profile-id mapping.
  --existing-students <students.json> Existing students for duplicate detection.
  --write-report <report.json>      Write the full dry-run report JSON.
`);
}

function printDryRunSummary(dryRun) {
  const { summary } = dryRun;

  console.log("Legacy student import dry run");
  console.log("=============================");
  console.log(`Workbook sheets: ${dryRun.workbook.sheets.map((sheet) => `${sheet.name} (${sheet.row_count})`).join(", ") || "none"}`);
  console.log(`Target school: ${summary.target_school_name}`);
  console.log(`Source rows: ${summary.total_source_rows}`);
  console.log(`Active students: ${summary.active_students}`);
  console.log(`Inactive/stopped students: ${summary.inactive_or_stopped_students}`);
  console.log(`Valid rows: ${summary.valid_rows}`);
  console.log(`Rows with warnings: ${summary.rows_with_warnings}`);
  console.log(`Rows with errors: ${summary.rows_with_errors}`);
  console.log(`Duplicate candidates: ${summary.duplicate_candidates}`);
  console.log(`Unknown teachers: ${summary.unknown_teachers.length}`);
  console.log(`Conflicting start/joining dates: ${summary.conflicting_start_joining_dates}`);
  console.log(`Invalid emails: ${summary.invalid_emails}`);
  console.log(`Invalid phones: ${summary.invalid_phones}`);
  console.log(`Invalid birthdays: ${summary.invalid_birthdays}`);

  console.log("\nHeaders detected:");
  for (const sheet of dryRun.workbook.sheets) {
    console.log(`- ${sheet.name}: ${sheet.headers.join(", ") || "(none)"}`);
  }

  console.log("\nPopulated legacy columns:");
  printColumnCounts(summary.populated_legacy_columns);

  console.log("\nOwner-approved ignored obsolete columns:");
  printColumnCounts(summary.ignored_legacy_columns);

  console.log("\nUnused empty columns:");
  printColumnCounts(summary.completely_unused_empty_columns);

  console.log("\nUnresolved fields:");
  if (summary.unresolved_fields.length) {
    for (const item of summary.unresolved_fields) {
      console.log(`- ${item.code}: ${item.value} (${item.count})`);
    }
  } else {
    console.log("- none");
  }

  console.log("\nRecommendations:");
  console.log(`- Fee: ${summary.fee_handling_recommendation}`);
  console.log(`- Address: ${summary.address_handling_recommendation}`);
  console.log(`- Reviews: ${summary.review_state_handling_recommendation}`);
}

function printColumnCounts(columns) {
  if (!columns.length) {
    console.log("- none");
    return;
  }

  for (const column of columns) {
    console.log(`- ${column.column}: ${column.count}`);
  }
}
