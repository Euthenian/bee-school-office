import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ORGANIZATION = "Bee School HQ";
const SCHOOL = "Ohashi";
const SNAPSHOT_TABLES = [
  "organizations", "schools", "students", "student_contacts", "profiles", "school_memberships",
  "staff", "staff_school_assignments", "class_levels", "inquiry_methods", "acquisition_sources",
  "courses", "prospects", "prospect_contacts", "trial_lessons", "trial_lesson_participants",
  "legacy_student_import_batches", "legacy_student_import_rows"
];

/**
 * Fetch matching identities and schema metadata for the Taiken dry run.
 * No workbook reads, production/staging writes, RPCs or schema reloads.
 * Contains private contact data: save only to ignored audit storage.
 * psql is preferred; a locally installed pg client is supported when psql is absent.
 */
export async function loadLegacyTaikenSnapshot(options = {}) {
  if ((options.organization && options.organization !== ORGANIZATION) || (options.school && options.school !== SCHOOL)) {
    throw new Error("The legacy Taiken audit is restricted to Bee School HQ / Ohashi.");
  }
  const cwd = resolve(options.cwd || process.cwd());
  const envPath = resolve(cwd, options.envFile || ".env.local");
  if (existsSync(envPath)) process.loadEnvFile(envPath);
  const connection = resolveConnection(cwd, options);
  const sql = buildSnapshotSelect();
  const psqlPath = options.psqlPath || process.env.LEGACY_TAIKEN_PSQL || "psql";
  const clientCheck = spawnSync(psqlPath, ["--version"], { encoding: "utf8", windowsHide: true });
  let snapshot;
  if (!clientCheck.error && clientCheck.status === 0) {
    snapshot = readWithPsql(psqlPath, connection, sql);
  } else {
    const pgModulePath = resolve(cwd, options.pgModulePath || process.env.LEGACY_TAIKEN_PG_MODULE ||
      "data/legacy/taiken-audit/.tools/node_modules/pg/lib/index.js");
    if (!existsSync(pgModulePath)) {
      throw new Error("No PostgreSQL client available. Install psql or provide LEGACY_TAIKEN_PG_MODULE pointing to a locally installed pg module. No database snapshot was produced.");
    }
    snapshot = await readWithPg(pgModulePath, connection, sql);
  }
  validateSnapshot(snapshot);
  snapshot.target = snapshot.target_matches[0];
  snapshot.teachers = snapshot.teachers.map((teacher) => ({
    ...teacher, eligible: teacher.eligible_for_assignment === true
  }));
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
  // Match the existing import: never use passwords embedded in connection URLs.
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
  const caPath = resolve(cwd, configuredCa || "data/legacy/taiken-audit/.tools/supabase-root-ca.crt");
  if (configuredCa && !existsSync(caPath)) throw new Error("The configured database root CA certificate does not exist.");
  return { url: parsed, password, caPath: existsSync(caPath) ? caPath : null };
}

function readWithPsql(psqlPath, connection, sql) {
  // Fixed SQL enters a read-only transaction before querying and always rolls back.
  // Child environment keeps credentials out of process arguments.
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
      ...(connection.caPath ? { PGSSLROOTCERT: connection.caPath } : {}),
      PGCLIENTENCODING: "UTF8",
      PGCONNECT_TIMEOUT: "15",
      PGOPTIONS: "-c default_transaction_read_only=on -c statement_timeout=45000"
    }
  });
  if (result.error || result.status !== 0) {
    // Never echo driver stderr/stdout: it may include settings, credentials or rows.
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
  for (const key of ["students", "teachers", "school_memberships", "class_levels", "inquiry_methods", "acquisition_sources", "courses"]) {
    if (!Array.isArray(snapshot[key])) throw new Error(`Database snapshot is missing the ${key} collection.`);
  }
  if (snapshot.students.some((student) => student.school_id !== target.school_id || student.organization_id !== target.organization_id)) {
    throw new Error("Database student snapshot contains a record outside the target school.");
  }
  if (!snapshot.schema?.columns?.length || !snapshot.schema?.enums?.trial_lesson_status?.length) {
    throw new Error("Database snapshot is missing required live schema metadata.");
  }
}

