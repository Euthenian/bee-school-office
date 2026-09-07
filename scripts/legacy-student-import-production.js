import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { buildLegacyStudentImportDryRun, readLegacyStudentWorkbook } from "../lib/legacy-student-imports.js";

const DEFAULT_FILE = "data/legacy/students-legacy.xlsm";
const DEFAULT_SHEET = "Students";
const DEFAULT_ORGANIZATION = "Bee School HQ";
const DEFAULT_SCHOOL = "Ohashi";
const EXPECTED_TOTAL_ROWS = 256;
const EXPECTED_ACTIVE_COUNT = 63;
const EXPECTED_INACTIVE_COUNT = 191;
const EXPECTED_IMPORTED_COUNT = 254;
const OWNER_IGNORED_ROWS = new Set([2, 129]);
const OWNER_STATUS_OVERRIDES = new Map([
  [88, "inactive"],
  [195, "inactive"],
  [219, "inactive"]
]);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const options = {
    file: resolve(args.file || DEFAULT_FILE),
    sheet: args.sheet || DEFAULT_SHEET,
    organization: args.organization || DEFAULT_ORGANIZATION,
    school: args.school || DEFAULT_SCHOOL,
    execute: Boolean(args.execute),
    testConnection: Boolean(args.testConnection),
    batchId: args.batchId || null,
    dbUrl: args.dbUrl || null,
    projectRef: args.projectRef || null
  };

  if (options.testConnection) {
    const connection = resolveConnection(options);
    const connectionTest = await testDatabaseConnection(connection);
    printConnectionTest(connectionTest);
    console.log("\nConnection test only. No production writes performed.");
    return;
  }

  const workbook = readLegacyStudentWorkbook(options.file);
  const dryRun = buildLegacyStudentImportDryRun({
    workbook,
    sheetName: options.sheet,
    targetSchoolName: options.school
  });
  const rows = prepareRowsForProduction(dryRun.rows);
  const plan = buildProductionPlan({ dryRun, rows });

  validateExpectedPlan(plan);
  printPlan(plan, { execute: options.execute });

  if (!options.execute) {
    console.log("\nNo database writes performed. Re-run with --execute after confirming the plan.");
    return;
  }

  const connection = resolveConnection(options);
  const connectionTest = await testDatabaseConnection(connection);
  printConnectionTest(connectionTest);
  const schemaStatus = await getSchemaStatus(connection);
  assertRequiredSchema(schemaStatus);
  await notifyPostgrestSchemaReload(connection);

  const target = await resolveTargetSchool(connection, options);
  const batch = options.batchId
    ? await loadExistingBatch(connection, options.batchId, target)
    : await createImportBatch(connection, { options, target, dryRun, plan });

  await stageRows(connection, { batchId: batch.id, target, rows });
  await markBatchStatus(connection, batch.id, "importing");

  const importResult = await importProductionRows(connection, {
    batchId: batch.id,
    fileSha256: workbook.file.sha256,
    rows,
    target
  });

  await markBatchStatus(connection, batch.id, importResult.failedRows.length ? "failed" : "imported", {
    importedAt: !importResult.failedRows.length
  });

  const verification = await verifyImport(connection, {
    batchId: batch.id,
    expected: plan.expected,
    target
  });

  printResult({
    batchId: batch.id,
    importResult,
    schemaStatus,
    verification
  });
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--execute") {
      parsed.execute = true;
    } else if (arg === "--test-connection") {
      parsed.testConnection = true;
    } else if (arg === "--file") {
      parsed.file = next;
      index += 1;
    } else if (arg === "--sheet") {
      parsed.sheet = next;
      index += 1;
    } else if (arg === "--organization") {
      parsed.organization = next;
      index += 1;
    } else if (arg === "--school") {
      parsed.school = next;
      index += 1;
    } else if (arg === "--batch-id") {
      parsed.batchId = next;
      index += 1;
    } else if (arg === "--db-url") {
      parsed.dbUrl = next;
      index += 1;
    } else if (arg === "--project-ref") {
      parsed.projectRef = next;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/legacy-student-import-production.js --execute

Options:
  --file <path>             Legacy workbook. Defaults to ${DEFAULT_FILE}.
  --sheet <name>            Worksheet to import. Defaults to ${DEFAULT_SHEET}.
  --organization <name>     Target organization. Defaults to ${DEFAULT_ORGANIZATION}.
  --school <name>           Target school. Defaults to ${DEFAULT_SCHOOL}.
  --batch-id <uuid>         Resume an existing staged batch.
  --db-url <url>            Postgres connection string. Defaults to env or supabase/.temp/pooler-url.
  --project-ref <ref>       Supabase project ref. Defaults to SUPABASE_PROJECT_REF or supabase/.temp/project-ref.
  --test-connection         Run a safe read-only database connection test and stop.
  --execute                 Required for database writes.
`);
}

function prepareRowsForProduction(sourceRows) {
  return sourceRows.map((sourceRow) => {
    const row = cloneJson(sourceRow);
    const rowNumber = row.source_row_number;

    if (OWNER_STATUS_OVERRIDES.has(rowNumber)) {
      applyStatusOverride(row, OWNER_STATUS_OVERRIDES.get(rowNumber));
    }

    if (OWNER_IGNORED_ROWS.has(rowNumber)) {
      applyOwnerIgnoredRow(row);
    }

    const productionImport = buildProductionImport(row);
    row.normalized_candidate.production_import = productionImport;
    row.import_eligibility = buildImportEligibility(row);
    row.validation_state = buildValidationState(row);

    return row;
  });
}

function applyStatusOverride(row, status) {
  row.errors = (row.errors || []).filter((error) => error.code !== "missing_active_status");
  row.normalized_candidate.import_blockers = (row.normalized_candidate.import_blockers || []).filter(
    (blocker) => blocker !== "missing_active_status"
  );
  row.normalized_candidate.status = status;
  row.normalized_candidate.status_source = {
    ...row.normalized_candidate.status_source,
    mapping: `owner override -> ${status}`,
    owner_override: {
      status,
      reason: "Owner-confirmed blank Active row status override."
    }
  };
  row.warnings = [
    ...(row.warnings || []),
    {
      code: "owner_status_override_applied",
      status,
      message: "Owner-confirmed status override applied for blank Active row."
    }
  ];
}

function applyOwnerIgnoredRow(row) {
  row.normalized_candidate.import_blockers = [
    ...new Set([...(row.normalized_candidate.import_blockers || []), "owner_ignored_row"])
  ];
  row.errors = [
    ...(row.errors || []),
    {
      code: "owner_ignored_row",
      message: "Owner confirmed this worksheet row must not create a production student."
    }
  ];
}

function buildProductionImport(row) {
  const candidate = row.normalized_candidate;
  const legacyJapaneseName = getLegacyJapaneseName(candidate);
  const skippedContacts = getSkippedContacts(row);
  const contacts = getProductionContacts(candidate.contacts || [], skippedContacts);

  if (OWNER_IGNORED_ROWS.has(row.source_row_number)) {
    return {
      action: "ignored_owner_confirmed",
      reason: "Owner confirmed this worksheet row is not a real importable student.",
      contacts,
      skipped_contacts: skippedContacts
    };
  }

  if ((candidate.import_blockers || []).length) {
    return {
      action: "blocked",
      reason: "Import blockers remain after owner decisions.",
      contacts,
      skipped_contacts: skippedContacts
    };
  }

  return {
    action: "import_student",
    first_name: candidate.first_name || null,
    last_name: candidate.last_name || null,
    preferred_name: candidate.preferred_name || null,
    legacy_customer_id: candidate.legacy_customer_id || null,
    legacy_japanese_name: legacyJapaneseName,
    status: candidate.status,
    start_date: candidate.start_date || null,
    contacts,
    skipped_contacts: skippedContacts
  };
}

function getLegacyJapaneseName(candidate) {
  return (candidate.japanese_name?.columns || [])
    .map((entry) => entry.value)
    .filter(Boolean)
    .join(" ") || null;
}

function getSkippedContacts(row) {
  return (row.warnings || [])
    .filter((warning) => warning.code === "invalid_email" || warning.code === "invalid_phone")
    .map((warning) => ({
      code: warning.code,
      column: warning.column || null,
      value: warning.value || null,
      reason: warning.message || "Invalid optional contact skipped."
    }));
}

function getProductionContacts(contacts, skippedContacts) {
  const skippedKeys = new Set(
    skippedContacts.map((contact) => `${contact.code}:${String(contact.value || "").trim().toLowerCase()}`)
  );
  const seen = new Set();
  const safeContacts = [];

  for (const contact of contacts) {
    const value = String(contact.value || "").trim();
    if (!value) continue;

    if (contact.contact_type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) continue;
    if (contact.contact_type === "phone") {
      const compact = value.replace(/[^\d+]/g, "");
      if (compact.replace(/^\+/, "").length < 8) continue;
      if (skippedKeys.has(`invalid_phone:${value.toLowerCase()}`)) continue;
    }

    const key = `${contact.contact_type}:${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    safeContacts.push({
      contact_type: contact.contact_type,
      label: contact.label || "Other",
      value,
      is_primary: Boolean(contact.is_primary)
    });
  }

  return normalizePrimaryContacts(safeContacts);
}

