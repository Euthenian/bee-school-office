import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildLegacyStudentImportDryRun,
  IGNORED_LEGACY_COLUMNS,
  LEGACY_STUDENT_IMPORT_BATCHES_TABLE,
  LEGACY_STUDENT_IMPORT_ROWS_TABLE,
  readLegacyStudentWorkbook
} from "../lib/legacy-student-imports.js";

const migrationSql = readFileSync(
  new URL("../supabase/migrations/20260902001000_legacy_student_import_staging.sql", import.meta.url),
  "utf8"
);

test("legacy importer ignores owner-approved obsolete columns even when populated", () => {
  const dryRun = buildLegacyStudentImportDryRun({
    workbook: workbookFromRows([
      {
        CustomerID: "B-001",
        Active: "yes",
        t: "Aki",
        "Last Name": "Tanaka",
        Mail: "aki@example.com",
        "Name Suffix": "old suffix",
        "To finance": "old finance note",
        "RICO Next fee": "1000",
        "Detail next fee": "old detail",
        Column2: "legacy helper"
      }
    ])
  });

  assert.equal(dryRun.summary.total_source_rows, 1);
  assert.equal(dryRun.rows[0].validation_state, "valid");
  assert.deepEqual(dryRun.rows[0].unresolved, []);
  assert.equal(dryRun.summary.ignored_legacy_columns.length, IGNORED_LEGACY_COLUMNS.length);
  assert.equal(dryRun.summary.unresolved_fields.length, 0);

  for (const column of IGNORED_LEGACY_COLUMNS) {
    assert.equal(dryRun.rows[0].raw_source_data[column] !== undefined, true);
    assert.doesNotMatch(JSON.stringify(dryRun.rows[0].normalized_candidate), new RegExp(column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("birthday takes priority over age and age is used only when birthday is blank", () => {
  const dryRun = buildLegacyStudentImportDryRun({
    workbook: workbookFromRows([
      { CustomerID: "B-001", Active: "yes", t: "Aki", "Last Name": "Tanaka", Birthday: "2015-04-01", Age: "99" },
      { CustomerID: "B-002", Active: "yes", t: "Ren", "Last Name": "Sato", Birthday: "", Age: "8" }
    ])
  });

  assert.equal(dryRun.rows[0].normalized_candidate.date_of_birth, "2015-04-01");
  assert.equal(dryRun.rows[0].normalized_candidate.age_override, null);
  assert.equal(dryRun.rows[1].normalized_candidate.date_of_birth, null);
  assert.equal(dryRun.rows[1].normalized_candidate.age_override, 8);
});

test("conflicting dates, bad contacts, and unknown teachers are surfaced for review", () => {
  const dryRun = buildLegacyStudentImportDryRun({
    workbook: workbookFromRows([
      {
        CustomerID: "B-001",
        Active: "yes",
        t: "Aki",
        "Last Name": "Tanaka",
        Joining: "2024-04-01",
        "Start Date": "2024-05-01",
        Mail: "not-an-email",
        "\u643a\u5e2f": "abc",
        Teacher: "Legacy Teacher"
      }
    ]),
    teacherMappings: {}
  });
  const row = dryRun.rows[0];

  assert.equal(row.validation_state, "error");
  assert.equal(row.errors.some((error) => error.code === "conflicting_start_dates"), true);
  assert.equal(row.errors.some((error) => error.code === "invalid_email"), true);
  assert.equal(row.warnings.some((warning) => warning.code === "invalid_phone"), true);
  assert.equal(row.unresolved.some((item) => item.code === "unknown_teacher" && item.value === "Legacy Teacher"), true);
  assert.equal(dryRun.summary.conflicting_start_joining_dates, 1);
  assert.equal(dryRun.summary.invalid_emails, 1);
  assert.equal(dryRun.summary.invalid_phones, 1);
});

test("teacher mappings must point to existing profile ids and duplicate candidates are reported", () => {
  const dryRun = buildLegacyStudentImportDryRun({
    workbook: workbookFromRows([
      { CustomerID: "B-001", Active: "yes", t: "Aki", "Last Name": "Tanaka", Mail: "aki@example.com", Teacher: "Mika" },
      { CustomerID: "B-001", Active: "yes", t: "Aki", "Last Name": "Tanaka", Mail: "aki@example.com", Teacher: "Mika" }
    ]),
    teacherMappings: { Mika: { profile_id: "11111111-1111-4111-8111-111111111111" } },
    existingStudents: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        first_name: "Aki",
        last_name: "Tanaka",
        student_contacts: [{ contact_type: "email", value: "aki@example.com" }]
      }
    ]
  });

  assert.equal(dryRun.rows[0].normalized_candidate.teacher.match_status, "mapped");
  assert.equal(dryRun.rows[0].normalized_candidate.teacher.profile_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(dryRun.summary.duplicate_candidates, 2);
  assert.equal(dryRun.rows.every((row) => row.duplicate_candidates.length > 0), true);
});

test("fee, address, review state, and Japanese names are staged without production writes", () => {
  const dryRun = buildLegacyStudentImportDryRun({
    workbook: workbookFromRows([
      {
        CustomerID: "B-001",
        Active: "yes",
        t: "Aki",
        "Last Name": "Tanaka",
        NameJp: "\u7530\u4e2d",
        "Japanese Name 2": "\u3042\u304d",
        Fee: "12000",
        "Review asked": "yes",
        "Review left": "no",
        "Address 1 - Street": "1-2-3 Ohashi"
      }
    ])
  });
  const candidate = dryRun.rows[0].normalized_candidate;

  assert.equal(candidate.fee.import_action, "staged_only");
  assert.equal(candidate.address.import_action, "staged_only_model_required");
  assert.equal(candidate.review.import_action, "staged_only_policy_required");
  assert.equal(candidate.japanese_name.import_action, "staged_only_direction_required");
  assert.deepEqual(candidate.import_blockers, [
    "address_model_required",
    "student_pricing_policy_required",
    "review_state_policy_required",
    "japanese_name_mapping_required"
  ]);
});

test("direct xlsx parsing reads workbook sheets, headers, and rows from a local path", () => {
  const directory = mkdtempSync(join(tmpdir(), "bee-legacy-import-"));
  const workbookPath = join(directory, "legacy.xlsx");
  writeFileSync(
    workbookPath,
    createStoredZip({
      "xl/workbook.xml": workbookXml(),
      "xl/_rels/workbook.xml.rels": workbookRelationshipsXml(),
      "xl/worksheets/sheet1.xml": worksheetXml([
        ["CustomerID", "Active", "t", "Last Name", "Birthday", "Mail"],
        ["B-001", "yes", "Aki", "Tanaka", "2015-04-01", "aki@example.com"]
      ])
    })
  );

  const workbook = readLegacyStudentWorkbook(workbookPath);
  const dryRun = buildLegacyStudentImportDryRun({ workbook });

  assert.equal(workbook.sheets[0].name, "Students");
  assert.deepEqual(workbook.sheets[0].headers, ["CustomerID", "Active", "t", "Last Name", "Birthday", "Mail"]);
  assert.equal(dryRun.summary.total_source_rows, 1);
  assert.equal(dryRun.rows[0].normalized_candidate.legacy_customer_id, "B-001");
  assert.equal(dryRun.rows[0].normalized_candidate.contacts[0].value, "aki@example.com");
});

test("legacy import staging migration is admin-scoped and keeps obsolete fields out of production schema", () => {
  assert.match(migrationSql, new RegExp(`create table if not exists public\\.${LEGACY_STUDENT_IMPORT_BATCHES_TABLE}`));
  assert.match(migrationSql, new RegExp(`create table if not exists public\\.${LEGACY_STUDENT_IMPORT_ROWS_TABLE}`));
  assert.match(migrationSql, /raw_source_data jsonb not null/);
  assert.match(migrationSql, /normalized_candidate jsonb not null/);
  assert.match(migrationSql, /validation_state text not null default 'valid'/);
  assert.match(migrationSql, /imported_student_id uuid references public\.students/);
  assert.match(migrationSql, /alter table public\.legacy_student_import_batches enable row level security/);
  assert.match(migrationSql, /alter table public\.legacy_student_import_rows enable row level security/);
  assert.match(migrationSql, /using \(public\.can_manage_school\(school_id\)\)/);
  assert.match(migrationSql, /public\.can_access_org\(organization_id\)/);

  for (const column of IGNORED_LEGACY_COLUMNS) {
    assert.doesNotMatch(migrationSql, new RegExp(`\\b${column.replace(/\s+/g, "_")}\\b`, "i"));
  }
});

function workbookFromRows(rows) {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return {
    file: { name: "legacy.xlsx", path: "legacy.xlsx", sha256: "0".repeat(64) },
    sheets: [
      {
        name: "Students",
        headers,
        rows: rows.map((values, index) => ({ rowNumber: index + 2, values }))
      }
    ]
  };
}

function workbookXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Students" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;
}

function workbookRelationshipsXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
}

function worksheetXml(rows) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${rows.map((row, rowIndex) => rowXml(row, rowIndex + 1)).join("\n")}
  </sheetData>
</worksheet>`;
}

function rowXml(values, rowNumber) {
  return `<row r="${rowNumber}">${values.map((value, columnIndex) => cellXml(value, columnIndex, rowNumber)).join("")}</row>`;
}

function cellXml(value, columnIndex, rowNumber) {
  const reference = `${columnName(columnIndex)}${rowNumber}`;
  return `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

function columnName(index) {
  let value = "";
  let column = index + 1;

  while (column > 0) {
    const remainder = (column - 1) % 26;
    value = `${String.fromCharCode(65 + remainder)}${value}`;
    column = Math.floor((column - 1) / 26);
  }

  return value;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function createStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [name, text] of Object.entries(entries)) {
    const fileName = Buffer.from(name, "utf8");
    const data = Buffer.from(text, "utf8");
    const localHeader = Buffer.alloc(30);

    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(0, 10);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(fileName.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, fileName, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(0, 12);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(fileName.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt32LE(0, 34);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, fileName);

    offset += localHeader.length + fileName.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const centralDirectoryOffset = offset;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(centralDirectoryOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}
