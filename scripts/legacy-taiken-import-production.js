#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { readLegacyStudentWorkbook } from "../lib/legacy-student-imports.js";
import { buildLegacyTaikenDryRun } from "../lib/legacy-taiken-imports.js";
import { loadLegacyTaikenSnapshot } from "../lib/legacy-taiken-snapshot.js";

const DEFAULT_FILE = "data/legacy/students-legacy.xlsm";
const DEFAULT_ORGANIZATION = "Bee School HQ";
const DEFAULT_SCHOOL = "Ohashi";
const DEFAULT_SHEET = "Taiken";
const EXPECTED_ROWS = 108;
const EXPECTED_INVALID_OPTIONAL_PHONES = 10;
const EXPECTED_INVALID_EMAILS = 0;
const EXPECTED_STATUS_COUNTS = { joined: 15, unresolved: 87, cancelled: 2, did_not_join: 4 };
const JOINED_ROWS = new Set([2, 3, 12, 27, 28, 32, 49, 53, 57, 58, 59, 60, 61, 87, 94]);
const CANCELLED_ROWS = new Set([7, 8]);
const DID_NOT_JOIN_ROWS = new Set([30, 37, 48, 54]);
const APPROVED_STUDENT_LINKS = new Map([
  [2, "6a179773-55ff-4ff4-8753-9f61bef9ff3e"],
  [3, "c4a25321-1cb3-4ab4-8bd2-b769b35e85ff"],
  [49, "392ea0a0-1674-4d74-afa3-83670bc37c3b"],
  [60, "2d812ef4-85b6-45ca-8e74-4facaaf70419"],
  [61, "2bc43681-d960-42f9-82d8-8b6d65c6742f"]
]);

async function main() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const options = {
    file: resolve(args.file || DEFAULT_FILE),
    organization: args.organization || DEFAULT_ORGANIZATION,
    school: args.school || DEFAULT_SCHOOL,
    execute: Boolean(args.execute),
    testConnection: Boolean(args.testConnection),
    dbUrl: args.dbUrl || null,
    projectRef: args.projectRef || null
  };

  if (options.testConnection) {
    const connection = resolveConnection(options);
    printConnectionTest(await testDatabaseConnection(connection));
    console.log("\nConnection test only. No production writes performed.");
    return;
  }

  const workbook = readLegacyStudentWorkbook(options.file, { sheetNames: [DEFAULT_SHEET] });
  const snapshot = await loadLegacyTaikenSnapshot();
  const dryRun = buildLegacyTaikenDryRun({ workbook, snapshot });
  const rows = prepareRowsForProduction(dryRun.rows);
  const plan = buildProductionPlan({ dryRun, workbook, rows });
  validateExpectedPlan(plan, rows);
  printPlan(plan, { execute: options.execute });

  if (!options.execute) {
    console.log("\nNo database writes performed. Re-run with --execute after confirming the plan.");
    return;
  }

  const connection = resolveConnection(options);
  printConnectionTest(await testDatabaseConnection(connection));
  const schemaStatus = await getSchemaStatus(connection);
  assertRequiredSchema(schemaStatus);
  await notifyPostgrestSchemaReload(connection);

  const target = await resolveTargetSchool(connection, options);
  const batch = await createOrReuseImportBatch(connection, { options, target, dryRun, plan });
  await stageRows(connection, { batchId: batch.id, target, rows });
  if (batch.import_status !== "imported") await markBatchStatus(connection, batch.id, "importing");

  const importResult = await importProductionRows(connection, { batchId: batch.id, rows, target });
  await markBatchStatus(connection, batch.id, importResult.failedRows.length ? "failed" : "imported", {
    importedAt: !importResult.failedRows.length
  });

  const verification = await verifyImport(connection, { batchId: batch.id, expected: plan.expected, target });
  await stageRows(connection, { batchId: batch.id, target, rows });
  const idempotencyResult = await importProductionRows(connection, { batchId: batch.id, rows, target });
  const idempotencyVerification = await verifyImport(connection, { batchId: batch.id, expected: plan.expected, target });
  assertIdempotency(idempotencyResult, idempotencyVerification, verification);

  printResult({ batchId: batch.id, importResult, idempotencyResult, schemaStatus, verification });
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--execute") parsed.execute = true;
    else if (arg === "--test-connection") parsed.testConnection = true;
    else if (arg === "--file") { parsed.file = next; index += 1; }
    else if (arg === "--organization") { parsed.organization = next; index += 1; }
    else if (arg === "--school") { parsed.school = next; index += 1; }
    else if (arg === "--db-url") { parsed.dbUrl = next; index += 1; }
    else if (arg === "--project-ref") { parsed.projectRef = next; index += 1; }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/legacy-taiken-import-production.js --execute

Options:
  --file <path>             Legacy workbook. Defaults to ${DEFAULT_FILE}.
  --organization <name>     Target organization. Defaults to ${DEFAULT_ORGANIZATION}.
  --school <name>           Target school. Defaults to ${DEFAULT_SCHOOL}.
  --db-url <url>            Postgres connection string. Defaults to env or supabase/.temp/pooler-url.
  --project-ref <ref>       Supabase project ref. Defaults to env or supabase/.temp/project-ref.
  --test-connection         Run a safe database connection test and stop.
  --execute                 Required for staging and production writes.