function normalizePrimaryContacts(contacts) {
  const primarySeen = new Set();

  return contacts.map((contact) => {
    if (!contact.is_primary) return contact;
    if (primarySeen.has(contact.contact_type)) return { ...contact, is_primary: false };
    primarySeen.add(contact.contact_type);
    return contact;
  });
}

function buildImportEligibility(row) {
  const blockers = row.normalized_candidate.import_blockers || [];
  const warningCount = (row.warnings || []).length + (row.unresolved || []).length;

  if (blockers.length) {
    return {
      eligible: false,
      status: OWNER_IGNORED_ROWS.has(row.source_row_number) ? "ignored_owner_confirmed" : "blocked",
      blockers,
      warning_count: warningCount,
      error_count: (row.errors || []).length
    };
  }

  return {
    eligible: true,
    status: warningCount ? "importable_with_warnings" : "importable",
    blockers: [],
    warning_count: warningCount,
    error_count: (row.errors || []).length
  };
}

function buildValidationState(row) {
  if ((row.errors || []).length) return "error";
  if ((row.warnings || []).length || (row.unresolved || []).length) return "warning";
  return "valid";
}

function buildProductionPlan({ dryRun, rows }) {
  const importRows = rows.filter((row) => row.normalized_candidate.production_import.action === "import_student");
  const ignoredRows = rows.filter((row) => row.normalized_candidate.production_import.action === "ignored_owner_confirmed");
  const blockedRows = rows.filter((row) => row.normalized_candidate.production_import.action === "blocked");
  const activeRows = importRows.filter((row) => row.normalized_candidate.production_import.status === "active");
  const inactiveRows = importRows.filter((row) => row.normalized_candidate.production_import.status === "inactive");
  const skippedContacts = importRows.flatMap((row) => row.normalized_candidate.production_import.skipped_contacts || []);

  return {
    source: {
      file_name: dryRun.workbook.file?.name || basename(DEFAULT_FILE),
      file_sha256: dryRun.workbook.file?.sha256 || null,
      sheets: dryRun.workbook.sheets.map((sheet) => sheet.name),
      total_rows: rows.length,
      raw_active_y_count: dryRun.summary.active_y_count,
      raw_active_n_count: dryRun.summary.active_n_count,
      raw_blank_active_count: dryRun.summary.blank_active_values,
      raw_invalid_active_count: dryRun.summary.invalid_active_values
    },
    expected: {
      staged_rows: rows.length,
      imported_students: importRows.length,
      active_students: activeRows.length,
      inactive_students: inactiveRows.length,
      ignored_rows: ignoredRows.map((row) => row.source_row_number),
      blocked_rows: blockedRows.map((row) => ({
        row_number: row.source_row_number,
        blockers: row.normalized_candidate.import_blockers || []
      })),
      skipped_invalid_contacts: skippedContacts.length
    }
  };
}

