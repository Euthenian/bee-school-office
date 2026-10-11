import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { handleIssueCoachBriefTicket, handleVerifyCoachBriefTicket } from "../lib/coach-brief-ticket.js";

const reservationId = "182fd303-e65b-4f88-95b9-f13f11e7d1c0";
const staffA = "2b236f47-daae-4777-98c3-cbb99504c614";
const staffB = "517aa2cc-2dfc-47bc-85ed-95cf4b29ae1f";
const profileA = "d70b7160-5719-4868-abbd-3a16b82d781f";
const profileB = "4c0cb5c2-a074-481d-9205-14ec906b7668";
const organizationA = "a96fa462-f181-44e7-adb6-5c247cc08eb7";
const organizationB = "0430c960-d64e-4ff6-930c-1ed3b7365125";
const schoolId = "5d71b4df-029a-4baf-9d17-9923b8195958";
const serviceSecret = "test-only-ai-eigo-bridge-secret";
const ticketSecret = "test-only-coach-ticket-signing-secret-at-least-32-bytes";
const databaseKey = "sb_secret_test-only-bee-key";
const now = Date.parse("2026-10-10T08:00:00Z");

function row(overrides = {}) {
  return {
    id: reservationId, staff_id: staffA, learner_ref: "test-learner-ref",
    organization_id: organizationA, school_id: schoolId, program_id: "kids",
    starts_at: "2026-10-10T09:00:00Z", ends_at: "2026-10-10T09:30:00Z",
    time_zone: "Asia/Tokyo", status: "confirmed", source: "ai_eigo",
    request_key: "never-return-request-key", coach_email: "never-return-coach@example.test",
    learner_email: "never-return-learner@example.test", billing: "never-return-billing",
    ...overrides
  };
}

function harness({ reservation = row(), staff = [{ id: staffA, organization_id: organizationA,
  profile_id: profileA, status: "active" }], profiles = [{ id: profileA, status: "active" }],
  env = {}, authFails = false } = {}) {
  const state = { reservation, staff, profiles, calls: [] };
  const settings = {
    getEnv: (name) => ({ SUPABASE_URL: "https://bee.example",
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: databaseKey }),
      BEE_COACH_BRIEF_TICKET_SECRET: ticketSecret,
      AI_EIGO_COACHING_BRIDGE_SECRET: serviceSecret, ...env })[name],
    now: () => now,
    fetchImpl: async (input, init) => {
      const url = new URL(input);
      state.calls.push({ url, init });
      if (url.pathname === "/auth/v1/user") {
        const token = init.headers.Authorization;
        const id = token === "Bearer bee-jwt-coach-a" ? profileA
          : token === "Bearer bee-jwt-coach-b" ? profileB : null;
        return Response.json(id && !authFails ? { id } : { error: "invalid" },
          { status: id && !authFails ? 200 : 401 });
      }
      const table = url.pathname.slice("/rest/v1/".length);
      const id = (url.searchParams.get("id") || "").slice(3);
      const rows = table === "coaching_reservations"
        ? (state.reservation?.id === id ? [state.reservation] : [])
        : table === "staff" ? state.staff.filter((item) => item.id === id)
          : table === "profiles" ? state.profiles.filter((item) => item.id === id) : [];
      return Response.json(rows);
    }
  };
  return { state, settings };
}

function request(path, body, authorization) {
  return new Request(`https://bee.example/functions/v1/${path}`, {
    method: "POST", headers: authorization ? { Authorization: authorization } : {},
    body: JSON.stringify(body)
  });
}

async function issue(h, auth = "Bearer bee-jwt-coach-a", body = { reservation_id: reservationId }) {
  const response = await handleIssueCoachBriefTicket(request("coach-brief-ticket-issue", body, auth), h.settings);
  return { status: response.status, body: await response.json(), headers: response.headers };
}

async function verify(h, ticket, auth = `Bearer ${serviceSecret}`) {
  const response = await handleVerifyCoachBriefTicket(request("coach-brief-ticket-verify", { ticket }, auth), h.settings);
  return { status: response.status, body: await response.json(), headers: response.headers };
}