function buildSnapshotSelect() {
  const tables = SNAPSHOT_TABLES.map((name) => `'${name}'`).join(", ");
  // Target names are fixed. All identity-bearing reads are scoped to this school.
  return `
WITH target AS (
  SELECT o.id AS organization_id, o.name AS organization_name,
         s.id AS school_id, s.name AS school_name, s.status AS school_status, s.timezone
  FROM public.schools s JOIN public.organizations o ON o.id = s.organization_id
  WHERE o.name = 'Bee School HQ' AND s.name = 'Ohashi'
), student_rows AS (
  SELECT s.id, s.organization_id, s.school_id, s.first_name, s.last_name, s.preferred_name,
         s.legacy_customer_id, s.legacy_japanese_name, s.status,
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
           'contact_type', c.contact_type, 'value', c.value, 'is_primary', c.is_primary, 'label', c.label
         ) ORDER BY c.id) FROM public.student_contacts c
         WHERE c.student_id = s.id AND c.contact_type IN ('email', 'phone')), '[]'::jsonb) AS student_contacts
  FROM public.students s JOIN target t ON s.organization_id = t.organization_id AND s.school_id = t.school_id
), member_rows AS (
  SELECT sm.profile_id, sm.school_id, t.organization_id, sm.role, p.full_name, p.status AS profile_status,
         st.display_name AS staff_display_name, st.legal_name AS staff_legal_name, st.status AS staff_status,
         ssa.can_teach, ssa.status AS assignment_status, ssa.start_date, ssa.end_date,
         COALESCE(t.school_status = 'active' AND p.status = 'active' AND st.status = 'active'
           AND ssa.status = 'active' AND ssa.can_teach = true
           AND (ssa.start_date IS NULL OR ssa.start_date <= current_date)
           AND (ssa.end_date IS NULL OR ssa.end_date >= current_date), false) AS eligible_for_assignment
  FROM target t JOIN public.school_memberships sm ON sm.school_id = t.school_id
  JOIN public.profiles p ON p.id = sm.profile_id
  LEFT JOIN public.staff st ON st.profile_id = p.id AND st.organization_id = t.organization_id
  LEFT JOIN public.staff_school_assignments ssa ON ssa.staff_id = st.id
    AND ssa.organization_id = t.organization_id AND ssa.school_id = t.school_id
), schema_columns AS (
  SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default, ordinal_position
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN (${tables})
), enum_rows AS (
  SELECT ty.typname AS name, jsonb_agg(en.enumlabel ORDER BY en.enumsortorder) AS values
  FROM pg_type ty JOIN pg_enum en ON en.enumtypid = ty.oid JOIN pg_namespace ns ON ns.oid = ty.typnamespace
  WHERE ns.nspname = 'public' AND ty.typname IN ('trial_lesson_status', 'class_lesson_type', 'contact_type', 'student_status')
  GROUP BY ty.typname
)
SELECT jsonb_build_object(
  'snapshot_version', 1,
  'fetched_at', current_timestamp,
  'database_read_only', current_setting('transaction_read_only') = 'on',
  'transaction_isolation', current_setting('transaction_isolation'),
  'target_matches', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM target t), '[]'::jsonb),
  'students', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM student_rows s), '[]'::jsonb),
  'teachers', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.profile_id) FROM member_rows m
    WHERE m.role = 'teacher' OR m.can_teach = true), '[]'::jsonb),
  'school_memberships', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.profile_id) FROM member_rows m), '[]'::jsonb),
  'class_levels', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'label', label, 'status', status, 'sort_order', sort_order)
    ORDER BY sort_order) FROM public.class_levels), '[]'::jsonb),
  'inquiry_methods', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'label', label, 'status', status, 'sort_order', sort_order)
    ORDER BY sort_order) FROM public.inquiry_methods), '[]'::jsonb),
  'acquisition_sources', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'label', label, 'status', status, 'sort_order', sort_order)
    ORDER BY sort_order) FROM public.acquisition_sources), '[]'::jsonb),
  'courses', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'organization_id', c.organization_id,
    'school_id', c.school_id, 'name', c.name, 'level', c.level, 'status', c.status) ORDER BY c.id)
    FROM public.courses c JOIN target t ON c.organization_id = t.organization_id AND (c.school_id = t.school_id OR c.school_id IS NULL)), '[]'::jsonb),
  'schema', jsonb_build_object(
    'columns', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.table_name, c.ordinal_position) FROM schema_columns c), '[]'::jsonb),
    'not_null_columns', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.table_name, c.ordinal_position)
      FROM schema_columns c WHERE c.is_nullable = 'NO'), '[]'::jsonb),
    'enums', COALESCE((SELECT jsonb_object_agg(name, values) FROM enum_rows), '{}'::jsonb),
    'rls', COALESCE((SELECT jsonb_object_agg(c.relname, c.relrowsecurity) FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN (${tables})), '{}'::jsonb),
    'teacher_functions', COALESCE((SELECT jsonb_object_agg(p.proname, pg_get_functiondef(p.oid))
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
      AND p.proname IN ('has_active_staff_teacher_assignment', 'ensure_trial_lesson_teacher_membership')), '{}'::jsonb),
    'constraints', COALESCE((SELECT jsonb_agg(jsonb_build_object('table_name', c.relname, 'name', con.conname,
      'type', con.contype, 'definition', pg_get_constraintdef(con.oid)) ORDER BY c.relname, con.conname)
      FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname IN (${tables})), '[]'::jsonb)
  )
) AS snapshot;
`;
}
