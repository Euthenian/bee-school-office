import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { loadLegacyTaikenSnapshot } from "../lib/legacy-taiken-snapshot.js";

const temporaryRoot = realpathSync(tmpdir());
const fixtureDirectory = mkdtempSync(join(temporaryRoot, "legacy-taiken-snapshot-test-"));
const fixtureModule = join(fixtureDirectory, "pg-fixture.mjs");
const environmentKeys = ["SUPABASE_DB_URL", "SUPABASE_DB_PASSWORD", "PGSSLROOTCERT"];
const originalEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
const stateKey = "__legacyTaikenSnapshotTestState";
const previousState = globalThis[stateKey];

writeFileSync(fixtureModule, `
export class Client {
  constructor(config) { globalThis.${stateKey}.config = config; }
  async connect() {
    const state = globalThis.${stateKey};
    state.connected = true;
    if (state.failConnect) throw Object.assign(new Error("SECRET fixture connection failure"), {code:"ECONNREFUSED"});
  }
  async query(sql) {
    const state = globalThis.${stateKey};
    state.queries.push(sql);
    if (sql.startsWith("\\nWITH")) {
      if (state.failSelect) throw Object.assign(new Error("SECRET fixture SELECT failure"), {code:"42501"});
      return {rows:[{snapshot:structuredClone(state.snapshot)}]};
    }
    return {rows:[]};
  }
  async end() { globalThis.${stateKey}.ended = true; }
}
`);

const options = {
  cwd: fixtureDirectory,
  psqlPath: join(fixtureDirectory, "missing-psql"),
  pgModulePath: fixtureModule
};

function fixtureSnapshot() {
  return {
    snapshot_version: 1,
    fetched_at: "2026-09-08T00:00:00+00:00",
    database_read_only: true,
    transaction_isolation: "repeatable read",
    target_matches: [{ organization_id: "org-1", organization_name: "Bee School HQ", school_id: "school-1", school_name: "Ohashi" }],
    students: [{id:"student-1", organization_id:"org-1", school_id:"school-1", student_contacts:[]}],
    teachers: [{profile_id:"teacher-1", role:"school_manager", eligible_for_assignment:true}],
    school_memberships: [],
    class_levels: [],
    inquiry_methods: [],
    acquisition_sources: [],
    courses: [],
    schema: {
      columns: [{table_name:"trial_lessons", column_name:"trial_date"}],
      enums: {trial_lesson_status:["inquiry","joined"], class_lesson_type:["group","private"]}
    }
  };
}

function resetState() {
  globalThis[stateKey] = {snapshot:fixtureSnapshot(), queries:[], connected:false, ended:false};
  return globalThis[stateKey];
}

let passed = 0;
async function check(name, run) {
  resetState();
  await run();
  passed += 1;
  console.log(`ok - ${name}`);
}

try {
  process.env.SUPABASE_DB_URL = "postgresql://fixture-user:IGNORED_URL_SECRET@db.example.test/postgres";
  process.env.SUPABASE_DB_PASSWORD = "FIXTURE_ENV_PASSWORD";
  delete process.env.PGSSLROOTCERT;

  await check("uses one repeatable-read, read-only transaction and rolls it back", async () => {
    const snapshot = await loadLegacyTaikenSnapshot(options);
    const state = globalThis[stateKey];
    assert.equal(state.queries.length, 3);
    assert.equal(state.queries[0], "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    assert.equal(state.queries[2], "ROLLBACK");
    assert.match(state.queries[1], /WHERE o.name = 'Bee School HQ' AND s.name = 'Ohashi'/);
    assert.match(state.queries[1], /s.organization_id = t.organization_id AND s.school_id = t.school_id/);
    assert.match(state.queries[1], /c.contact_type IN \('email', 'phone'\)/);
    assert.doesNotMatch(state.queries[1], /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|NOTIFY|CALL|COPY|SET)\b/i);
    assert.equal(state.config.ssl.rejectUnauthorized, true);
    assert.equal(state.config.password, "FIXTURE_ENV_PASSWORD");
    assert.match(state.config.options, /default_transaction_read_only=on/);
    assert.equal(state.ended, true);
    assert.equal(snapshot.target.school_id, "school-1");
    assert.equal(snapshot.teachers[0].eligible, true, "active teaching school managers are valid under the live trigger");
  });

  await check("rejects a different tenant before attempting a connection", async () => {
    await assert.rejects(loadLegacyTaikenSnapshot({...options, school:"Other school"}), /restricted to Bee School HQ \/ Ohashi/);
    assert.equal(globalThis[stateKey].connected, false);
  });

  await check("connection failure never becomes an empty student snapshot or leaks driver details", async () => {
    globalThis[stateKey].failConnect = true;
    await assert.rejects(loadLegacyTaikenSnapshot(options), (error) => {
      assert.match(error.message, /ECONNREFUSED/);
      assert.doesNotMatch(error.message, /SECRET|FIXTURE_ENV_PASSWORD|IGNORED_URL_SECRET/);
      return true;
    });
    assert.equal(globalThis[stateKey].ended, true);
  });

  await check("SELECT failure rolls back and returns no partial snapshot", async () => {
    globalThis[stateKey].failSelect = true;
    await assert.rejects(loadLegacyTaikenSnapshot(options), /No database snapshot was produced/);
    assert.equal(globalThis[stateKey].queries.at(-1), "ROLLBACK");
    assert.equal(globalThis[stateKey].ended, true);
  });

  await check("rejects a snapshot from a transaction that is not read-only", async () => {
    globalThis[stateKey].snapshot.database_read_only = false;
    await assert.rejects(loadLegacyTaikenSnapshot(options), /did not confirm/);
  });

  await check("rejects a missing or ambiguous school target", async () => {
    globalThis[stateKey].snapshot.target_matches = [];
    await assert.rejects(loadLegacyTaikenSnapshot(options), /exactly one/);
    globalThis[stateKey].snapshot.target_matches = [fixtureSnapshot().target_matches[0], fixtureSnapshot().target_matches[0]];
    await assert.rejects(loadLegacyTaikenSnapshot(options), /exactly one/);
  });

  await check("rejects a student outside the resolved school", async () => {
    globalThis[stateKey].snapshot.students[0].school_id = "other-school";
    await assert.rejects(loadLegacyTaikenSnapshot(options), /outside the target school/);
  });

  await check("rejects a missing student collection or required live schema metadata", async () => {
    delete globalThis[stateKey].snapshot.students;
    await assert.rejects(loadLegacyTaikenSnapshot(options), /missing the students collection/);
    resetState().snapshot.schema.enums = {};
    await assert.rejects(loadLegacyTaikenSnapshot(options), /missing required live schema/);
  });

  console.log(`${passed} legacy Taiken snapshot tests passed.`);
} finally {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (previousState === undefined) delete globalThis[stateKey];
  else globalThis[stateKey] = previousState;
  const checkedPath = resolve(fixtureDirectory);
  if (!checkedPath.startsWith(temporaryRoot + sep) || !basename(checkedPath).startsWith("legacy-taiken-snapshot-test-")) {
    throw new Error("Refusing to remove a fixture directory outside the temporary test area.");
  }
  rmSync(checkedPath, {recursive:true, force:true});
}
