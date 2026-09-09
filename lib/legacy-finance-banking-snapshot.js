import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ORGANIZATION = "Bee School HQ";
const SCHOOL = "Ohashi";
const SNAPSHOT_TABLES = [
  "organizations",
  "schools",
  "students",
  "student_contacts",
  "student_charges",
  "student_payments",
  "student_payment_allocations",
  "student_refunds",
  "student_billing_profiles",
  "student_bank_accounts",
  "student_addresses",
  "legacy_finance_banking_import_batches",
  "legacy_finance_banking_import_rows"
];

export async function loadLegacyFinanceBankingSnapshot(options = {}) {
  if ((options.organization && options.organization !== ORGANIZATION) || (options.school && options.school !== SCHOOL)) {
    throw new Error("The legacy finance/banking audit is restricted to Bee School HQ / Ohashi.");
  }
  const cwd = resolve(options.cwd || process.cwd());
  const envPath = resolve(cwd, options.envFile || ".env.local");
  if (existsSync(envPath)) process.loadEnvFile(envPath);
  const connection = resolveConnection(cwd, options);
  const sql = buildSnapshotSelect();
  const psqlPath = options.psqlPath || process.env.LEGACY_FINANCE_BANKING_PSQL || "psql";
  const clientCheck = spawnSync(psqlPath, ["--version"], { encoding: "utf8", windowsHide: true });
  let snapshot;
  if (!clientCheck.error && clientCheck.status === 0) {
    snapshot = readWithPsql(psqlPath, connection, sql);
  } else {
    const pgModulePath = resolve(cwd, options.pgModulePath || process.env.LEGACY_FINANCE_BANKING_PG_MODULE ||
      (existsSync(resolve(cwd, "data/legacy/finance-banking-audit/.tools/node_modules/pg/lib/index.js"))
        ? "data/legacy/finance-banking-audit/.tools/node_modules/pg/lib/index.js"
        : "data/legacy/taiken-audit/.tools/node_modules/pg/lib/index.js"));
    if (!existsSync(pgModulePath)) {
      throw new Error("No PostgreSQL client available. Install psql or provide LEGACY_FINANCE_BANKING_PG_MODULE pointing to a locally installed pg module. No database snapshot was produced.");
    }
    snapshot = await readWithPg(pgModulePath, connection, sql);
  }
  validateSnapshot(snapshot);
  snapshot.target = snapshot.target_matches[0];
  delete snapshot.target_matches;
  return snapshot;
}

function resolveConnection(cwd, options) {
  const optionalText = (path) => existsSync(resolve(cwd, path)) ? readFileSync(resolve(cwd, path), "utf8").trim() : "";
  const rawUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL || optionalText("supabase/.temp/pooler-url");
  if (!rawUrl) throw new Error("Missing database connection settings. No database snapshot was produced.");
  let parsed;
  try {
    parsed = new URL(rawUrl);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error();
  } catch {
    throw new Error("The database connection setting is not a valid PostgreSQL URL.");
  }
  parsed.password = "";
  const password = process.env.SUPABASE_DB_PASSWORD || process.env.PGPASSWORD;
  if (!password) throw new Error("Missing SUPABASE_DB_PASSWORD or PGPASSWORD. No database snapshot was produced.");
  if (parsed.hostname.endsWith(".pooler.supabase.com")) {
    const projectRef = process.env.SUPABASE_PROJECT_REF || optionalText("supabase/.temp/project-ref");
    if (!projectRef) throw new Error("Missing Supabase project reference for the database pooler.");
    const expectedUsername = `postgres.${projectRef}`;
    const username = decodeURIComponent(parsed.username);
    if (!username || username === "postgres") parsed.username = expectedUsername;
    else if (username !== expectedUsername) throw new Error("Database pooler username does not match the configured project reference.");
  }
  const configuredCa = options.sslRootCert || process.env.PGSSLROOTCERT;
  const caPath = resolve(cwd, configuredCa ||
    (existsSync(resolve(cwd, "data/legacy/finance-banking-audit/.tools/supabase-root-ca.crt"))
      ? "data/legacy/finance-banking-audit/.tools/supabase-root-ca.crt"
      : "data/legacy/taiken-audit/.tools/supabase-root-ca.crt"));
  if (configuredCa && !existsSync(caPath)) throw new Error("The configured database root CA certificate does not exist.");
  return { url: parsed, password, caPath: existsSync(caPath) ? caPath : null };
}