`);
}

function prepareRowsForProduction(sourceRows) {
  return sourceRows.map((sourceRow) => {
    const row = cloneJson(sourceRow);
    const status = approvedStatusForRow(row.source_row_number);
    const approvedStudentId = APPROVED_STUDENT_LINKS.get(row.source_row_number) || null;
    row.normalized_candidate.trial_lesson.status = status;
    row.normalized_candidate.trial_lesson.converted_student_id = approvedStudentId;
    row.normalized_candidate.participants = (row.normalized_candidate.participants || [])
      .map((participant) => ({ ...participant, converted_student_id: null }));
    row.chosen_converted_student_id = approvedStudentId;
    row.import_status = "ready_for_import";
    row.validation_state = row.normalized_candidate.import_blockers?.length ? "error" : "warning";
    return row;
  });
}

function approvedStatusForRow(rowNumber) {
  if (JOINED_ROWS.has(rowNumber)) return "joined";
  if (CANCELLED_ROWS.has(rowNumber)) return "cancelled";
  if (DID_NOT_JOIN_ROWS.has(rowNumber)) return "did_not_join";
  return null;
}

function buildProductionPlan({ dryRun, workbook, rows }) {
  const statusCounts = countStatuses(rows);
  const contacts = rows.flatMap((row) => row.normalized_candidate.contacts || []);
  const participants = rows.flatMap((row) => row.normalized_candidate.participants || []);
  const invalidEmailRows = rows.filter((row) => row.warnings.some((warning) => warning.code === "invalid_email"));
  const invalidPhoneRows = rows.filter((row) => row.warnings.some((warning) => warning.code === "invalid_phone"));
  const linkedRows = rows.filter((row) => row.chosen_converted_student_id);

  return {
    source: {
      file_name: basename(workbook.file.name || DEFAULT_FILE),
      file_sha256: workbook.file.sha256,
      worksheet: DEFAULT_SHEET,
      dry_run_generated_at: dryRun.generated_at,
      rows: rows.length
    },
    expected: {
      staged_rows: rows.length,
      imported_trial_lessons: rows.length,
      status_counts: statusCounts,
      converted_student_links: Object.fromEntries(APPROVED_STUDENT_LINKS),
      invalid_optional_phones_skipped: invalidPhoneRows.length,
      invalid_emails: invalidEmailRows.length,
      prospect_contacts: contacts.length,
      participants: participants.length,
      linked_rows: linkedRows.map((row) => row.source_row_number)
    }
  };
}

function validateExpectedPlan(plan, rows) {
  if (plan.source.rows !== EXPECTED_ROWS) throw new Error(`STOP: expected ${EXPECTED_ROWS} Taiken rows, found ${plan.source.rows}.`);
  assertCounts("status", plan.expected.status_counts, EXPECTED_STATUS_COUNTS);
  if (plan.expected.invalid_optional_phones_skipped !== EXPECTED_INVALID_OPTIONAL_PHONES) {
    throw new Error(`STOP: expected ${EXPECTED_INVALID_OPTIONAL_PHONES} invalid optional phones, found ${plan.expected.invalid_optional_phones_skipped}.`);
  }
  if (plan.expected.invalid_emails !== EXPECTED_INVALID_EMAILS) {
    throw new Error(`STOP: expected ${EXPECTED_INVALID_EMAILS} invalid emails, found ${plan.expected.invalid_emails}.`);
  }
  if (rows.some((row) => row.normalized_candidate.import_blockers?.length)) {
    throw new Error("STOP: unexpected Taiken import blockers remain.");
  }
  for (const [rowNumber, studentId] of APPROVED_STUDENT_LINKS) {
    const row = rows.find((item) => item.source_row_number === rowNumber);
    if (!row || row.chosen_converted_student_id !== studentId || row.normalized_candidate.trial_lesson.status !== "joined") {
      throw new Error(`STOP: approved Student link for row ${rowNumber} was not prepared exactly.`);
    }
  }
  const unapprovedLinks = rows.filter((row) => row.chosen_converted_student_id && !APPROVED_STUDENT_LINKS.has(row.source_row_number));
  if (unapprovedLinks.length) throw new Error(`STOP: unapproved Student links prepared: ${unapprovedLinks.map((row) => row.source_row_number).join(", ")}.`);
  const addressLeak = rows.filter((row) => {
    const addresses = [row.raw_source_data.adress, row.raw_source_data.address].map((value) => String(value || "").trim()).filter(Boolean);
    const normalized = JSON.stringify(row.normalized_candidate);
    return addresses.some((address) => normalized.includes(address));
  });
  if (addressLeak.length) throw new Error(`STOP: normalized production candidates contain raw address values for rows ${addressLeak.map((row) => row.source_row_number).join(", ")}.`);
}

function countStatuses(rows) {
  const counts = { joined: 0, unresolved: 0, cancelled: 0, did_not_join: 0 };
  for (const row of rows) counts[row.normalized_candidate.trial_lesson.status || "unresolved"] += 1;
  return counts;
}

function assertCounts(label, actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if ((actual[key] || 0) !== value) throw new Error(`STOP: ${label} ${key} expected ${value}, found ${actual[key] || 0}.`);
  }
}

function printPlan(plan, { execute }) {
  console.log("Legacy Taiken production import plan");
  console.log("====================================");
  console.log(`Mode: ${execute ? "EXECUTE" : "preview only"}`);
  console.log(`Source file: ${plan.source.file_name}`);
  console.log(`Source SHA-256: ${plan.source.file_sha256}`);
  console.log(`Worksheet: ${plan.source.worksheet}`);
  console.log(`Staged/imported Trial Lessons planned: ${plan.expected.imported_trial_lessons}`);
  console.log(`Status counts: ${JSON.stringify(plan.expected.status_counts)}`);
  console.log(`Approved Student links: ${JSON.stringify(plan.expected.converted_student_links)}`);
  console.log(`Prospect contacts planned: ${plan.expected.prospect_contacts}`);
  console.log(`Participant rows planned: ${plan.expected.participants}`);
  console.log(`Invalid optional phones skipped: ${plan.expected.invalid_optional_phones_skipped}`);
  console.log(`Invalid emails: ${plan.expected.invalid_emails}`);
}

function resolveConnection(options) {
  const rawDbUrl = options.dbUrl || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL || readOptionalText("supabase/.temp/pooler-url");
  const projectRef = options.projectRef || process.env.SUPABASE_PROJECT_REF || readOptionalText("supabase/.temp/project-ref");
  if (!rawDbUrl) throw new Error("Missing database connection. Set SUPABASE_DB_URL, DATABASE_URL, POSTGRES_URL, or supabase/.temp/pooler-url.");
  const normalizedConnection = normalizeSupabasePoolerConnection(rawDbUrl, { projectRef });
  const dbPassword = process.env.SUPABASE_DB_PASSWORD || process.env.PGPASSWORD || "";
  if (!dbPassword) {
    printConnectionTest({ ...normalizedConnection.diagnostic, connected: false, failureReason: "Missing SUPABASE_DB_PASSWORD or PGPASSWORD." });
    throw new Error("Missing database password.");
  }
  return { ...normalizedConnection, dbPassword };
}

function normalizeSupabasePoolerConnection(rawDbUrl, { projectRef }) {
  let parsed;
  try {
    parsed = new URL(rawDbUrl);
  } catch {
    throw new Error("Database connection string must be a valid Postgres URL.");
  }
  const previousUsername = parsed.username ? decodeURIComponent(parsed.username) : "";
  parsed.password = "";
  if (parsed.hostname.endsWith(".pooler.supabase.com")) {
    if (!projectRef) throw new Error("Missing Supabase project ref for shared-pooler username normalization.");
    const expectedUsername = `postgres.${projectRef}`;
    if (!previousUsername || previousUsername === "postgres") parsed.username = expectedUsername;
    else if (previousUsername !== expectedUsername) throw new Error(`Supabase shared-pooler username must be ${expectedUsername}; found ${previousUsername}.`);
  }
  return {
    dbUrl: parsed.toString(),
    diagnostic: {
      host: parsed.hostname,
      port: parsed.port || "5432",
      database: parsed.pathname.replace(/^\//, "") || "postgres",
      previousUsername: previousUsername || "(not set)",
      username: decodeURIComponent(parsed.username),
      projectRef: projectRef || "(not set)"
    }
  };
}

function readOptionalText(path) {
  return existsSync(path) ? readFileSync(path, "utf8").trim() : "";
}

async function testDatabaseConnection(connection) {
  queryJson(connection, "select jsonb_build_object('connected', true, 'database', current_database())::text;");
  return { ...connection.diagnostic, connected: true };
}

function printConnectionTest(connectionTest) {
  console.log("Supabase database connection test");
  console.log("=================================");
  console.log(`Host: ${connectionTest.host}`);
  console.log(`Port: ${connectionTest.port}`);
  console.log(`Database: ${connectionTest.database}`);
  console.log(`Previous username: ${connectionTest.previousUsername}`);
  console.log(`Username: ${connectionTest.username}`);
  console.log(`Project ref: ${connectionTest.projectRef}`);
  console.log(`Result: ${connectionTest.connected ? "connected" : "failed"}`);
  if (connectionTest.failureReason) console.log(`Failure: ${connectionTest.failureReason}`);
}

async function getSchemaStatus(connection) {
  return queryJson(connection, `