function validateExpectedPlan(plan) {
  const ignoredRows = plan.expected.ignored_rows.join(",");

  if (plan.source.total_rows !== EXPECTED_TOTAL_ROWS) {
    throw new Error(`STOP: expected ${EXPECTED_TOTAL_ROWS} source rows, found ${plan.source.total_rows}.`);
  }

  if (plan.expected.active_students !== EXPECTED_ACTIVE_COUNT) {
    throw new Error(`STOP: expected ${EXPECTED_ACTIVE_COUNT} active imports, found ${plan.expected.active_students}.`);
  }

  if (plan.expected.inactive_students !== EXPECTED_INACTIVE_COUNT) {
    throw new Error(`STOP: expected ${EXPECTED_INACTIVE_COUNT} inactive imports, found ${plan.expected.inactive_students}.`);
  }

  if (plan.expected.imported_students !== EXPECTED_IMPORTED_COUNT) {
    throw new Error(`STOP: expected ${EXPECTED_IMPORTED_COUNT} imported students, found ${plan.expected.imported_students}.`);
  }

  if (ignoredRows !== "2,129") {
    throw new Error(`STOP: expected ignored rows 2,129, found ${ignoredRows || "none"}.`);
  }

  if (plan.expected.blocked_rows.length) {
    throw new Error(`STOP: unexpected blocked rows remain: ${JSON.stringify(plan.expected.blocked_rows)}`);
  }
}

