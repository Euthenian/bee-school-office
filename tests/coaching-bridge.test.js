import assert from "node:assert/strict";
import test from "node:test";
import { handleTrustedCoachingSlots } from "../lib/coaching-bridge.js";

const bridgeSecret = "test-ai-eigo-coaching-bridge-secret";
const databaseKey = "sb_secret_test-bee-database-key";
const serviceRoleKey = "test-legacy-service-role-key";
const school = "f8abe682-dfba-47d9-a624-bcc18b0e427f";
const staff = "a7596880-c58a-44e5-a707-ba8fb931030d";
const date = "2026-10-05";
const input = { school_id: school, program_id: "kids", start_date: date, end_date: date };

function facts(programId = "kids", overrides = {}) {
  return {
    schoolId: school, programId, timeZone: "Asia/Tokyo", startDate: date, endDate: date,
    coaches: [{ id: staff, name: "Private Coach Name", status: "active",
      assignmentStatus: "active", enabled: true, programIds: ["kids", "icao"] }],
    windows: [{ staffId: staff, weekday: 0, startTime: "12:00:00", endTime: "15:00:00" }],
    blocks: [], regularLessons: [], trialLessons: [], packageLessons: [],
    coachingReservations: [], ...overrides
  };
}

function harness({ body = input, authorization = `Bearer ${bridgeSecret}`, responseBody = facts(),
  responseStatus = 200, approvedIndexes = null, method = "POST", env = {} } = {}) {
  const calls = [];
  const request = new Request("https://bee.example/functions/v1/internal-coaching-slots", {
    method, headers: authorization ? { Authorization: authorization } : {},
    ...method === "POST" ? { body: JSON.stringify(body) } : {}
  });
  const options = {
    getEnv: (name) => ({
      SUPABASE_URL: "https://bee.example",
      AI_EIGO_COACHING_BRIDGE_SECRET: bridgeSecret,
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: databaseKey }),
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      ...env
    })[name],
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/filter_internal_coaching_bookable_slot_indexes")) {
        const count = JSON.parse(init.body).p_candidates.length;
        return new Response(JSON.stringify(approvedIndexes || Array.from({ length: count }, (_, index) => index)),
          { status: 200 });
      }
      return new Response(JSON.stringify(responseBody), { status: responseStatus });
    }
  };
  return { calls, request, options };
}

async function invoke(config) {
  const setup = harness(config);
  const response = await handleTrustedCoachingSlots(setup.request, setup.options);
  return { status: response.status, body: await response.json(), calls: setup.calls,
    headers: response.headers };
}

test("trusted server gets final Kids and ICAO slots with only seven public contract fields", async () => {
  for (const programId of ["kids", "icao"]) {
    const result = await invoke({ body: { ...input, program_id: programId },
      responseBody: facts(programId) });
    assert.equal(result.status, 200);
    assert.equal(result.body.slots.length, 6);
    assert.deepEqual(result.body.slots[0], {
      school_id: school, program_id: programId, staff_id: staff,
      local_date: date, start_time: "12:00", end_time: "12:30", timezone: "Asia/Tokyo"
    });
    assert.equal(JSON.stringify(result.body).includes("Private Coach Name"), false);
    assert.equal(result.headers.get("Cache-Control"), "no-store");
    assert.equal(result.calls[0].url,
      "https://bee.example/rest/v1/rpc/get_internal_coaching_availability_with_reservations");
    assert.equal(result.calls[1].url,
      "https://bee.example/rest/v1/rpc/filter_internal_coaching_bookable_slot_indexes");
    assert.equal(result.calls[0].init.headers.apikey, databaseKey);
    assert.equal(result.calls[0].init.headers.Authorization, undefined);
    assert.notEqual(result.calls[0].init.headers.apikey, bridgeSecret);
  }
});

test("the reservation-state check removes a candidate blocked at another school", async () => {
  const result = await invoke({ approvedIndexes: [0, 1, 3, 4, 5] });
  assert.equal(result.status, 200);
  assert.equal(result.body.slots.length, 5);
  assert.equal(result.body.slots.some((slot) => slot.start_time === "13:00"), false);
});

test("invalid school, inactive program, malformed dates, and excessive range are rejected", async () => {
  for (const change of [
    { school_id: "not-a-uuid" }, { start_date: "2026-02-30" },
    { end_date: "2026-11-06" }, { program_id: "Invalid Name" }
  ]) {
    const result = await invoke({ body: { ...input, ...change } });
    assert.equal(result.status, 400);
    assert.equal(result.calls.length, 0);
  }
  for (const change of [
    { school_id: "11111111-1111-4111-8111-111111111111" }, { program_id: "inactive" }
  ]) {
    const result = await invoke({ body: { ...input, ...change },
      responseStatus: 400, responseBody: { message: "Sensitive upstream detail" } });
    assert.equal(result.status, 400);
    assert.equal(JSON.stringify(result.body).includes("Sensitive"), false);
  }
});

test("only the dedicated bridge secret reaches scheduling facts", async () => {
  for (const authorization of [
    null, "Bearer public-anon-key", "Bearer signed-in-user-jwt",
    `Bearer ${serviceRoleKey}`, `Bearer ${databaseKey}`, "Bearer wrong-bridge-secret",
    "Bearer", `Bearer  ${bridgeSecret}`, `Basic ${bridgeSecret}`, `Bearer ${bridgeSecret} extra`
  ]) {
    const result = await invoke({ authorization });
    assert.equal(result.status, 401);
    assert.equal(result.calls.length, 0);
  }
  const trusted = await invoke();
  assert.equal(trusted.status, 200);
  assert.equal(trusted.calls.length, 2);
  const noLegacyKey = await invoke({ env: { SUPABASE_SERVICE_ROLE_KEY: undefined } });
  assert.equal(noLegacyKey.status, 200);
  assert.equal(noLegacyKey.calls[0].init.headers.apikey, databaseKey);
  const get = await invoke({ method: "GET" });
  assert.equal(get.status, 405);
  assert.equal(get.calls.length, 0);
});

test("confirmed reservations remove slots; cancellation releases them", async () => {
  const reserved = facts("kids", { coachingReservations: [
    { staffId: staff, localDate: date, startTime: "14:00:00", endTime: "14:30:00" }
  ] });
  const booked = await invoke({ responseBody: reserved });
  assert.equal(booked.body.slots.some((slot) => slot.start_time === "14:00"), false);
  const cancelled = await invoke({ responseBody: facts() });
  assert.equal(cancelled.body.slots.some((slot) => slot.start_time === "14:00"), true);
});

test("unresolved Bee occupancy yields no unsafe slots", async () => {
  const result = await invoke({ responseBody: facts("kids", { trialLessons: [
    { staffId: staff, localDate: date }
  ] }) });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.slots, []);
});

test("missing server configuration fails closed before reading facts", async () => {
  for (const env of [
    { AI_EIGO_COACHING_BRIDGE_SECRET: undefined },
    { AI_EIGO_COACHING_BRIDGE_SECRET: "invalid secret with spaces" },
    { SUPABASE_SECRET_KEYS: undefined },
    { SUPABASE_SECRET_KEYS: "invalid-json" },
    { SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_publishable_wrong-key" }) }
  ]) {
    const result = await invoke({ env });
    assert.equal(result.status, 503);
    assert.equal(result.calls.length, 0);
  }
});
