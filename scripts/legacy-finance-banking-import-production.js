#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildLegacyFinanceBankingDryRun,
  normalizeAccountNumber,
  normalizeAccountType,
  normalizeBankCode,
  normalizeBankDisplayName,
  normalizeBranchCode
} from "../lib/legacy-finance-banking-imports.js";
import { loadLegacyFinanceBankingSnapshot } from "../lib/legacy-finance-banking-snapshot.js";
import { readLegacyStudentWorkbook } from "../lib/legacy-student-imports.js";

const DEFAULT_FILE = "data/legacy/students-legacy.xlsm";
const DEFAULT_ORGANIZATION = "Bee School HQ";
const DEFAULT_SCHOOL = "Ohashi";
const DEFAULT_SHEET = "Rico";
const EXPECTED_GENUINE_ROWS = 28;
const EXPECTED_EXACT_LINKS = 26;
const OWNER_REVIEW_ROWS = [15, 26];
const MIGRATIONS = [
  {
    version: "20260909002000",
    name: "legacy_finance_banking_import_staging",
    path: "supabase/migrations/20260909002000_legacy_finance_banking_import_staging.sql"
  },
  {
    version: "20260909003000",
    name: "student_finance_banking_profiles",
    path: "supabase/migrations/20260909003000_student_finance_banking_profiles.sql"
  }
];