function readWithPsql(psqlPath, connection, sql) {
  const result = spawnSync(psqlPath, ["-X", "--no-password", "--quiet", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1"], {
    input: `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n${sql}\nROLLBACK;\n`,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60000,
    maxBuffer: 50 * 1024 * 1024,
    env: {
      ...process.env,
      PGHOST: connection.url.hostname,
      PGPORT: connection.url.port || "5432",
      PGDATABASE: decodeURIComponent(connection.url.pathname.slice(1)) || "postgres",
      PGUSER: decodeURIComponent(connection.url.username),
      PGPASSWORD: connection.password,
      PGSSLMODE: "verify-full",
      PGSSLROOTCERT: connection.caPath || "system",
      PGCLIENTENCODING: "UTF8",
      PGCONNECT_TIMEOUT: "15",
      PGOPTIONS: "-c default_transaction_read_only=on -c statement_timeout=45000"
    }
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Read-only database snapshot failed (${result.error?.code || `psql exit ${result.status}`}). No database snapshot was produced.`);
  }
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    throw new Error("Database snapshot returned invalid JSON. No database snapshot was produced.");
  }
}

async function readWithPg(modulePath, connection, sql) {
  const imported = await import(pathToFileURL(modulePath).href);
  const Client = imported.Client || imported.default?.Client;
  if (!Client) throw new Error("The configured local PostgreSQL client does not export Client.");
  const client = new Client({
    host: connection.url.hostname,
    port: Number(connection.url.port || 5432),
    database: decodeURIComponent(connection.url.pathname.slice(1)) || "postgres",
    user: decodeURIComponent(connection.url.username),
    password: connection.password,
    ssl: { rejectUnauthorized: true, ...(connection.caPath ? { ca: readFileSync(connection.caPath, "utf8") } : {}) },
    connectionTimeoutMillis: 15000,
    statement_timeout: 45000,
    query_timeout: 50000,
    options: "-c default_transaction_read_only=on"
  });
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await client.query(sql);
    await client.query("ROLLBACK");
    if (result.rows.length !== 1) throw new Error("Unexpected snapshot row count.");
    return result.rows[0].snapshot;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* Disconnect also rolls back. */ }
    const safeCode = /^[A-Z0-9_]{2,50}$/.test(String(error.code || "")) ? error.code : "connection or query error";
    throw new Error(`Read-only database snapshot failed (${safeCode}). No database snapshot was produced.`);
  } finally {
    try { await client.end(); } catch { throw new Error("Could not close the read-only database connection cleanly."); }
  }
}

function validateSnapshot(snapshot) {
  if (!snapshot || snapshot.database_read_only !== true || snapshot.transaction_isolation !== "repeatable read") {
    throw new Error("Database did not confirm a repeatable-read, read-only transaction.");
  }
  if (!Array.isArray(snapshot.target_matches) || snapshot.target_matches.length !== 1) {
    throw new Error("Expected exactly one Bee School HQ / Ohashi school in the database.");
  }
  const target = snapshot.target_matches[0];
  if (!Array.isArray(snapshot.students)) throw new Error("Database snapshot is missing the students collection.");
  if (snapshot.students.some((student) => student.school_id !== target.school_id || student.organization_id !== target.organization_id)) {
    throw new Error("Database student snapshot contains a record outside the target school.");
  }
  if (!snapshot.schema?.columns?.length || !snapshot.schema?.tables) {
    throw new Error("Database snapshot is missing required live schema metadata.");
  }
}

function buildSnapshotSelect() {
  const tableNames = SNAPSHOT_TABLES.map((name) => `'${name}'`).join(", ");
  const existingTables = `select table_name from information_schema.tables where table_schema = 'public' and table_name in (${tableNames})`;
  return `
WITH target AS (
  SELECT o.id AS organization_id, o.name AS organization_name,
         s.id AS school_id, s.name AS school_name, s.status AS school_status, s.timezone
  FROM public.schools s JOIN public.organizations o ON o.id = s.organization_id
  WHERE o.name = 'Bee School HQ' AND s.name = 'Ohashi'
), existing_tables AS (
  ${existingTables}
), student_rows AS (
  SELECT s.id, s.organization_id, s.school_id, s.first_name, s.last_name, s.preferred_name,
         s.legacy_customer_id, s.legacy_japanese_name, s.status,
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
           'contact_type', c.contact_type, 'value', c.value, 'is_primary', c.is_primary, 'label', c.label
         ) ORDER BY c.id) FROM public.student_contacts c
         WHERE c.student_id = s.id AND c.contact_type IN ('email', 'phone')), '[]'::jsonb) AS student_contacts
  FROM public.students s JOIN target t ON s.organization_id = t.organization_id AND s.school_id = t.school_id
), schema_columns AS (
  SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default, ordinal_position
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN (${tableNames})
), policy_rows AS (
  SELECT c.relname AS table_name, pol.polname AS policy_name, pg_get_expr(pol.polqual, pol.polrelid) AS using_expression,
         pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expression, pol.polcmd AS command
  FROM pg_policy pol
  JOIN pg_class c ON c.oid = pol.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname IN (${tableNames})
), function_rows AS (
  SELECT p.proname AS function_name, pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('can_manage_student_billing_org', 'can_manage_student_billing_student', 'can_manage_finance_org', 'can_manage_student_finance_org', 'can_manage_student_bank_accounts_org')
)
SELECT jsonb_build_object(
  'snapshot_version', 1,
  'fetched_at', current_timestamp,
  'database_read_only', current_setting('transaction_read_only') = 'on',
  'transaction_isolation', current_setting('transaction_isolation'),
  'target_matches', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM target t), '[]'::jsonb),
  'students', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM student_rows s), '[]'::jsonb),
  'schema', jsonb_build_object(
    'tables', COALESCE((SELECT jsonb_agg(table_name ORDER BY table_name) FROM existing_tables), '[]'::jsonb),
    'columns', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.table_name, c.ordinal_position) FROM schema_columns c), '[]'::jsonb),
    'rls', COALESCE((SELECT jsonb_object_agg(c.relname, c.relrowsecurity) FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN (${tableNames})), '{}'::jsonb),
    'policies', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.table_name, p.policy_name) FROM policy_rows p), '[]'::jsonb),
    'finance_functions', COALESCE((SELECT jsonb_object_agg(function_name, definition) FROM function_rows), '{}'::jsonb)
  )
) AS snapshot;
`;
}