test("assigned Bee-authenticated Coach receives only a two-minute ticket", async () => {
  const h = harness();
  const result = await issue(h);
  assert.equal(result.status, 200);
  assert.deepEqual(Object.keys(result.body).sort(), ["expires_at", "ticket"]);
  assert.equal(result.body.expires_at, "2026-10-10T08:02:00.000Z");
  assert.equal(result.headers.get("Cache-Control"), "no-store");
  const claims = JSON.parse(Buffer.from(result.body.ticket.split(".")[1], "base64url").toString());
  assert.deepEqual(Object.keys(claims).sort(), ["aud", "exp", "iat", "profile_id", "reservation_id", "staff_id"]);
  assert.equal(claims.aud, "ai-eigo-coach-brief");
  assert.equal(claims.staff_id, staffA);
  assert.equal(claims.profile_id, profileA);
  assert.equal(claims.exp - claims.iat, 120000);
  assert.equal(result.body.ticket.includes("test-learner-ref"), false);
  assert.equal(result.body.ticket.includes("never-return"), false);
  assert.equal(h.state.calls[0].url.pathname, "/auth/v1/user");
  assert.equal(h.state.calls[0].init.headers.Authorization, "Bearer bee-jwt-coach-a");
  assert.equal(h.state.calls[1].url.pathname, "/rest/v1/coaching_reservations");
  assert.equal(h.state.calls[2].url.searchParams.get("id"), `eq.${staffA}`);
  assert.equal(h.state.calls[2].url.searchParams.has("profile_id"), false);
});

test("wrong Coach, missing Bee authentication, and service secret alone cannot issue", async () => {
  for (const auth of ["Bearer bee-jwt-coach-b", null, `Bearer ${serviceSecret}`]) {
    const result = await issue(harness(), auth);
    assert.deepEqual({ status: result.status, body: result.body },
      { status: 403, body: { error: "Not authorized." } });
  }
});

test("a multi-organization Bee user resolves through the exact reservation staff row", async () => {
  const h = harness({ staff: [
    { id: staffB, organization_id: organizationB, profile_id: profileA, status: "active" },
    { id: staffA, organization_id: organizationA, profile_id: profileA, status: "active" }
  ] });
  const result = await issue(h);
  assert.equal(result.status, 200);
  assert.equal(h.state.calls[2].url.searchParams.get("id"), `eq.${staffA}`);
});

test("client staff_id cannot impersonate an assigned Coach", async () => {
  const h = harness();
  const result = await issue(h, "Bearer bee-jwt-coach-b",
    { reservation_id: reservationId, staff_id: staffA });
  assert.equal(result.status, 403);
  assert.equal(h.state.calls.length, 0);
});

test("missing, cancelled, other-source, malformed, or learnerless reservations issue no ticket", async () => {
  for (const reservation of [null, row({ status: "cancelled" }), row({ source: "internal_staff" }),
    row({ learner_ref: "   " }), row({ staff_id: null }), row({ time_zone: "" }),
    row({ ends_at: "2026-10-10T09:45:00Z" })]) {
    const result = await issue(harness({ reservation }));
    assert.deepEqual({ status: result.status, body: result.body },
      { status: 403, body: { error: "Not authorized." } });
  }
});

test("inactive staff, inactive profile, and mismatched organization fail closed", async () => {
  for (const change of [
    { staff: [{ id: staffA, organization_id: organizationA, profile_id: profileA, status: "inactive" }] },
    { profiles: [{ id: profileA, status: "inactive" }] },
    { staff: [{ id: staffA, organization_id: organizationB, profile_id: profileA, status: "active" }] }
  ]) {
    assert.equal((await issue(harness(change))).status, 403);
  }
});