select jsonb_build_object(
  'staging_batch_import_kind', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'legacy_student_import_batches' and column_name = 'import_kind'),
  'staging_row_taiken_receipts', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'legacy_student_import_rows' and column_name = 'imported_trial_lesson_id'),
  'taiken_source_identity_index', exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'legacy_import_rows_taiken_source_identity_uidx'),
  'taiken_batch_source_index', exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'legacy_import_batches_taiken_source_uidx'),
  'prospects_japanese_name_nullable', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'prospects' and column_name = 'japanese_name' and is_nullable = 'YES'),
  'trial_date_nullable', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trial_lessons' and column_name = 'trial_date' and is_nullable = 'YES'),
  'trial_time_nullable', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trial_lessons' and column_name = 'trial_time' and is_nullable = 'YES'),
  'lesson_type_nullable', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trial_lessons' and column_name = 'lesson_type' and is_nullable = 'YES'),
  'level_id_nullable', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trial_lessons' and column_name = 'level_id' and is_nullable = 'YES'),
  'status_nullable', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trial_lessons' and column_name = 'status' and is_nullable = 'YES'),
  'trial_lessons_rls_enabled', coalesce((select relrowsecurity from pg_class where oid = 'public.trial_lessons'::regclass), false),
  'prospects_rls_enabled', coalesce((select relrowsecurity from pg_class where oid = 'public.prospects'::regclass), false),
  'participants_rls_enabled', coalesce((select relrowsecurity from pg_class where oid = 'public.trial_lesson_participants'::regclass), false),
  'contacts_rls_enabled', coalesce((select relrowsecurity from pg_class where oid = 'public.prospect_contacts'::regclass), false),
  'legacy_rows_rls_enabled', coalesce((select relrowsecurity from pg_class where oid = 'public.legacy_student_import_rows'::regclass), false),
  'authenticated_trial_select_grant', has_table_privilege('authenticated', 'public.trial_lessons', 'select'),
  'authenticated_prospect_select_grant', has_table_privilege('authenticated', 'public.prospects', 'select'),
  'authenticated_participant_select_grant', has_table_privilege('authenticated', 'public.trial_lesson_participants', 'select'),
  'migration_20260908001000', exists (select 1 from supabase_migrations.schema_migrations where version = '20260908001000'),
  'migration_20260908002000', exists (select 1 from supabase_migrations.schema_migrations where version = '20260908002000')
)::text;
`);
}

function assertRequiredSchema(status) {
  const missing = Object.entries(status).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new Error(`Required remote schema is missing or RLS/grants are not intact: ${missing.join(", ")}.`);
}

async function notifyPostgrestSchemaReload(connection) {
  await runPsql(connection, "notify pgrst, 'reload schema';");
}

async function resolveTargetSchool(connection, options) {
  const matches = queryJson(connection, `