async function main() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.execute) throw new Error("Use --execute to run the approved production finance/banking import.");

  const options = {
    file: resolve(args.file || DEFAULT_FILE),
    organization: args.organization || DEFAULT_ORGANIZATION,
    school: args.school || DEFAULT_SCHOOL,
    dbUrl: args.dbUrl || null,
    projectRef: args.projectRef || null
  };

  const workbook = readLegacyStudentWorkbook(options.file, { sheetNames: [DEFAULT_SHEET] });
  const snapshot = await loadLegacyFinanceBankingSnapshot({
    organization: options.organization,
    school: options.school,
    dbUrl: options.dbUrl,
    projectRef: options.projectRef
  });
  const dryRun = buildLegacyFinanceBankingDryRun({ workbook, snapshot });
  const sourceRows = loadSourceRows(workbook);
  const plan = buildProductionPlan({ dryRun, workbook, sourceRows });
  validateExpectedPlan(plan);

  const connection = await resolveConnection(options);
  const Client = await resolvePgClient();
  const client = new Client(connection.clientConfig);
  await client.connect();
  try {
    await applyMigrations(client);
    const schemaStatus = await loadSchemaStatus(client);
    assertRequiredSchema(schemaStatus);
    const target = await resolveTargetSchool(client, options);
    assertTargetMatchesDryRun(target, dryRun.target);

    const importResult = await runImportPass(client, { options, dryRun, plan, sourceRows, target });
    const verification = await verifyImport(client, { plan, target });
    const idempotencyResult = await runImportPass(client, { options, dryRun, plan, sourceRows, target });
    const idempotencyVerification = await verifyImport(client, { plan, target });
    assertIdempotency({ importResult, idempotencyResult, verification, idempotencyVerification });
    const rls = await verifyRlsAccess(client, { target });
    assertRlsAccess(rls);

    const result = {
      import_batch_id: importResult.batch_id,
      staged_rows: verification.staged_rows,
      exact_student_linked_rows: verification.exact_student_linked_rows,
      owner_review_rows: verification.owner_review_rows,
      billing_profiles_created_updated: importResult.billing_profiles.upserted,
      addresses_created_updated: importResult.addresses.upserted,
      bank_accounts_created_updated: importResult.bank_accounts.upserted,
      partial_bank_rows: plan.expected.partial_import_source_rows,
      malformed_account_fields_skipped: plan.expected.malformed_account_source_rows,
      student_uuid_list_used: verification.student_uuid_list_used,
      wrong_school_records: verification.wrong_school_records,
      teacher_access_test: rls.teacher_bank_rows_visible === 0 ? "denied" : "allowed",
      office_staff_bank_access_test: rls.office_staff_bank_rows_visible === 0 ? "denied" : "allowed",
      authorized_admin_access_test: rls.admin_bank_rows_visible > 0 ? "allowed" : "denied",
      idempotency_second_pass: {
        billing_profiles_created: idempotencyResult.billing_profiles.created,
        addresses_created: idempotencyResult.addresses.created,
        bank_accounts_created: idempotencyResult.bank_accounts.created,
        duplicate_source_rows_after_second_pass: idempotencyVerification.duplicate_source_rows
      },
      date_rico_start: "protected staging only; no production effective/start date written",
      sensitive_report_leak_audit: assertNoSensitiveLeak({ result: { verification, rls }, sourceRows }),
      files_changed: [
        ".gitignore",
        "package.json",
        "lib/legacy-finance-banking-imports.js",
        "lib/legacy-finance-banking-snapshot.js",
        "scripts/legacy-finance-banking-import-dry-run.js",
        "scripts/legacy-finance-banking-import-production.js",
        "supabase/migrations/20260909002000_legacy_finance_banking_import_staging.sql",
        "supabase/migrations/20260909003000_student_finance_banking_profiles.sql",
        "tests/legacy-finance-banking-imports.test.js"
      ],
      schema_status: schemaStatus
    };
    assertNoSensitiveLeak({ result, sourceRows });
    printResult(result);
  } finally {
    await client.end();
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--execute") parsed.execute = true;
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
  node scripts/legacy-finance-banking-import-production.js --execute

Options:
  --file <path>             Legacy workbook. Defaults to ${DEFAULT_FILE}.
  --organization <name>     Target organization. Defaults to ${DEFAULT_ORGANIZATION}.
  --school <name>           Target school. Defaults to ${DEFAULT_SCHOOL}.
  --db-url <url>            Postgres connection string. Defaults to env or supabase/.temp/pooler-url.
  --project-ref <ref>       Supabase project ref. Defaults to env or supabase/.temp/project-ref.
  --execute                 Required for staging and production writes.
`);
}

function loadSourceRows(workbook) {
  const sheet = workbook.sheets.find((candidate) => candidate.name === DEFAULT_SHEET);
  if (!sheet) throw new Error("STOP: Rico worksheet is missing.");
  return new Map(sheet.rows.map((row) => [row.rowNumber, row.values]));
}

function buildProductionPlan({ dryRun, workbook, sourceRows }) {
  const rows = dryRun.rows.filter((row) => row.student_match_category !== "D");
  const linkable = rows.filter((row) => row.student_match_category === "A");
  const ownerReview = rows.filter((row) => row.student_match_category !== "A");
  const productionRows = linkable.map((row) => buildProductionPayload(row, sourceRows.get(row.source_row_number)));
  return {
    source: {
      file_name: basename(workbook.file.name || DEFAULT_FILE),
      file_sha256: workbook.file.sha256,
      worksheet: DEFAULT_SHEET
    },
    rows,
    production_rows: productionRows,
    owner_review_rows: ownerReview.map((row) => row.source_row_number),
    expected: {
      staged_rows: rows.length,
      exact_student_linked_rows: linkable.length,
      owner_review_rows: OWNER_REVIEW_ROWS,
      blocked_production_rows: ownerReview.length,
      partial_import_source_rows: linkable
        .filter((row) => row.normalized_candidate.bank_account.bank_details_status !== "valid" || row.normalized_candidate.billing_profile.fee_status === "invalid")
        .map((row) => row.source_row_number),
      malformed_account_source_rows: linkable
        .filter((row) => row.normalized_candidate.bank_account.account_number_status === "malformed")
        .map((row) => row.source_row_number)
    }
  };
}

function buildProductionPayload(row, raw) {
  if (!raw) throw new Error(`STOP: source row ${row.source_row_number} is missing from the workbook.`);
  return {
    source_row_number: row.source_row_number,
    student_id: row.matched_student_id,
    legacy_customer_id: row.legacy_customer_id,
    billing_profile: {
      monthly_fee_yen: row.normalized_candidate.billing_profile.monthly_fee_yen
    },
    address: text(raw.Address) ? { postal_address: text(raw.Address) } : null,
    bank_account: buildBankAccountPayload(raw),
    partial_bank: row.normalized_candidate.bank_account.bank_details_status === "review",
    malformed_account_number: row.normalized_candidate.bank_account.account_number_status === "malformed"
  };
}

function buildBankAccountPayload(raw) {
  const accountNumber = normalizeAccountNumber(raw["Account Number:"]);
  const bankCode = normalizeBankCode(raw["Bank Code:"]);
  const branchCode = normalizeBranchCode(raw["Branch Code"]);
  const accountType = normalizeAccountType(raw["Account Type"]);
  const bankName = normalizeBankDisplayName(raw["Bank Name"], bankCode.normalized) || null;
  const branchName = text(raw["Branch Name"]) || null;
  const branchNameYomigana = text(raw.Yomigana) || null;
  const payload = {
    bank_name: bankName,
    bank_code: bankCode.status === "valid" ? bankCode.normalized : null,
    branch_name: branchName,
    branch_name_yomigana: branchNameYomigana,
    branch_code: branchCode.status === "valid" ? branchCode.normalized : null,
    account_type: accountType.status === "mapped" ? accountType.canonical : null,
    account_number: accountNumber.status === "valid" ? digitsOnly(raw["Account Number:"]) : null,
    account_holder_katakana: text(raw.Katakana) || null
  };
  const hasBankEvidence = [
    raw["Bank Name"],
    raw["Branch Name"],
    raw.Yomigana,
    raw["Account Type"],
    raw["Account Number:"],
    raw["Bank Code:"],
    raw["Branch Code"]
  ].some((value) => text(value));
  const hasSafeProductionValue = [
    payload.bank_name,
    payload.bank_code,
    payload.branch_name,
    payload.branch_name_yomigana,
    payload.branch_code,
    payload.account_type,
    payload.account_number
  ].some(Boolean);
  return hasBankEvidence && hasSafeProductionValue ? payload : null;
}

function validateExpectedPlan(plan) {
  if (plan.rows.length !== EXPECTED_GENUINE_ROWS) {
    throw new Error(`STOP: expected ${EXPECTED_GENUINE_ROWS} genuine Rico rows, found ${plan.rows.length}.`);
  }
  if (plan.production_rows.length !== EXPECTED_EXACT_LINKS) {
    throw new Error(`STOP: expected ${EXPECTED_EXACT_LINKS} exact Student-linked rows, found ${plan.production_rows.length}.`);
  }
  if (JSON.stringify(plan.owner_review_rows) !== JSON.stringify(OWNER_REVIEW_ROWS)) {
    throw new Error(`STOP: owner-review rows changed from ${OWNER_REVIEW_ROWS.join(", ")} to ${plan.owner_review_rows.join(", ")}.`);
  }
  if (plan.rows.some((row) => row.student_match_category === "C" || row.student_match_category === "D")) {
    throw new Error("STOP: unexpected unmatched/helper rows remain in the approved production set.");
  }
  const studentIds = new Set(plan.production_rows.map((row) => row.student_id));
  if (studentIds.size !== plan.production_rows.length) {
    throw new Error("STOP: production Student UUIDs are not one-to-one for the approved Rico rows.");
  }
}

async function resolveConnection(options) {
  const rawDbUrl = options.dbUrl || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL || readOptionalText("supabase/.temp/pooler-url");
  const projectRef = options.projectRef || process.env.SUPABASE_PROJECT_REF || readOptionalText("supabase/.temp/project-ref");
  if (!rawDbUrl) throw new Error("Missing database connection. Set SUPABASE_DB_URL, DATABASE_URL, POSTGRES_URL, or supabase/.temp/pooler-url.");
  const parsed = new URL(rawDbUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error("Database connection string must be a Postgres URL.");
  const previousUsername = parsed.username ? decodeURIComponent(parsed.username) : "";
  parsed.password = "";
  if (parsed.hostname.endsWith(".pooler.supabase.com")) {
    if (!projectRef) throw new Error("Missing Supabase project ref for shared-pooler username normalization.");
    const expectedUsername = `postgres.${projectRef}`;
    if (!previousUsername || previousUsername === "postgres") parsed.username = expectedUsername;
    else if (previousUsername !== expectedUsername) throw new Error(`Supabase shared-pooler username must be ${expectedUsername}; found ${previousUsername}.`);
  }
  const password = process.env.SUPABASE_DB_PASSWORD || process.env.PGPASSWORD || "";
  if (!password) throw new Error("Missing SUPABASE_DB_PASSWORD or PGPASSWORD.");
  const caPath = resolve(process.cwd(), process.env.PGSSLROOTCERT || (
    existsSync("data/legacy/finance-banking-audit/.tools/supabase-root-ca.crt")
      ? "data/legacy/finance-banking-audit/.tools/supabase-root-ca.crt"
      : "data/legacy/taiken-audit/.tools/supabase-root-ca.crt"
  ));
  return {
    clientConfig: {
      host: parsed.hostname,
      port: Number(parsed.port || 5432),
      database: decodeURIComponent(parsed.pathname.slice(1)) || "postgres",
      user: decodeURIComponent(parsed.username),
      password,
      ssl: { rejectUnauthorized: true, ...(existsSync(caPath) ? { ca: readFileSync(caPath, "utf8") } : {}) },
      connectionTimeoutMillis: 15000,
      statement_timeout: 90000,
      query_timeout: 95000
    }
  };
}

async function resolvePgClient() {
  const configured = process.env.LEGACY_FINANCE_BANKING_PG_MODULE;
  const modulePath = resolve(process.cwd(), configured || (
    existsSync("data/legacy/finance-banking-audit/.tools/node_modules/pg/lib/index.js")
      ? "data/legacy/finance-banking-audit/.tools/node_modules/pg/lib/index.js"
      : "data/legacy/taiken-audit/.tools/node_modules/pg/lib/index.js"
  ));
  if (!existsSync(modulePath)) throw new Error("No local pg client module found for the production import.");
  const imported = await import(pathToFileURL(modulePath).href);
  const Client = imported.Client || imported.default?.Client;
  if (!Client) throw new Error("The configured pg module does not export Client.");
  return Client;
}

function readOptionalText(path) {
  return existsSync(path) ? readFileSync(path, "utf8").trim() : "";
}

async function applyMigrations(client) {
  for (const migration of MIGRATIONS) {
    const sql = readFileSync(resolve(migration.path), "utf8");
    await client.query("begin");
    try {
      await client.query(sql);
      await recordMigration(client, migration, sql);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw sanitizePgError(error, `STOP: migration ${migration.version}_${migration.name} failed`);
    }
  }
}

async function recordMigration(client, migration, sql) {
  const columns = await client.query(`
    select column_name
    from information_schema.columns
    where table_schema = 'supabase_migrations'
      and table_name = 'schema_migrations'
  `);
  const names = new Set(columns.rows.map((row) => row.column_name));
  if (!names.has("version")) return;
  const insertColumns = ["version"];
  const values = [migration.version];
  if (names.has("name")) {
    insertColumns.push("name");
    values.push(migration.name);
  }
  if (names.has("statements")) {
    insertColumns.push("statements");
    values.push([sql]);
  }
  const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
  await client.query(
    `insert into supabase_migrations.schema_migrations (${insertColumns.join(", ")}) values (${placeholders}) on conflict (version) do nothing`,
    values
  );
}

async function loadSchemaStatus(client) {
  const result = await client.query(`
    select jsonb_build_object(
      'legacy_finance_banking_import_batches', to_regclass('public.legacy_finance_banking_import_batches') is not null,
      'legacy_finance_banking_import_rows', to_regclass('public.legacy_finance_banking_import_rows') is not null,
      'student_billing_profiles', to_regclass('public.student_billing_profiles') is not null,
      'student_addresses', to_regclass('public.student_addresses') is not null,
      'student_bank_accounts', to_regclass('public.student_bank_accounts') is not null,
      'account_holder_katakana', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'student_bank_accounts' and column_name = 'account_holder_katakana'),
      'branch_name_yomigana', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'student_bank_accounts' and column_name = 'branch_name_yomigana'),
      'wrong_account_holder_yomigana_absent', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'student_bank_accounts' and column_name = 'account_holder_yomigana'),
      'bank_account_number_nullable', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'student_bank_accounts' and column_name = 'account_number' and is_nullable = 'YES'),
      'bank_account_type_nullable', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'student_bank_accounts' and column_name = 'account_type' and is_nullable = 'YES'),
      'bank_helper_present', to_regprocedure('public.can_manage_student_bank_accounts_org(uuid, uuid)') is not null,
      'bank_rls_enabled', coalesce((select relrowsecurity from pg_class where oid = 'public.student_bank_accounts'::regclass), false),
      'staging_rls_enabled', coalesce((select relrowsecurity from pg_class where oid = 'public.legacy_finance_banking_import_rows'::regclass), false),
      'migration_20260909002000', exists (select 1 from supabase_migrations.schema_migrations where version = '20260909002000'),
      'migration_20260909003000', exists (select 1 from supabase_migrations.schema_migrations where version = '20260909003000')
    ) as status
  `);
  return result.rows[0].status;
}

function assertRequiredSchema(status) {
  const missing = Object.entries(status).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new Error(`STOP: required production finance/banking schema is missing: ${missing.join(", ")}.`);
}

async function resolveTargetSchool(client, options) {
  const result = await client.query(`
    select o.id as organization_id, o.name as organization_name, s.id as school_id, s.name as school_name
    from public.schools s
    join public.organizations o on o.id = s.organization_id
    where lower(o.name) = lower($1)
      and lower(s.name) = lower($2)
  `, [options.organization, options.school]);
  if (result.rows.length !== 1) throw new Error(`STOP: expected one target school for ${options.organization} / ${options.school}, found ${result.rows.length}.`);
  return result.rows[0];
}

function assertTargetMatchesDryRun(target, dryRunTarget) {
  if (target.organization_id !== dryRunTarget.organization_id || target.school_id !== dryRunTarget.school_id) {
    throw new Error("STOP: live import target does not match the validated dry-run target.");
  }
}

async function runImportPass(client, { options, dryRun, plan, sourceRows, target }) {
  await client.query("begin");
  try {
    const batch = await upsertBatch(client, { options, dryRun, plan, target });
    const result = {
      batch_id: batch.id,
      staged_rows: 0,
      owner_review_rows: 0,
      billing_profiles: counter(),
      addresses: counter(),
      bank_accounts: counter()
    };
    for (const row of plan.rows) {
      const stagingRow = await withImportContext(`staging row ${row.source_row_number}`, () => upsertStagingRow(client, {
        batchId: batch.id,
        target,
        dryRunRow: row,
        raw: sourceRows.get(row.source_row_number)
      }));
      result.staged_rows += 1;
      if (row.student_match_category !== "A") {
        result.owner_review_rows += 1;
        continue;
      }
      const production = plan.production_rows.find((candidate) => candidate.source_row_number === row.source_row_number);
      const billingId = await withImportContext(`billing profile row ${row.source_row_number}`, () => upsertBillingProfile(client, { target, plan, production, result }));
      const addressId = production.address ? await withImportContext(`address row ${row.source_row_number}`, () => upsertAddress(client, { target, plan, production, result })) : null;
      const bankAccountId = production.bank_account ? await withImportContext(`bank account row ${row.source_row_number}`, () => upsertBankAccount(client, { target, plan, production, result })) : null;
      await withImportContext(`staging receipt row ${row.source_row_number}`, () => client.query(`
        update public.legacy_finance_banking_import_rows
        set imported_billing_profile_id = $1,
            imported_address_id = $2,
            imported_bank_account_id = $3,
            imported_at = coalesce(imported_at, now()),
            import_status = 'imported',
            updated_at = now()
        where id = $4
      `, [billingId, addressId, bankAccountId, stagingRow.id]));
    }
    await client.query(`
      update public.legacy_finance_banking_import_batches
      set import_status = 'imported', updated_at = now()
      where id = $1
    `, [batch.id]);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw sanitizePgError(error, "STOP: production finance/banking import failed");
  }
}

async function withImportContext(context, action) {
  try {
    return await action();
  } catch (error) {
    error.safeImportContext = context;
    throw error;
  }
}

function counter() {
  return { created: 0, updated: 0, upserted: 0 };
}

async function upsertBatch(client, { options, dryRun, plan, target }) {
  const result = await client.query(`
    insert into public.legacy_finance_banking_import_batches (
      organization_id, school_id, source_file_name, source_file_sha256, source_sheet_name, import_status, dry_run_summary
    )
    values ($1, $2, $3, $4, $5, 'importing', $6)
    on conflict (school_id, source_file_sha256, source_sheet_name) do update
    set import_status = 'importing',
        dry_run_summary = excluded.dry_run_summary,
        updated_at = now()
    returning id, import_status
  `, [
    target.organization_id,
    target.school_id,
    basename(options.file),
    plan.source.file_sha256,
    DEFAULT_SHEET,
    jsonParam({
      ...dryRun.summary,
      owner_review_rows: OWNER_REVIEW_ROWS,
      production_student_ids: plan.production_rows.map((row) => row.student_id)
    })
  ]);
  return result.rows[0];
}

async function upsertStagingRow(client, { batchId, target, dryRunRow, raw }) {
  const status = dryRunRow.student_match_category === "A" ? "staged" : "owner_review";
  const result = await client.query(`
    insert into public.legacy_finance_banking_import_rows (
      batch_id, organization_id, school_id, source_file_sha256, source_sheet_name, source_row_number, source_identity,
      legacy_customer_id, matched_student_id, match_confidence, student_match_category, masked_source_data,
      normalized_non_sensitive_data, raw_sensitive_source_data, warnings, errors, import_status
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    on conflict (school_id, source_file_sha256, source_sheet_name, source_row_number) do update
    set batch_id = excluded.batch_id,
        source_identity = excluded.source_identity,
        legacy_customer_id = excluded.legacy_customer_id,
        matched_student_id = excluded.matched_student_id,
        match_confidence = excluded.match_confidence,
        student_match_category = excluded.student_match_category,
        masked_source_data = excluded.masked_source_data,
        normalized_non_sensitive_data = excluded.normalized_non_sensitive_data,
        raw_sensitive_source_data = excluded.raw_sensitive_source_data,
        warnings = excluded.warnings,
        errors = excluded.errors,
        import_status = case
          when public.legacy_finance_banking_import_rows.imported_at is not null and excluded.student_match_category = 'A' then public.legacy_finance_banking_import_rows.import_status
          else excluded.import_status
        end,
        updated_at = now()
    returning id
  `, [
    batchId,
    target.organization_id,
    target.school_id,
    dryRunRow.source_file_sha256,
    DEFAULT_SHEET,
    dryRunRow.source_row_number,
    dryRunRow.source_identity,
    dryRunRow.legacy_customer_id,
    dryRunRow.student_match_category === "A" ? dryRunRow.matched_student_id : null,
    dryRunRow.match_confidence,
    dryRunRow.student_match_category,
    jsonParam(dryRunRow.source_data_masked),
    jsonParam(dryRunRow.normalized_candidate),
    jsonParam(raw || {}),
    jsonParam(dryRunRow.warnings),
    jsonParam(dryRunRow.errors),
    status
  ]);
  return result.rows[0];
}

async function upsertBillingProfile(client, { target, plan, production, result }) {
  const existing = await sourceReceiptExists(client, "student_billing_profiles", target, plan, production);
  const query = await client.query(`
    insert into public.student_billing_profiles (
      organization_id, school_id, student_id, monthly_fee_yen, currency,
      source_type, source_file_sha256, source_sheet_name, source_row_number
    )
    values ($1, $2, $3, $4, 'JPY', 'legacy_rico_finance_banking', $5, $6, $7)
    on conflict on constraint student_billing_profiles_source_row_unique do update
    set student_id = excluded.student_id,
        monthly_fee_yen = excluded.monthly_fee_yen,
        currency = excluded.currency,
        updated_at = now()
    returning id
  `, [
    target.organization_id,
    target.school_id,
    production.student_id,
    production.billing_profile.monthly_fee_yen,
    plan.source.file_sha256,
    DEFAULT_SHEET,
    production.source_row_number
  ]);
  countUpsert(result.billing_profiles, existing);
  return query.rows[0].id;
}

async function upsertAddress(client, { target, plan, production, result }) {
  const existing = await sourceReceiptExists(client, "student_addresses", target, plan, production);
  const query = await client.query(`
    insert into public.student_addresses (
      organization_id, school_id, student_id, postal_address,
      source_type, source_file_sha256, source_sheet_name, source_row_number
    )
    values ($1, $2, $3, $4, 'legacy_rico_finance_banking', $5, $6, $7)
    on conflict on constraint student_addresses_source_row_unique do update
    set student_id = excluded.student_id,
        postal_address = excluded.postal_address,
        updated_at = now()
    returning id
  `, [
    target.organization_id,
    target.school_id,
    production.student_id,
    production.address.postal_address,
    plan.source.file_sha256,
    DEFAULT_SHEET,
    production.source_row_number
  ]);
  countUpsert(result.addresses, existing);
  return query.rows[0].id;
}

async function upsertBankAccount(client, { target, plan, production, result }) {
  const existing = await sourceReceiptExists(client, "student_bank_accounts", target, plan, production);
  const account = production.bank_account;
  const query = await client.query(`
    insert into public.student_bank_accounts (
      organization_id, school_id, student_id, bank_name, bank_code, branch_name, branch_name_yomigana,
      branch_code, account_type, account_number, account_holder_katakana,
      source_type, source_file_sha256, source_sheet_name, source_row_number
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'legacy_rico_finance_banking', $12, $13, $14)
    on conflict on constraint student_bank_accounts_source_row_unique do update
    set student_id = excluded.student_id,
        bank_name = excluded.bank_name,
        bank_code = excluded.bank_code,
        branch_name = excluded.branch_name,
        branch_name_yomigana = excluded.branch_name_yomigana,
        branch_code = excluded.branch_code,
        account_type = excluded.account_type,
        account_number = excluded.account_number,
        account_holder_katakana = excluded.account_holder_katakana,
        updated_at = now()
    returning id
  `, [
    target.organization_id,
    target.school_id,
    production.student_id,
    account.bank_name,
    account.bank_code,
    account.branch_name,
    account.branch_name_yomigana,
    account.branch_code,
    account.account_type,
    account.account_number,
    account.account_holder_katakana,
    plan.source.file_sha256,
    DEFAULT_SHEET,
    production.source_row_number
  ]);
  countUpsert(result.bank_accounts, existing);
  return query.rows[0].id;
}

async function sourceReceiptExists(client, table, target, plan, production) {
  const result = await client.query(`
    select exists (
      select 1 from public.${table}
      where school_id = $1
        and source_file_sha256 = $2
        and source_sheet_name = $3
        and source_row_number = $4
    ) as exists
  `, [target.school_id, plan.source.file_sha256, DEFAULT_SHEET, production.source_row_number]);
  return Boolean(result.rows[0].exists);
}

function countUpsert(counterObject, existed) {
  counterObject.upserted += 1;
  if (existed) counterObject.updated += 1;
  else counterObject.created += 1;
}

function jsonParam(value) {
  return JSON.stringify(value ?? null);
}

async function verifyImport(client, { plan, target }) {
  const result = await client.query(`
    with staged as (
      select *
      from public.legacy_finance_banking_import_rows
      where school_id = $1 and source_file_sha256 = $2 and source_sheet_name = $3
    ),
    production_sources as (
      select source_row_number from staged where student_match_category = 'A'
    ),
    duplicates as (
      select source_row_number
      from staged
      group by source_row_number
      having count(*) > 1
    )
    select jsonb_build_object(
      'staged_rows', (select count(*) from staged),
      'exact_student_linked_rows', (select count(*) from staged where student_match_category = 'A' and matched_student_id is not null and import_status = 'imported'),
      'owner_review_rows', (select coalesce(jsonb_agg(source_row_number order by source_row_number), '[]'::jsonb) from staged where import_status = 'owner_review'),
      'billing_profiles', (select count(*) from public.student_billing_profiles where school_id = $1 and source_file_sha256 = $2 and source_sheet_name = $3),
      'addresses', (select count(*) from public.student_addresses where school_id = $1 and source_file_sha256 = $2 and source_sheet_name = $3),
      'bank_accounts', (select count(*) from public.student_bank_accounts where school_id = $1 and source_file_sha256 = $2 and source_sheet_name = $3),
      'partial_bank_rows', (
        select coalesce(jsonb_agg(source_row_number order by source_row_number), '[]'::jsonb)
        from staged
        where student_match_category = 'A'
          and exists (select 1 from jsonb_array_elements(warnings) warning where warning ->> 'code' like 'malformed_%' or warning ->> 'code' in ('unresolved_account_type', 'invalid_fee'))
      ),
      'malformed_account_fields_skipped', (
        select coalesce(jsonb_agg(source_row_number order by source_row_number), '[]'::jsonb)
        from public.student_bank_accounts
        where school_id = $1 and source_file_sha256 = $2 and source_sheet_name = $3
          and account_number is null
          and source_row_number in (
            select source_row_number
            from staged, jsonb_array_elements(warnings) warning
            where warning ->> 'code' = 'malformed_account_number'
          )
      ),
      'student_uuid_list_used', (
        select coalesce(jsonb_agg(matched_student_id order by source_row_number), '[]'::jsonb)
        from staged
        where student_match_category = 'A'
      ),
      'wrong_school_records', (
        (select count(*) from public.student_billing_profiles bp left join public.students s on s.id = bp.student_id where bp.source_file_sha256 = $2 and bp.source_sheet_name = $3 and (bp.school_id <> $1 or s.school_id <> $1 or s.organization_id <> $4))
        + (select count(*) from public.student_addresses sa left join public.students s on s.id = sa.student_id where sa.source_file_sha256 = $2 and sa.source_sheet_name = $3 and (sa.school_id <> $1 or s.school_id <> $1 or s.organization_id <> $4))
        + (select count(*) from public.student_bank_accounts ba left join public.students s on s.id = ba.student_id where ba.source_file_sha256 = $2 and ba.source_sheet_name = $3 and (ba.school_id <> $1 or s.school_id <> $1 or s.organization_id <> $4))
      ),
      'duplicate_source_rows', (select coalesce(jsonb_agg(source_row_number order by source_row_number), '[]'::jsonb) from duplicates)
    ) as verification
  `, [target.school_id, plan.source.file_sha256, DEFAULT_SHEET, target.organization_id]);
  const verification = result.rows[0].verification;
  if (verification.staged_rows !== plan.expected.staged_rows) throw new Error(`STOP: staged rows expected ${plan.expected.staged_rows}, found ${verification.staged_rows}.`);
  if (verification.exact_student_linked_rows !== plan.expected.exact_student_linked_rows) throw new Error(`STOP: imported Student-linked rows expected ${plan.expected.exact_student_linked_rows}, found ${verification.exact_student_linked_rows}.`);
  if (JSON.stringify(verification.owner_review_rows) !== JSON.stringify(OWNER_REVIEW_ROWS)) throw new Error(`STOP: owner-review rows changed to ${verification.owner_review_rows.join(", ")}.`);
  if (verification.billing_profiles !== plan.expected.exact_student_linked_rows) throw new Error(`STOP: billing profile count expected ${plan.expected.exact_student_linked_rows}, found ${verification.billing_profiles}.`);
  if (verification.wrong_school_records !== 0) throw new Error(`STOP: wrong-school finance/banking records found: ${verification.wrong_school_records}.`);
  if (verification.duplicate_source_rows.length) throw new Error(`STOP: duplicate staged source rows found: ${verification.duplicate_source_rows.join(", ")}.`);
  return verification;
}

function assertIdempotency({ idempotencyResult, verification, idempotencyVerification }) {
  if (idempotencyResult.billing_profiles.created || idempotencyResult.addresses.created || idempotencyResult.bank_accounts.created) {
    throw new Error("STOP: second idempotency pass created new production finance/banking records.");
  }
  for (const key of ["staged_rows", "exact_student_linked_rows", "billing_profiles", "addresses", "bank_accounts", "wrong_school_records"]) {
    if (verification[key] !== idempotencyVerification[key]) {
      throw new Error(`STOP: idempotency changed ${key} from ${verification[key]} to ${idempotencyVerification[key]}.`);
    }
  }
}

async function verifyRlsAccess(client, { target }) {
  const fixtureProfileId = await loadReusableRlsProfileId(client);
  return {
    fixture_profile_id: fixtureProfileId,
    teacher_bank_rows_visible: await countVisibleBankRowsWithTemporaryRole(client, { profileId: fixtureProfileId, target, membershipRole: "teacher" }),
    office_staff_bank_rows_visible: await countVisibleBankRowsWithTemporaryRole(client, { profileId: fixtureProfileId, target, membershipRole: "office_staff" }),
    admin_bank_rows_visible: await countVisibleBankRowsWithTemporaryRole(client, { profileId: fixtureProfileId, target, membershipRole: "school_manager" })
  };
}

async function loadReusableRlsProfileId(client) {
  const result = await client.query("select id from public.profiles order by created_at nulls last, id limit 1");
  if (!result.rows[0]?.id) throw new Error("STOP: no existing profile is available for rolled-back authenticated RLS verification.");
  return result.rows[0].id;
}

async function countVisibleBankRowsWithTemporaryRole(client, { profileId, target, membershipRole }) {
  await client.query("begin");
  try {
    await client.query("delete from public.school_memberships where profile_id = $1", [profileId]);
    await client.query("delete from public.organization_memberships where profile_id = $1", [profileId]);
    await client.query(`
      insert into public.school_memberships (school_id, profile_id, role)
      values ($1, $2, $3::public.membership_role)
    `, [target.school_id, profileId, membershipRole]);
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [profileId]);
    const result = await client.query(`
      select count(*)::integer as count
      from public.student_bank_accounts
      where organization_id = $1 and school_id = $2
    `, [target.organization_id, target.school_id]);
    await client.query("rollback");
    return result.rows[0].count;
  } catch (error) {
    await client.query("rollback");
    throw sanitizePgError(error, "STOP: RLS bank-account visibility check failed");
  }
}

function assertRlsAccess(rls) {
  if (rls.teacher_bank_rows_visible !== 0) throw new Error("STOP: teacher can read student_bank_accounts.");
  if (rls.office_staff_bank_rows_visible !== 0) throw new Error("STOP: office_staff can read student_bank_accounts.");
  if (rls.admin_bank_rows_visible <= 0) throw new Error("STOP: authorized admin cannot read student_bank_accounts.");
}

function assertNoSensitiveLeak({ result, sourceRows }) {
  const serialized = JSON.stringify(result);
  const secrets = [];
  for (const raw of sourceRows.values()) {
    for (const value of [raw["Account Number:"], raw.Address, raw["Phone Number:"]]) {
      const candidate = text(value);
      if (candidate.length >= 6) secrets.push(candidate);
    }
  }
  const leaked = secrets.some((value) => serialized.includes(value));
  if (leaked) throw new Error("STOP: production import result would expose raw banking/address/phone values.");
  return "passed";
}

function printResult(result) {
  console.log("Legacy finance/banking production import result");
  console.log("===============================================");
  console.log(JSON.stringify(result, null, 2));
}

function sanitizePgError(error, prefix) {
  const code = /^[A-Z0-9_]{2,50}$/.test(String(error.code || "")) ? ` (${error.code})` : "";
  const context = error.safeImportContext ? ` during ${error.safeImportContext}` : "";
  const message = scrubPgMessage(error.message);
  const detail = message ? ` Detail: ${message}` : "";
  return new Error(`${prefix}${context}${code}.${detail} No compensating cleanup was performed.`);
}

function scrubPgMessage(message) {
  const raw = String(message || "").split(/\r?\n/)[0]?.trim();
  if (!raw) return "";
  return raw
    .replace(/"[^"]*"/g, "\"[redacted]\"")
    .replace(/'[^']*'/g, "'[redacted]'")
    .slice(0, 240);
}

function text(value) {
  return String(value ?? "").trim();
}

function digitsOnly(value) {
  return text(value).normalize("NFKC").replace(/\D/gu, "");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
