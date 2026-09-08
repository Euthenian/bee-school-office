import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseXlsxWorkbook, readLegacyStudentWorkbook } from "../lib/legacy-student-imports.js";

const workbookXml = '<workbook><workbookPr date1904="1"/><sheets><sheet name="Students" r:id="rId1"/><sheet name="Taiken" r:id="rId2"/></sheets></workbook>';
const relationshipsXml = '<Relationships><Relationship Id="rId1" Target="worksheets/students.xml"/><Relationship Id="rId2" Target="worksheets/taiken.xml"/></Relationships>';
const taikenXml = '<worksheet><dimension ref="A1:D5"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1"/><c r="C1" t="inlineStr"><is><t>Joined</t></is></c></row><row r="2"><c r="A2"/><c r="B2"/><c r="C2" t="s"><v>0</v></c><c r="D2" t="inlineStr"><is><t>Unlabelled source data</t></is></c></row><row r="3"/><row r="5"><c r="A5" t="inlineStr"><is><t>Example Prospect</t></is></c><c r="C5"><v>45843</v></c></row></sheetData></worksheet>';

function workbook(overrides = {}) {
  return createZip({
    "xl/workbook.xml": workbookXml,
    "xl/_rels/workbook.xml.rels": relationshipsXml,
    "xl/sharedStrings.xml": '<sst><si><t>yes</t></si></sst>',
    "xl/worksheets/students.xml": { text: "intentionally invalid deflate bytes", method: 8 },
    "xl/worksheets/taiken.xml": taikenXml,
    ...overrides
  });
}

test("Taiken selection never extracts another worksheet, even when its payload cannot be decompressed", () => {
  const parsed = parseXlsxWorkbook(workbook(), "legacy.xlsm", { sheetNames: ["Taiken"] });
  assert.deepEqual(parsed.sheets.map((sheet) => sheet.name), ["Taiken"]);
  assert.equal(parsed.sheets[0].rows.length, 2);
  assert.equal(parsed.date1904, true);
  assert.throws(() => parseXlsxWorkbook(workbook()), /invalid|distance|block|code/i);
});

test("worksheet selection fails closed for missing or differently cased names and missing relationships", () => {
  assert.throws(() => parseXlsxWorkbook(workbook(), "legacy.xlsm", { sheetName: "taiken" }), /Requested worksheet was not found/);
  assert.throws(() => parseXlsxWorkbook(workbook({ "xl/_rels/workbook.xml.rels": "<Relationships/>" }), "legacy.xlsm", { sheetName: "Taiken" }), /has no workbook relationship/);
});

test("worksheet reader preserves cells after self-closing empty cells and reports source coordinates", () => {
  const sheet = parseXlsxWorkbook(workbook(), "legacy.xlsm", { sheetName: "Taiken" }).sheets[0];
  assert.deepEqual(sheet.headers, ["Name", "Column2", "Joined", "Column4"]);
  assert.deepEqual(sheet.rows.map((row) => row.rowNumber), [2, 5]);
  assert.deepEqual(sheet.rows[0].values, { Name: "", Column2: "", Joined: "yes", Column4: "Unlabelled source data" });
  assert.equal(sheet.rows[1].values.Joined, 45843);
  assert.equal(sheet.dimension, "A1:D5");
  assert.equal(sheet.headerRowNumber, 1);
  assert.equal(sheet.physicalRowCount, 4);
  assert.equal(sheet.physicalDataRowCount, 3);
  assert.equal(sheet.firstPhysicalRowNumber, 1);
  assert.equal(sheet.lastPhysicalRowNumber, 5);
  assert.deepEqual(sheet.columns[2], { column_index: 3, column_letter: "C", source_header: "Joined", header: "Joined" });
});

test("raw duplicate and whitespace-bearing headers do not overwrite source cells", () => {
  const xml = '<worksheet><sheetData><row r="2"><c r="A2" t="inlineStr"><is><t> Name </t></is></c><c r="B2" t="inlineStr"><is><t>Name</t></is></c><c r="C2" t="inlineStr"><is><t>Name [2]</t></is></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>First</t></is></c><c r="B3" t="inlineStr"><is><t>Second</t></is></c><c r="C3" t="inlineStr"><is><t>Third</t></is></c></row></sheetData></worksheet>';
  const sheet = parseXlsxWorkbook(workbook({ "xl/worksheets/taiken.xml": xml }), "legacy.xlsm", { sheetName: "Taiken" }).sheets[0];
  assert.deepEqual(Object.values(sheet.rows[0].values), ["First", "Second", "Third"]);
  assert.equal(sheet.columns[0].source_header, " Name ");
  assert.equal(sheet.headerRowNumber, 2);
});

test("filesystem workbook reader forwards strict selection and rejects CSV sheet-selection substitutions", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "taiken-workbook-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "legacy.xlsm");
  writeFileSync(path, workbook());
  const parsed = readLegacyStudentWorkbook(path, { sheetName: "Taiken" });
  assert.equal(parsed.sheets.length, 1);
  assert.match(parsed.file.sha256, /^[a-f0-9]{64}$/);
  const csvPath = join(directory, "Taiken.csv");
  writeFileSync(csvPath, "Name,Joined\nExample,yes\n");
  assert.throws(() => readLegacyStudentWorkbook(csvPath, { sheetName: "Taiken" }), /selection requires an XLSX or XLSM/);
});

function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, entry] of Object.entries(entries)) {
    const fileName = Buffer.from(name);
    const data = Buffer.from(typeof entry === "string" ? entry : entry.text);
    const method = typeof entry === "string" ? 0 : entry.method;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    localParts.push(local, fileName, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, fileName);
    offset += local.length + fileName.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

test("selected inline-string worksheets do not decode workbook shared strings used elsewhere", () => {
  const inlineOnly = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Example</t></is></c></row></sheetData></worksheet>';
  const parsed = parseXlsxWorkbook(workbook({
    "xl/worksheets/taiken.xml": inlineOnly,
    "xl/sharedStrings.xml": { text: "invalid deflate bytes from an unused shared string table", method: 8 }
  }), "legacy.xlsm", { sheetName: "Taiken" });
  assert.equal(parsed.sheets[0].rows[0].values.Name, "Example");
});

test("selected shared-string indexes retain their original positions when unused indexes are skipped", () => {
  const parsed = parseXlsxWorkbook(workbook({
    "xl/worksheets/taiken.xml": taikenXml.replace('<v>0</v>', '<v>2</v>'),
    "xl/sharedStrings.xml": '<sst><si><t>Unused one</t></si><si><t>Unused two</t></si><si><t>yes</t></si></sst>'
  }), "legacy.xlsm", { sheetName: "Taiken" });
  assert.equal(parsed.sheets[0].rows[0].values.Joined, "yes");
});