with matches as (
  select o.id as organization_id, o.name as organization_name, s.id as school_id, s.name as school_name, s.status as school_status
  from public.schools s
  join public.organizations o on o.id = s.organization_id
  where lower(o.name) = lower(${sqlText(options.organization)})
    and lower(s.name) = lower(${sqlText(options.school)})
)
select coalesce(jsonb_agg(to_jsonb(matches)), '[]'::jsonb)::text from matches;
`);
  if (matches.length !== 1) throw new Error(`Expected one target school for ${options.organization} / ${options.school}, found ${matches.length}.`);
  return matches[0];
}

async function createOrReuseImportBatch(connection, { options, target, dryRun, plan }) {
  return queryJson(connection, `
with upserted as (
  insert into public.legacy_student_import_batches (
    organization_id, school_id, source_file_name, source_file_sha256, source_sheet_names,
    import_status, dry_run_summary, approved_mapping, import_kind
  )
  values (
    ${sqlText(target.organization_id)}::uuid,
    ${sqlText(target.school_id)}::uuid,
    ${sqlText(basename(options.file))},
    ${sqlText(plan.source.file_sha256)},
    array['Taiken']::text[],
    'ready_for_import',
    ${sqlJson({ ...dryRun.summary, production_plan: plan.expected })},
    ${sqlJson({
      source: "owner-approved legacy Taiken production import",
      worksheet: "Taiken",
      status_rows: {
        joined: [...JOINED_ROWS],
        cancelled: [...CANCELLED_ROWS],
        did_not_join: [...DID_NOT_JOIN_ROWS],
        unresolved: "all remaining rows"
      },
      approved_converted_student_links: Object.fromEntries(APPROVED_STUDENT_LINKS),
      ambiguous_and_unmatched_links: "left null",
      students_created: 0
    })},
    'taiken'
  )
  on conflict (school_id, import_kind, source_file_sha256, source_sheet_names)
  where import_kind = 'taiken'
  do update set
    dry_run_summary = excluded.dry_run_summary,
    approved_mapping = excluded.approved_mapping,
    import_status = case
      when public.legacy_student_import_batches.import_status = 'imported' then public.legacy_student_import_batches.import_status
      else excluded.import_status
    end,
    updated_at = now()
  returning id, import_status
)
select to_jsonb(upserted)::text from upserted;
`);
}

async function stageRows(connection, { batchId, target, rows }) {
  const payload = rows.map((row) => ({
    source_sheet_name: row.source_sheet_name,
    source_row_number: row.source_row_number,
    source_file_sha256: row.source_file_sha256,
    raw_source_data: row.raw_source_data,
    normalized_candidate: row.normalized_candidate,
    validation_state: row.validation_state,
    warnings: row.warnings || [],
    errors: row.errors || [],
    unresolved: row.unresolved || [],
    duplicate_candidates: row.duplicate_candidates || [],
    student_match_candidates: row.student_match_candidates || [],
    student_match_category: row.student_match_category,
    chosen_converted_student_id: row.chosen_converted_student_id,
    import_status: "ready_for_import"
  }));
  const result = queryJson(connection, `
with payload as (
  select *
  from jsonb_to_recordset(${sqlJson(payload)}) as row_data(
    source_sheet_name text,
    source_row_number integer,
    source_file_sha256 text,
    raw_source_data jsonb,
    normalized_candidate jsonb,
    validation_state text,
    warnings jsonb,
    errors jsonb,
    unresolved jsonb,
    duplicate_candidates jsonb,
    student_match_candidates jsonb,
    student_match_category text,
    chosen_converted_student_id uuid,
    import_status text
  )
),
upserted as (
  insert into public.legacy_student_import_rows (
    batch_id, organization_id, school_id, import_kind, source_file_sha256, source_sheet_name,
    source_row_number, raw_source_data, normalized_candidate, validation_state, warnings, errors,
    unresolved, duplicate_candidates, student_match_candidates, student_match_category,
    chosen_converted_student_id, import_status
  )
  select
    ${sqlText(batchId)}::uuid,
    ${sqlText(target.organization_id)}::uuid,
    ${sqlText(target.school_id)}::uuid,
    'taiken',
    source_file_sha256,
    source_sheet_name,
    source_row_number,
    raw_source_data,
    normalized_candidate,
    validation_state,
    warnings,
    errors,
    unresolved,
    duplicate_candidates,
    student_match_candidates,
    student_match_category,
    chosen_converted_student_id,
    import_status
  from payload
  on conflict (school_id, source_file_sha256, source_sheet_name, source_row_number)
  where import_kind = 'taiken'
  do update set
    normalized_candidate = excluded.normalized_candidate,
    validation_state = excluded.validation_state,
    warnings = excluded.warnings,
    errors = excluded.errors,
    unresolved = excluded.unresolved,
    duplicate_candidates = excluded.duplicate_candidates,
    student_match_candidates = excluded.student_match_candidates,
    student_match_category = case when public.legacy_student_import_rows.imported_trial_lesson_id is null then excluded.student_match_category else public.legacy_student_import_rows.student_match_category end,
    chosen_converted_student_id = case when public.legacy_student_import_rows.imported_trial_lesson_id is null then excluded.chosen_converted_student_id else public.legacy_student_import_rows.chosen_converted_student_id end,
    import_status = case when public.legacy_student_import_rows.imported_trial_lesson_id is null then excluded.import_status else public.legacy_student_import_rows.import_status end,
    updated_at = now()
  returning id
)
select jsonb_build_object(
  'upserted_count', (select count(*) from upserted),
  'staged_count', (
    select count(*)
    from public.legacy_student_import_rows
    where batch_id = ${sqlText(batchId)}::uuid
      and organization_id = ${sqlText(target.organization_id)}::uuid
      and school_id = ${sqlText(target.school_id)}::uuid
      and import_kind = 'taiken'
      and source_sheet_name = 'Taiken'
  )
)::text;
`);
  if (result.staged_count !== rows.length) throw new Error(`Expected ${rows.length} staged Taiken rows, found ${result.staged_count}.`);
}

async function markBatchStatus(connection, batchId, status, options = {}) {
  await runPsql(connection, `