function printPlan(plan, { execute }) {
  console.log("Legacy student production import plan");
  console.log("=====================================");
  console.log(`Mode: ${execute ? "EXECUTE" : "preview only"}`);
  console.log(`Source file: ${plan.source.file_name}`);
  console.log(`Worksheet: ${plan.source.sheets.join(", ")}`);
  console.log(`Total source rows: ${plan.source.total_rows}`);
  console.log(`Raw Active = Y: ${plan.source.raw_active_y_count}`);
  console.log(`Raw Active = N: ${plan.source.raw_active_n_count}`);
  console.log(`Raw blank Active: ${plan.source.raw_blank_active_count}`);
  console.log(`Raw invalid Active: ${plan.source.raw_invalid_active_count}`);
  console.log(`Staged rows planned: ${plan.expected.staged_rows}`);
  console.log(`Production students planned: ${plan.expected.imported_students}`);
  console.log(`Active planned: ${plan.expected.active_students}`);
  console.log(`Inactive planned: ${plan.expected.inactive_students}`);
  console.log(`Owner-ignored rows: ${plan.expected.ignored_rows.join(", ")}`);
  console.log(`Skipped invalid optional contacts planned: ${plan.expected.skipped_invalid_contacts}`);
}

function resolveConnection(options) {
  const rawDbUrl =
    options.dbUrl ||
    process.env.SUPABASE_DB_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    readOptionalText("supabase/.temp/pooler-url");
  const projectRef = options.projectRef || process.env.SUPABASE_PROJECT_REF || readOptionalText("supabase/.temp/project-ref");

  if (!rawDbUrl) {
    throw new Error("Missing database connection. Set SUPABASE_DB_URL, DATABASE_URL, POSTGRES_URL, or supabase/.temp/pooler-url.");
  }

  const normalizedConnection = normalizeSupabasePoolerConnection(rawDbUrl, { projectRef });
  const dbPassword = process.env.SUPABASE_DB_PASSWORD || "";

  if (!dbPassword) {
    printConnectionTest({
      ...normalizedConnection.diagnostic,
      connected: false,
      failureReason: "Missing SUPABASE_DB_PASSWORD."
    });
    throw new Error("Missing database password. Set SUPABASE_DB_PASSWORD. Passwords in connection URLs are not used.");
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

  if (isSupabaseSharedPooler(parsed)) {
    if (!projectRef) {
      throw new Error("Missing Supabase project ref for shared-pooler username normalization.");
    }

    const expectedUsername = `postgres.${projectRef}`;
    if (!previousUsername || previousUsername === "postgres") {
      parsed.username = expectedUsername;
    } else if (previousUsername !== expectedUsername) {
      throw new Error(`Supabase shared-pooler username must be ${expectedUsername}; found ${previousUsername}.`);
    }
  }

  return {
    dbUrl: parsed.toString(),
    diagnostic: {
      host: parsed.hostname,
      port: parsed.port || (parsed.protocol === "postgres:" || parsed.protocol === "postgresql:" ? "5432" : ""),
      database: parsed.pathname.replace(/^\//, "") || "postgres",
      previousUsername: previousUsername || "(not set)",
      username: decodeURIComponent(parsed.username),
      projectRef: projectRef || "(not set)"
    }
  };
}

function isSupabaseSharedPooler(parsedUrl) {
  return parsedUrl.hostname.endsWith(".pooler.supabase.com") && (parsedUrl.port === "5432" || parsedUrl.port === "");
}

function readOptionalText(path) {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8").trim();
}

async function getSchemaStatus(connection) {
  return queryJson(
    connection,
    `
select jsonb_build_object(
  'legacy_student_import_batches', to_regclass('public.legacy_student_import_batches') is not null,
  'legacy_student_import_rows', to_regclass('public.legacy_student_import_rows') is not null,
  'students_legacy_customer_id', exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'students' and column_name = 'legacy_customer_id'
  ),
  'students_legacy_japanese_name', exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'students' and column_name = 'legacy_japanese_name'
  ),
  'students_legacy_source_position_uidx', exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'students_legacy_source_position_uidx'
  ),
  'students_rls_enabled', coalesce((select relrowsecurity from pg_class where oid = 'public.students'::regclass), false),
  'legacy_batches_rls_enabled', coalesce((select relrowsecurity from pg_class where oid = 'public.legacy_student_import_batches'::regclass), false),
  'legacy_rows_rls_enabled', coalesce((select relrowsecurity from pg_class where oid = 'public.legacy_student_import_rows'::regclass), false)
)::text;
`
  );
}

async function testDatabaseConnection(connection) {
  queryJson(
    connection,
    `
select jsonb_build_object(
  'connected', true,
  'database', current_database()
)::text;
`
  );

  return {
    ...connection.diagnostic,
    connected: true
  };
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

function assertRequiredSchema(status) {
  const missing = Object.entries(status)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length) {
    throw new Error(`Required remote schema is missing or RLS is disabled: ${missing.join(", ")}. Run supabase db push first.`);
  }
}

async function notifyPostgrestSchemaReload(connection) {
  await runPsql(connection, "notify pgrst, 'reload schema';");
}

async function resolveTargetSchool(connection, options) {
  const matches = queryJson(
    connection,
    `
with matches as (
  select
    o.id as organization_id,
    o.name as organization_name,
    s.id as school_id,
    s.name as school_name,
    s.status as school_status
  from public.schools s
  join public.organizations o on o.id = s.organization_id
  where lower(o.name) = lower(${sqlText(options.organization)})
    and lower(s.name) = lower(${sqlText(options.school)})
)
select coalesce(jsonb_agg(to_jsonb(matches)), '[]'::jsonb)::text
from matches;
`
  );

  if (matches.length !== 1) {
    throw new Error(`Expected one target school for ${options.organization} / ${options.school}, found ${matches.length}.`);
  }

  return matches[0];
}

async function createImportBatch(connection, { options, target, dryRun, plan }) {
  const result = queryJson(
    connection,
    `
with inserted as (
  insert into public.legacy_student_import_batches (
    organization_id,
    school_id,
    source_file_name,
    source_file_sha256,
    source_sheet_names,
    import_status,
    dry_run_summary,
    approved_mapping
  )
  values (
    ${sqlText(target.organization_id)}::uuid,
    ${sqlText(target.school_id)}::uuid,
    ${sqlText(basename(options.file))},
    ${sqlText(dryRun.workbook.file?.sha256 || null)},
    ${sqlTextArray([options.sheet])},
    'ready_for_import',
    ${sqlJson({ ...dryRun.summary, production_plan: plan.expected })},
    ${sqlJson({
      source: "owner-approved legacy Students production import",
      worksheet: options.sheet,
      status_mapping: {
        "Active = Y": "students.status = active",
        "Active = N": "students.status = inactive"
      },
      owner_status_overrides: Object.fromEntries(OWNER_STATUS_OVERRIDES),
      owner_ignored_rows: [...OWNER_IGNORED_ROWS],
      stop_column_status_effect: "none"
    })}
  )
  returning id
)
select jsonb_build_object('id', (select id from inserted))::text;
`
  );

  return result;
}

async function loadExistingBatch(connection, batchId, target) {
  const batch = queryJson(
    connection,
    `
select to_jsonb(batch_row)::text
from (
  select id, organization_id, school_id, import_status
  from public.legacy_student_import_batches
  where id = ${sqlText(batchId)}::uuid
) batch_row;
`
  );

  if (!batch?.id) {
    throw new Error(`Import batch ${batchId} was not found.`);
  }

  if (batch.organization_id !== target.organization_id || batch.school_id !== target.school_id) {
    throw new Error(`Import batch ${batchId} does not belong to the resolved target school.`);
  }

  return batch;
}

async function stageRows(connection, { batchId, target, rows }) {
  const payload = rows.map((row) => ({
    source_sheet_name: row.source_sheet_name,
    source_row_number: row.source_row_number,
    legacy_customer_id: row.normalized_candidate.legacy_customer_id,
    raw_source_data: row.raw_source_data,
    normalized_candidate: row.normalized_candidate,
    validation_state: row.validation_state,
    warnings: row.warnings || [],
    errors: row.errors || [],
    unresolved: row.unresolved || [],
    duplicate_candidates: row.duplicate_candidates || []
  }));

  const result = queryJson(
    connection,
    `
with payload as (
  select *
  from jsonb_to_recordset(${sqlJson(payload)}) as row_data(
    source_sheet_name text,
    source_row_number integer,
    legacy_customer_id text,
    raw_source_data jsonb,
    normalized_candidate jsonb,
    validation_state text,
    warnings jsonb,
    errors jsonb,
    unresolved jsonb,
    duplicate_candidates jsonb
  )
),
upserted as (
  insert into public.legacy_student_import_rows (
    batch_id,
    organization_id,
    school_id,
    source_sheet_name,
    source_row_number,
    legacy_customer_id,
    raw_source_data,
    normalized_candidate,
    validation_state,
    warnings,
    errors,
    unresolved,
    duplicate_candidates
  )
  select
    ${sqlText(batchId)}::uuid,
    ${sqlText(target.organization_id)}::uuid,
    ${sqlText(target.school_id)}::uuid,
    source_sheet_name,
    source_row_number,
    legacy_customer_id,
    raw_source_data,
    normalized_candidate,
    validation_state,
    warnings,
    errors,
    unresolved,
    duplicate_candidates
  from payload
  on conflict on constraint legacy_student_import_rows_source_position_key do update
  set
    legacy_customer_id = excluded.legacy_customer_id,
    raw_source_data = excluded.raw_source_data,
    normalized_candidate = excluded.normalized_candidate,
    validation_state = excluded.validation_state,
    warnings = excluded.warnings,
    errors = excluded.errors,
    unresolved = excluded.unresolved,
    duplicate_candidates = excluded.duplicate_candidates,
    updated_at = now()
  returning id
)
select jsonb_build_object('staged_count', count(*))::text
from upserted;
`
  );

  if (result.staged_count !== rows.length) {
    throw new Error(`Expected to stage ${rows.length} rows, staged ${result.staged_count}.`);
  }
}

async function markBatchStatus(connection, batchId, status, options = {}) {
  await runPsql(
    connection,
    `
update public.legacy_student_import_batches
set
  import_status = ${sqlText(status)},
  imported_at = case when ${options.importedAt ? "true" : "false"} then now() else imported_at end,
  updated_at = now()
where id = ${sqlText(batchId)}::uuid;
`
  );
}

async function importProductionRows(connection, { batchId, fileSha256, rows, target }) {
  const result = {
    importedRows: [],
    failedRows: [],
    skippedRows: []
  };

  for (const row of rows) {
    const productionImport = row.normalized_candidate.production_import;

    if (productionImport.action === "ignored_owner_confirmed") {
      result.skippedRows.push(row.source_row_number);
      continue;
    }

    if (productionImport.action !== "import_student") {
      result.failedRows.push({ row_number: row.source_row_number, reason: productionImport.reason });
      await markRowFailed(connection, {
        batchId,
        row,
        code: "production_import_blocked",
        message: productionImport.reason
      });
      continue;
    }

    try {
      const imported = await importOneStudent(connection, {
        batchId,
        fileSha256,
        productionImport,
        row,
        target
      });
      result.importedRows.push({
        row_number: row.source_row_number,
        student_id: imported.student_id,
        contacts_inserted: imported.contacts_inserted
      });
    } catch (error) {
      result.failedRows.push({ row_number: row.source_row_number, reason: error.message });
      await markRowFailed(connection, {
        batchId,
        row,
        code: "production_import_failed",
        message: error.message
      });
    }
  }

  return result;
}

async function importOneStudent(connection, { batchId, fileSha256, productionImport, row, target }) {
  return queryJson(
    connection,
    `
begin;

with upserted_student as (
  insert into public.students (
    organization_id,
    school_id,
    first_name,
    last_name,
    preferred_name,
    status,
    start_date,
    legacy_customer_id,
    legacy_japanese_name,
    legacy_source_file_sha256,
    legacy_source_sheet_name,
    legacy_source_row_number,
    legacy_import_batch_id
  )
  values (
    ${sqlText(target.organization_id)}::uuid,
    ${sqlText(target.school_id)}::uuid,
    ${sqlText(productionImport.first_name)},
    ${sqlText(productionImport.last_name)},
    ${sqlText(productionImport.preferred_name)},
    ${sqlText(productionImport.status)}::public.student_status,
    ${sqlDate(productionImport.start_date)},
    ${sqlText(productionImport.legacy_customer_id)},
    ${sqlText(productionImport.legacy_japanese_name)},
    ${sqlText(fileSha256)},
    ${sqlText(row.source_sheet_name)},
    ${row.source_row_number},
    ${sqlText(batchId)}::uuid
  )
  on conflict (
    school_id,
    legacy_source_file_sha256,
    legacy_source_sheet_name,
    legacy_source_row_number
  )
  do update
  set
    legacy_import_batch_id = excluded.legacy_import_batch_id,
    updated_at = public.students.updated_at
  returning id
),
contact_payload as (
  select distinct on (lower(contact_type), lower(value))
    contact_type,
    label,
    value,
    coalesce(is_primary, false) as is_primary
  from jsonb_to_recordset(${sqlJson(productionImport.contacts)}) as contact_data(
    contact_type text,
    label text,
    value text,
    is_primary boolean
  )
  where nullif(btrim(value), '') is not null
  order by lower(contact_type), lower(value), is_primary desc
),
inserted_contacts as (
  insert into public.student_contacts (
    student_id,
    contact_type,
    label,
    value,
    is_primary
  )
  select
    (select id from upserted_student),
    contact_payload.contact_type::public.contact_type,
    nullif(btrim(coalesce(contact_payload.label, '')), ''),
    btrim(contact_payload.value),
    case
      when contact_payload.is_primary and not exists (
        select 1
        from public.student_contacts existing_primary
        where existing_primary.student_id = (select id from upserted_student)
          and existing_primary.contact_type = contact_payload.contact_type::public.contact_type
          and existing_primary.is_primary
      )
      then true
      else false
    end
  from contact_payload
  where not exists (
    select 1
    from public.student_contacts existing_contact
    where existing_contact.student_id = (select id from upserted_student)
      and existing_contact.contact_type = contact_payload.contact_type::public.contact_type
      and lower(existing_contact.value) = lower(btrim(contact_payload.value))
  )
  returning id
),
staging_update as (
  update public.legacy_student_import_rows
  set
    imported_student_id = (select id from upserted_student),
    imported_at = coalesce(imported_at, now()),
    updated_at = now()
  where batch_id = ${sqlText(batchId)}::uuid
    and source_sheet_name = ${sqlText(row.source_sheet_name)}
    and source_row_number = ${row.source_row_number}
  returning id
)
select jsonb_build_object(
  'student_id', (select id from upserted_student),
  'contacts_inserted', (select count(*) from inserted_contacts),
  'staging_updated', (select count(*) from staging_update)
)::text;

commit;
`
  );
}

async function markRowFailed(connection, { batchId, row, code, message }) {
  await runPsql(
    connection,
    `
update public.legacy_student_import_rows
set
  validation_state = 'error',
  errors = errors || jsonb_build_array(jsonb_build_object(
    'code', ${sqlText(code)},
    'message', ${sqlText(message)}
  )),
  updated_at = now()
where batch_id = ${sqlText(batchId)}::uuid
  and source_sheet_name = ${sqlText(row.source_sheet_name)}
  and source_row_number = ${row.source_row_number};
`
  );
}

async function verifyImport(connection, { batchId, expected, target }) {
  const verification = queryJson(
    connection,
    `
with staged as (
  select *
  from public.legacy_student_import_rows
  where batch_id = ${sqlText(batchId)}::uuid
),
imported as (
  select s.*
  from staged r
  join public.students s on s.id = r.imported_student_id
),
student_contacts_for_batch as (
  select sc.*
  from imported s
  join public.student_contacts sc on sc.student_id = s.id
),
school_active as (
  select count(*)::integer as count
  from public.students
  where school_id = ${sqlText(target.school_id)}::uuid
    and status = 'active'
)
select jsonb_build_object(
  'staged_row_count', (select count(*) from staged),
  'imported_student_count', (select count(*) from imported),
  'active_imported_count', (select count(*) from imported where status = 'active'),
  'inactive_imported_count', (select count(*) from imported where status = 'inactive'),
  'ignored_rows', (
    select coalesce(jsonb_agg(source_row_number order by source_row_number), '[]'::jsonb)
    from staged
    where normalized_candidate -> 'production_import' ->> 'action' = 'ignored_owner_confirmed'
  ),
  'failed_rows', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'source_row_number', source_row_number,
      'errors', errors
    ) order by source_row_number), '[]'::jsonb)
    from staged
    where normalized_candidate -> 'production_import' ->> 'action' <> 'ignored_owner_confirmed'
      and imported_student_id is null
  ),
  'invalid_contacts_skipped', (
    select coalesce(sum(jsonb_array_length(normalized_candidate -> 'production_import' -> 'skipped_contacts')), 0)::integer
    from staged
  ),
  'duplicate_source_positions', (
    select coalesce(jsonb_agg(source_key), '[]'::jsonb)
    from (
      select concat_ws(':', legacy_source_file_sha256, legacy_source_sheet_name, legacy_source_row_number) as source_key
      from imported
      group by legacy_source_file_sha256, legacy_source_sheet_name, legacy_source_row_number
      having count(*) > 1
    ) duplicate_sources
  ),
  'wrong_school_students', (
    select count(*)
    from imported
    where school_id <> ${sqlText(target.school_id)}::uuid
       or organization_id <> ${sqlText(target.organization_id)}::uuid
  ),
  'batch_contact_count', (select count(*) from student_contacts_for_batch),
  'school_active_student_count', (select count from school_active)
)::text;
`
  );

  const checks = [
    ["staged_row_count", expected.staged_rows],
    ["imported_student_count", expected.imported_students],
    ["active_imported_count", expected.active_students],
    ["inactive_imported_count", expected.inactive_students],
    ["invalid_contacts_skipped", expected.skipped_invalid_contacts]
  ];

  for (const [key, expectedValue] of checks) {
    if (verification[key] !== expectedValue) {
      throw new Error(`STOP: verification ${key} expected ${expectedValue}, found ${verification[key]}.`);
    }
  }

  const ignoredRows = (verification.ignored_rows || []).join(",");
  if (ignoredRows !== expected.ignored_rows.join(",")) {
    throw new Error(`STOP: verification ignored rows expected ${expected.ignored_rows.join(",")}, found ${ignoredRows || "none"}.`);
  }

  if ((verification.failed_rows || []).length) {
    throw new Error(`STOP: production import left failed rows: ${JSON.stringify(verification.failed_rows)}`);
  }

  if ((verification.duplicate_source_positions || []).length) {
    throw new Error(`STOP: duplicate imported source positions found: ${JSON.stringify(verification.duplicate_source_positions)}`);
  }

  if (verification.wrong_school_students !== 0) {
    throw new Error(`STOP: ${verification.wrong_school_students} imported students do not belong to the target school.`);
  }

  return verification;
}

function printResult({ batchId, importResult, schemaStatus, verification }) {
  console.log("\nLegacy student production import result");
  console.log("=======================================");
  console.log(`Migration/schema status: ${JSON.stringify(schemaStatus)}`);
  console.log(`Import batch ID: ${batchId}`);
  console.log(`Staged row count: ${verification.staged_row_count}`);
  console.log(`Imported student count: ${verification.imported_student_count}`);
  console.log(`Active imported count: ${verification.active_imported_count}`);
  console.log(`Inactive imported count: ${verification.inactive_imported_count}`);
  console.log(`Ignored rows: ${(verification.ignored_rows || []).join(", ")}`);
  console.log(`Failed rows: ${(verification.failed_rows || []).length ? JSON.stringify(verification.failed_rows) : "none"}`);
  console.log(`Invalid contacts skipped: ${verification.invalid_contacts_skipped}`);
  console.log(`Duplicate source positions: ${(verification.duplicate_source_positions || []).length ? JSON.stringify(verification.duplicate_source_positions) : "none"}`);
  console.log(`Wrong-school imported students: ${verification.wrong_school_students}`);
  console.log(`Contacts present for batch: ${verification.batch_contact_count}`);
  console.log(`Ohashi active student count for dashboard logic: ${verification.school_active_student_count}`);
  console.log(`Rows imported or idempotently matched this run: ${importResult.importedRows.length}`);
  console.log(`Rows intentionally skipped: ${importResult.skippedRows.join(", ")}`);
}

function queryJson(connection, sql) {
  const output = runPsql(connection, sql, { tuplesOnly: true });
  const jsonLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);

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
    env: {
      ...process.env,
      PGCONNECT_TIMEOUT: process.env.PGCONNECT_TIMEOUT || "15",
      PGPASSWORD: connection.dbPassword || process.env.PGPASSWORD || ""
    },
    maxBuffer: 1024 * 1024 * 50
  });

  if (result.status !== 0) {
    throw new Error([result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n") || "psql command failed.");
  }

  return result.stdout.trim();
}

function sqlText(value) {
  if (value === null || value === undefined || value === "") return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlDate(value) {
  return value ? `${sqlText(value)}::date` : "null";
}

function sqlTextArray(values) {
  return `array[${values.map((value) => sqlText(value)).join(", ")}]::text[]`;
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