test("valid ticket returns only approved current Bee authorization context", async () => {
  const h = harness();
  const issued = await issue(h);
  const result = await verify(h, issued.body.ticket);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    authorized: true, reservation_id: reservationId, staff_id: staffA,
    learner_ref: "test-learner-ref", organization_id: organizationA,
    school_id: schoolId, program_id: "kids", starts_at: "2026-10-10T09:00:00Z",
    ends_at: "2026-10-10T09:30:00Z", timezone: "Asia/Tokyo",
    status: "confirmed", source: "ai_eigo"
  });
  assert.equal(result.headers.get("Cache-Control"), "no-store");
  for (const forbidden of ["request_key", "coach_email", "learner_email", "billing", "secret"]) {
    assert.equal(JSON.stringify(result.body).includes(forbidden), false);
  }
});

test("expired and tampered tickets are denied", async () => {
  const h = harness();
  const issued = await issue(h);
  h.settings.now = () => now + 120000;
  assert.equal((await verify(h, issued.body.ticket)).status, 403);
  h.settings.now = () => now;
  const pieces = issued.body.ticket.split(".");
  pieces[1] = `${pieces[1].slice(0, -1)}${pieces[1].endsWith("A") ? "B" : "A"}`;
  assert.equal((await verify(h, pieces.join("."))).status, 403);
  assert.equal((await verify(h, "invalid-ticket")).status, 403);
});

test("signed tickets for another audience or an excessive lifetime are denied", async () => {
  const h = harness();
  const issued = await issue(h);
  const original = JSON.parse(Buffer.from(issued.body.ticket.split(".")[1], "base64url").toString());
  for (const claims of [
    { ...original, aud: "another-service" },
    { ...original, exp: original.iat + 60 * 60 * 1000 }
  ]) {
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const message = `v1.${payload}`;
    const signature = createHmac("sha256", ticketSecret).update(message).digest("base64url");
    assert.equal((await verify(h, `${message}.${signature}`)).status, 403);
  }
});

test("cancelled or reassigned after issuance invalidates the old ticket", async () => {
  const h = harness();
  const issued = await issue(h);
  h.state.reservation = row({ status: "cancelled" });
  assert.equal((await verify(h, issued.body.ticket)).status, 403);
  h.state.reservation = row({ staff_id: staffB });
  h.state.staff.push({ id: staffB, organization_id: organizationA, profile_id: profileB, status: "active" });
  h.state.profiles.push({ id: profileB, status: "active" });
  assert.equal((await verify(h, issued.body.ticket)).status, 403);
  assert.equal((await issue(h, "Bearer bee-jwt-coach-a")).status, 403);
  assert.equal((await issue(h, "Bearer bee-jwt-coach-b")).status, 200);
});

test("verification rechecks reservation existence, source, learner and linked Bee identity", async () => {
  const h = harness();
  const issued = await issue(h);
  for (const change of [null, row({ source: "internal_staff" }), row({ learner_ref: "" })]) {
    h.state.reservation = change;
    assert.equal((await verify(h, issued.body.ticket)).status, 403);
  }
  h.state.reservation = row();
  h.state.staff[0].profile_id = profileB;
  assert.equal((await verify(h, issued.body.ticket)).status, 403);
});

test("verification requires the AI-EIGO bridge secret before any database lookup", async () => {
  const h = harness();
  const issued = await issue(h);
  h.state.calls.length = 0;
  for (const auth of [null, "Bearer wrong-service-secret", "Bearer bee-jwt-coach-a"]) {
    const result = await verify(h, issued.body.ticket, auth);
    assert.deepEqual({ status: result.status, body: result.body },
      { status: 403, body: { error: "Not authorized." } });
  }
  assert.equal(h.state.calls.length, 0);
});

test("malformed request bodies and missing ticket secret fail closed", async () => {
  assert.equal((await issue(harness(), "Bearer bee-jwt-coach-a", { staff_id: staffA })).status, 403);
  assert.equal((await verify(harness(), null)).status, 403);
  assert.equal((await issue(harness({ env: { BEE_COACH_BRIEF_TICKET_SECRET: "" } }))).status, 503);
});