update public.legacy_student_import_batches
set import_status = ${sqlText(status)},
    imported_at = case when ${options.importedAt ? "true" : "false"} then coalesce(imported_at, now()) else imported_at end,
    updated_at = now()
where id = ${sqlText(batchId)}::uuid
  and import_kind = 'taiken';
`);
}

async function importProductionRows(connection, { batchId, rows, target }) {
  const result = { importedRows: [], failedRows: [], reusedRows: [] };
  for (const row of rows) {
    try {
      const imported = await importOneTaikenRow(connection, { batchId, row, target });
      if (imported.created) result.importedRows.push(imported);
      else result.reusedRows.push(imported);
    } catch (error) {
      result.failedRows.push({ row_number: row.source_row_number, reason: error.message });
      await markRowFailed(connection, { batchId, row, code: "production_import_failed", message: error.message });
    }
  }
  return result;
}

async function importOneTaikenRow(connection, { batchId, row, target }) {
  const prospect = row.normalized_candidate.prospect;
  const trial = row.normalized_candidate.trial_lesson;
  const contacts = row.normalized_candidate.contacts || [];
  const participants = row.normalized_candidate.participants || [];
  const result = queryJson(connection, `
begin;

with locked as (
  select *
  from public.legacy_student_import_rows
  where batch_id = ${sqlText(batchId)}::uuid
    and import_kind = 'taiken'
    and source_sheet_name = 'Taiken'
    and source_row_number = ${row.source_row_number}
  for update
),
new_prospect as (
  insert into public.prospects (
    organization_id, school_id, japanese_name, furigana, alphabet_name, inquiry_method_id, acquisition_source_id
  )
  select
    ${sqlText(target.organization_id)}::uuid,
    ${sqlText(target.school_id)}::uuid,
    ${sqlText(prospect.japanese_name)},
    ${sqlText(prospect.furigana)},
    ${sqlText(prospect.alphabet_name)},
    ${sqlText(prospect.inquiry_method_id)},
    ${sqlText(prospect.acquisition_source_id)}
  from locked
  where imported_trial_lesson_id is null
  returning id
),
prospect_choice as (
  select id from new_prospect
  union all
  select imported_prospect_id from locked where imported_trial_lesson_id is not null
),
contact_payload as (
  select distinct on (lower(contact_type), lower(value))
    contact_type, label, value, coalesce(is_primary, false) as is_primary
  from jsonb_to_recordset(${sqlJson(contacts)}) as contact_data(
    contact_type text,
    label text,
    value text,
    is_primary boolean
  )
  where nullif(btrim(value), '') is not null
  order by lower(contact_type), lower(value), is_primary desc
),
inserted_contacts as (
  insert into public.prospect_contacts (
    organization_id, school_id, prospect_id, contact_type, label, value, is_primary
  )
  select
    ${sqlText(target.organization_id)}::uuid,
    ${sqlText(target.school_id)}::uuid,
    (select id from prospect_choice),
    contact_payload.contact_type::public.contact_type,
    nullif(btrim(coalesce(contact_payload.label, '')), ''),
    btrim(contact_payload.value),
    contact_payload.is_primary
  from contact_payload, locked
  where locked.imported_trial_lesson_id is null
    and not exists (
      select 1
      from public.prospect_contacts existing_contact
      where existing_contact.prospect_id = (select id from prospect_choice)
        and existing_contact.contact_type = contact_payload.contact_type::public.contact_type
        and lower(existing_contact.value) = lower(btrim(contact_payload.value))
    )
  returning id
),
new_trial as (
  insert into public.trial_lessons (
    organization_id, school_id, prospect_id, trial_date, trial_time, assigned_teacher_profile_id,
    lesson_type, level_id, customer_request, internal_notes, status, converted_student_id
  )
  select
    ${sqlText(target.organization_id)}::uuid,
    ${sqlText(target.school_id)}::uuid,
    (select id from prospect_choice),
    ${sqlDate(trial.trial_date)},
    ${sqlTime(trial.trial_time)},
    ${sqlUuid(trial.assigned_teacher_profile_id)},
    ${sqlEnum(trial.lesson_type, "public.class_lesson_type")},
    ${sqlText(trial.level_id)},
    ${sqlText(trial.customer_request)},
    ${sqlText(trial.internal_notes)},
    ${sqlEnum(trial.status, "public.trial_lesson_status")},
    ${sqlUuid(trial.converted_student_id)}
  from locked
  where imported_trial_lesson_id is null
  returning id
),
trial_choice as (
  select id from new_trial
  union all
  select imported_trial_lesson_id from locked where imported_trial_lesson_id is not null
),
participant_payload as (
  select row_number() over () as position, *
  from jsonb_to_recordset(${sqlJson(participants)}) as participant_data(
    japanese_name text,
    furigana text,
    alphabet_name text,
    age_group_level_id text,
    requested_level_id text,
    converted_student_id uuid
  )
  where nullif(btrim(japanese_name), '') is not null
),
inserted_participants as (
  insert into public.trial_lesson_participants (
    organization_id, school_id, trial_lesson_id, japanese_name, furigana, alphabet_name,
    age_group_level_id, requested_level_id, converted_student_id
  )
  select
    ${sqlText(target.organization_id)}::uuid,
    ${sqlText(target.school_id)}::uuid,
    (select id from trial_choice),
    btrim(participant_payload.japanese_name),
    nullif(btrim(coalesce(participant_payload.furigana, '')), ''),
    nullif(btrim(coalesce(participant_payload.alphabet_name, '')), ''),
    nullif(btrim(coalesce(participant_payload.age_group_level_id, '')), ''),
    nullif(btrim(coalesce(participant_payload.requested_level_id, '')), ''),
    participant_payload.converted_student_id
  from participant_payload, locked
  where locked.imported_trial_lesson_id is null
  order by participant_payload.position
  returning id
),
staging_update as (
  update public.legacy_student_import_rows
  set imported_trial_lesson_id = (select id from trial_choice),
      imported_prospect_id = (select id from prospect_choice),
      imported_at = coalesce(imported_at, now()),
      import_status = 'imported',
      updated_at = now()
  where id = (select id from locked)
    and imported_trial_lesson_id is null
  returning id
)
select jsonb_build_object(
  'row_number', ${row.source_row_number},
  'staging_found', exists(select 1 from locked),
  'created', exists(select 1 from new_trial),
  'trial_lesson_id', (select id from trial_choice),
  'prospect_id', (select id from prospect_choice),
  'contacts_inserted', (select count(*) from inserted_contacts),
  'participants_inserted', (select count(*) from inserted_participants)
)::text;

commit;
`);
  if (!result?.staging_found) throw new Error(`Staged row ${row.source_row_number} was not found.`);
  if (!result.trial_lesson_id || !result.prospect_id) throw new Error(`Row ${row.source_row_number} did not produce or reuse a production receipt.`);
  return result;
}

async function markRowFailed(connection, { batchId, row, code, message }) {
  await runPsql(connection, `
update public.legacy_student_import_rows
set validation_state = 'error',
    import_status = 'failed',
    errors = errors || jsonb_build_array(jsonb_build_object('code', ${sqlText(code)}, 'message', ${sqlText(message)})),
    updated_at = now()
where batch_id = ${sqlText(batchId)}::uuid
  and import_kind = 'taiken'
  and source_sheet_name = 'Taiken'
  and source_row_number = ${row.source_row_number}
  and imported_trial_lesson_id is null;
`);
}

async function verifyImport(connection, { batchId, expected, target }) {
  const managerId = await loadReadableManagerProfileId(connection, target);
  const verification = queryJson(connection, `
with staged as (
  select *
  from public.legacy_student_import_rows
  where batch_id = ${sqlText(batchId)}::uuid
    and import_kind = 'taiken'
),
imported_trials as (
  select r.source_row_number, r.raw_source_data, tl.*
  from staged r
  join public.trial_lessons tl on tl.id = r.imported_trial_lesson_id
),
imported_prospects as (
  select pr.*
  from staged r
  join public.prospects pr on pr.id = r.imported_prospect_id
),
imported_contacts as (
  select pc.*
  from imported_prospects pr
  join public.prospect_contacts pc on pc.prospect_id = pr.id
),
imported_participants as (
  select r.source_row_number, tlp.*
  from staged r
  join public.trial_lesson_participants tlp on tlp.trial_lesson_id = r.imported_trial_lesson_id
)
select jsonb_build_object(
  'staged_rows', (select count(*) from staged),
  'imported_trial_lessons', (select count(*) from imported_trials),
  'failed_rows', (
    select coalesce(jsonb_agg(jsonb_build_object('source_row_number', source_row_number, 'errors', errors) order by source_row_number), '[]'::jsonb)
    from staged
    where imported_trial_lesson_id is null or import_status = 'failed'
  ),
  'status_counts', (
    select coalesce(jsonb_object_agg(status_key, row_count), '{}'::jsonb)
    from (
      select coalesce(status::text, 'unresolved') as status_key, count(*)::integer as row_count
      from imported_trials
      group by coalesce(status::text, 'unresolved')
    ) counts
  ),
  'converted_student_links', (
    select coalesce(jsonb_agg(jsonb_build_object('source_row_number', source_row_number, 'converted_student_id', converted_student_id) order by source_row_number), '[]'::jsonb)
    from imported_trials
    where converted_student_id is not null
  ),
  'unapproved_converted_links', (
    select coalesce(jsonb_agg(source_row_number order by source_row_number), '[]'::jsonb)
    from imported_trials
    where converted_student_id is not null
      and not (source_row_number = any (${sqlIntArray([...APPROVED_STUDENT_LINKS.keys()])}))
  ),
  'invalid_optional_phones_skipped', (
    select count(*)::integer
    from staged, jsonb_array_elements(warnings) warning
    where warning ->> 'code' = 'invalid_phone'
  ),
  'invalid_emails', (
    select count(*)::integer
    from staged, jsonb_array_elements(warnings) warning
    where warning ->> 'code' = 'invalid_email'
  ),
  'prospect_contacts', (select count(*) from imported_contacts),
  'participants', (select count(*) from imported_participants),
  'participant_rows_by_source', (
    select coalesce(jsonb_agg(jsonb_build_object('source_row_number', source_row_number, 'participants', row_count) order by source_row_number), '[]'::jsonb)
    from (
      select source_row_number, count(*)::integer as row_count
      from imported_participants
      group by source_row_number
    ) counts
  ),
  'wrong_scope_records', (
    (select count(*) from imported_trials where organization_id <> ${sqlText(target.organization_id)}::uuid or school_id <> ${sqlText(target.school_id)}::uuid)
    + (select count(*) from imported_prospects where organization_id <> ${sqlText(target.organization_id)}::uuid or school_id <> ${sqlText(target.school_id)}::uuid)
    + (select count(*) from imported_contacts where organization_id <> ${sqlText(target.organization_id)}::uuid or school_id <> ${sqlText(target.school_id)}::uuid)
    + (select count(*) from imported_participants where organization_id <> ${sqlText(target.organization_id)}::uuid or school_id <> ${sqlText(target.school_id)}::uuid)
  ),
  'address_trial_field_leaks', (
    select count(*)::integer
    from imported_trials
    where (
      nullif(btrim(coalesce(raw_source_data ->> 'adress', '')), '') is not null
      and (
        coalesce(customer_request, '') like '%' || (raw_source_data ->> 'adress') || '%'
        or coalesce(internal_notes, '') like '%' || (raw_source_data ->> 'adress') || '%'
      )
    ) or (
      nullif(btrim(coalesce(raw_source_data ->> 'address', '')), '') is not null
      and (
        coalesce(customer_request, '') like '%' || (raw_source_data ->> 'address') || '%'
        or coalesce(internal_notes, '') like '%' || (raw_source_data ->> 'address') || '%'
      )
    )
  ),
  'duplicate_trial_receipts', (
    select coalesce(jsonb_agg(imported_trial_lesson_id), '[]'::jsonb)
    from (
      select imported_trial_lesson_id
      from staged
      where imported_trial_lesson_id is not null
      group by imported_trial_lesson_id
      having count(*) > 1
    ) duplicates
  ),
  'readable_manager_profile_id', ${sqlText(managerId)}::uuid
)::text;
`);
  const rlsVerification = verifyTrialLessonsReadableWithRls(connection, { batchId, expected, managerId });
  verification.rls_trial_lessons_readable = rlsVerification.trial_lessons_visible;
  verification.rls_prospects_readable = rlsVerification.prospects_visible;
  verification.rls_participants_readable = rlsVerification.participants_visible;
  verification.rls_contacts_readable = rlsVerification.contacts_visible;
  assertVerification(verification, expected);
  return verification;
}

async function loadReadableManagerProfileId(connection, target) {
  const result = queryJson(connection, `
with candidates as (
  select sm.profile_id
  from public.school_memberships sm
  where sm.school_id = ${sqlText(target.school_id)}::uuid
    and sm.role in ('school_manager', 'office_staff')
  union
  select om.profile_id
  from public.organization_memberships om
  where om.organization_id = ${sqlText(target.organization_id)}::uuid
    and om.role in ('franchise_owner', 'office_staff', 'super_admin')
)
select jsonb_build_object('profile_id', (select profile_id from candidates limit 1))::text;
`);
  if (!result.profile_id) throw new Error("No existing manager/staff profile was available for authenticated RLS read verification.");
  return result.profile_id;
}

function verifyTrialLessonsReadableWithRls(connection, { batchId, expected, managerId }) {
  return queryJson(connection, `
begin;
set local role authenticated;
set local request.jwt.claim.sub = ${sqlText(managerId)};
with staged as (
  select imported_trial_lesson_id, imported_prospect_id
  from public.legacy_student_import_rows
  where batch_id = ${sqlText(batchId)}::uuid
    and import_kind = 'taiken'
),
visible_trials as (
  select tl.*
  from public.trial_lessons tl
  where tl.id in (select imported_trial_lesson_id from staged)
),
visible_prospects as (
  select pr.*
  from public.prospects pr
  where pr.id in (select imported_prospect_id from staged)
),
visible_participants as (
  select tlp.*
  from public.trial_lesson_participants tlp
  where tlp.trial_lesson_id in (select imported_trial_lesson_id from staged)
),
visible_contacts as (
  select pc.*
  from public.prospect_contacts pc
  where pc.prospect_id in (select imported_prospect_id from staged)
)
select jsonb_build_object(
  'trial_lessons_visible', (select count(*) from visible_trials),
  'prospects_visible', (select count(*) from visible_prospects),
  'participants_visible', (select count(*) from visible_participants),
  'contacts_visible', (select count(*) from visible_contacts),
  'expected_trial_lessons', ${expected.imported_trial_lessons}
)::text;
rollback;
`);
}

function assertVerification(verification, expected) {
  if (verification.staged_rows !== expected.staged_rows) throw new Error(`STOP: staged rows expected ${expected.staged_rows}, found ${verification.staged_rows}.`);
  if (verification.imported_trial_lessons !== expected.imported_trial_lessons) {
    throw new Error(`STOP: imported Trial Lessons expected ${expected.imported_trial_lessons}, found ${verification.imported_trial_lessons}.`);
  }
  if (verification.failed_rows.length) throw new Error(`STOP: failed Taiken rows remain: ${JSON.stringify(verification.failed_rows)}.`);
  assertCounts("verified status", verification.status_counts, EXPECTED_STATUS_COUNTS);
  if (verification.converted_student_links.length !== APPROVED_STUDENT_LINKS.size) {
    throw new Error(`STOP: converted_student_id count expected ${APPROVED_STUDENT_LINKS.size}, found ${verification.converted_student_links.length}.`);
  }
  for (const link of verification.converted_student_links) {
    const expectedStudentId = APPROVED_STUDENT_LINKS.get(link.source_row_number);
    if (link.converted_student_id !== expectedStudentId) {
      throw new Error(`STOP: row ${link.source_row_number} linked to ${link.converted_student_id}, expected ${expectedStudentId}.`);
    }
  }
  if (verification.unapproved_converted_links.length) throw new Error(`STOP: unapproved converted_student_id rows found: ${verification.unapproved_converted_links.join(", ")}.`);
  if (verification.invalid_optional_phones_skipped !== expected.invalid_optional_phones_skipped) {
    throw new Error(`STOP: invalid optional phone skip count expected ${expected.invalid_optional_phones_skipped}, found ${verification.invalid_optional_phones_skipped}.`);
  }
  if (verification.invalid_emails !== expected.invalid_emails) throw new Error(`STOP: invalid email count expected ${expected.invalid_emails}, found ${verification.invalid_emails}.`);
  if (verification.prospect_contacts !== expected.prospect_contacts) throw new Error(`STOP: contacts expected ${expected.prospect_contacts}, found ${verification.prospect_contacts}.`);
  if (verification.participants !== expected.participants) throw new Error(`STOP: participants expected ${expected.participants}, found ${verification.participants}.`);
  if (verification.wrong_scope_records !== 0) throw new Error(`STOP: ${verification.wrong_scope_records} imported records are outside Ohashi scope.`);
  if (verification.address_trial_field_leaks !== 0) throw new Error(`STOP: ${verification.address_trial_field_leaks} Trial Lesson rows contain source address values.`);
  if (verification.duplicate_trial_receipts.length) throw new Error(`STOP: duplicate Trial Lesson receipts found: ${JSON.stringify(verification.duplicate_trial_receipts)}.`);
  if (verification.rls_trial_lessons_readable !== expected.imported_trial_lessons) {
    throw new Error(`STOP: authenticated /trial-lessons read expected ${expected.imported_trial_lessons}, found ${verification.rls_trial_lessons_readable}.`);
  }
  if (verification.rls_participants_readable !== expected.participants) throw new Error(`STOP: authenticated participant read expected ${expected.participants}, found ${verification.rls_participants_readable}.`);
  if (verification.rls_contacts_readable !== expected.prospect_contacts) throw new Error(`STOP: authenticated contact read expected ${expected.prospect_contacts}, found ${verification.rls_contacts_readable}.`);
}

function assertIdempotency(importResult, after, before) {
  if (importResult.importedRows.length !== 0) throw new Error(`STOP: second idempotency pass created ${importResult.importedRows.length} new rows.`);
  if (importResult.failedRows.length !== 0) throw new Error(`STOP: second idempotency pass failed rows: ${JSON.stringify(importResult.failedRows)}.`);
  for (const key of ["staged_rows", "imported_trial_lessons", "prospect_contacts", "participants"]) {
    if (after[key] !== before[key]) throw new Error(`STOP: idempotency changed ${key} from ${before[key]} to ${after[key]}.`);
  }
}

function printResult({ batchId, importResult, idempotencyResult, schemaStatus, verification }) {
  console.log("\nLegacy Taiken production import result");
  console.log("======================================");
  console.log(`Migration/schema status: ${JSON.stringify(schemaStatus)}`);
  console.log(`Import batch ID: ${batchId}`);
  console.log(`Staged rows: ${verification.staged_rows}`);
  console.log(`Imported Trial Lessons: ${verification.imported_trial_lessons}`);
  console.log(`Failed rows: ${verification.failed_rows.length ? JSON.stringify(verification.failed_rows) : "none"}`);
  console.log(`Status counts: ${JSON.stringify(verification.status_counts)}`);
  console.log(`Student links created: ${JSON.stringify(verification.converted_student_links)}`);
  console.log(`Unapproved/ambiguous links left NULL: ${verification.unapproved_converted_links.length === 0 ? "yes" : "no"}`);
  console.log(`Prospect contacts imported: ${verification.prospect_contacts}`);
  console.log(`Invalid optional phones skipped: ${verification.invalid_optional_phones_skipped}`);
  console.log(`Participant rows: ${verification.participants}`);
  console.log(`Participant rows by source: ${JSON.stringify(verification.participant_rows_by_source)}`);
  console.log(`Wrong-scope Ohashi records: ${verification.wrong_scope_records}`);
  console.log(`Address imported into Trial Lessons: ${verification.address_trial_field_leaks}`);
  console.log(`Authenticated /trial-lessons readable rows: ${verification.rls_trial_lessons_readable}`);
  console.log(`Rows created this run: ${importResult.importedRows.length}`);
  console.log(`Rows reused this run: ${importResult.reusedRows.length}`);
  console.log(`Second-pass created rows: ${idempotencyResult.importedRows.length}`);
  console.log(`Second-pass reused rows: ${idempotencyResult.reusedRows.length}`);
}

function queryJson(connection, sql) {
  const output = runPsql(connection, sql, { tuplesOnly: true });
  const jsonLine = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1);
  if (!jsonLine) return null;
  return JSON.parse(jsonLine);
}

function runPsql(connection, sql, options = {}) {
  const args = ["-X", "--set", "ON_ERROR_STOP=1", "--dbname", connection.dbUrl];
  if (options.tuplesOnly) args.push("--tuples-only", "--no-align");
  if (options.quiet !== false) args.push("--quiet");
  const result = spawnSync("psql", args, {
    input: sql,
    encoding: "utf8",
    env: { ...process.env, PGCONNECT_TIMEOUT: process.env.PGCONNECT_TIMEOUT || "15", PGPASSWORD: connection.dbPassword || "" },
    maxBuffer: 1024 * 1024 * 50
  });
  if (result.status !== 0) {
    throw new Error([
      result.error?.message,
      result.stderr?.trim(),
      result.stdout?.trim()
    ].filter(Boolean).join("\n") || "psql command failed.");
  }
  return result.stdout.trim();
}

function sqlText(value) {
  if (value === null || value === undefined || value === "") return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlUuid(value) {
  return value ? `${sqlText(value)}::uuid` : "null";
}

function sqlDate(value) {
  return value ? `${sqlText(value)}::date` : "null";
}

function sqlTime(value) {
  return value ? `${sqlText(value)}::time` : "null";
}

function sqlEnum(value, type) {
  return value ? `${sqlText(value)}::${type}` : `null::${type}`;
}

function sqlIntArray(values) {
  return `array[${values.map((value) => Number(value)).join(", ")}]::integer[]`;
}

function sqlJson(value) {
  return `${dollarQuote(JSON.stringify(value))}::jsonb`;
}

function dollarQuote(value) {
  let suffix = 0;
  let tag = "$json$";
  while (value.includes(tag)) {
    suffix += 1;
    tag = `$json${suffix}$`;
  }
  return `${tag}${value}${tag}`;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
