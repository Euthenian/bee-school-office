import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { withCoachBriefBrowserCors } from "../lib/coach-brief-browser-cors.js";
import { coachBriefEntryUrl, fetchCoachBriefSessions, issueCoachBriefTicket,
  postCoachBriefHandoff, visibleCoachBriefSessions } from "../lib/coach-brief-launcher.js";
import { handleCoachBriefSessions } from "../lib/coach-brief-sessions.js";

const profileA = "d70b7160-5719-4868-abbd-3a16b82d781f";
const profileB = "4c0cb5c2-a074-481d-9205-14ec906b7668";
const staffA = "2b236f47-daae-4777-98c3-cbb99504c614";
const staffB = "517aa2cc-2dfc-47bc-85ed-95cf4b29ae1f";
const organization = "a96fa462-f181-44e7-adb6-5c247cc08eb7";
const reservationId = "182fd303-e65b-4f88-95b9-f13f11e7d1c0";
const now = Date.parse("2026-10-14T08:00:00Z");
const session = { id: reservationId, staff_id: staffA, organization_id: organization,
  program_id: "kids", starts_at: "2026-10-14T09:00:00Z", ends_at: "2026-10-14T09:30:00Z",
  time_zone: "Asia/Tokyo", status: "confirmed", source: "ai_eigo",
  learner_ref: "never-return-learner", request_key: "never-return-key", billing: "never-return-billing" };

function server({ user = profileA, profileStatus = "active", staff = [
  { id: staffA, organization_id: organization, profile_id: profileA, status: "active" }
], reservations = [session], failTable = "" } = {}) {
  const calls = [];
  const options = { getEnv: (name) => ({ SUPABASE_URL: "https://bee.example",
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_test-only" }) })[name], now: () => now,
  fetchImpl: async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    if (url.pathname === "/auth/v1/user")
      return Response.json(init.headers.Authorization === "Bearer coach-a" ? { id: user } : { error: "invalid" },
        { status: init.headers.Authorization === "Bearer coach-a" ? 200 : 401 });
    const table = url.pathname.split("/").at(-1);
    if (table === failTable) return Response.json({ error: "unavailable" }, { status: 502 });
    const id = url.searchParams.get("id")?.slice(3);
    const staffId = url.searchParams.get("staff_id")?.slice(3);
    const rows = table === "profiles" ? [{ id: profileA, status: profileStatus },
      { id: profileB, status: profileStatus }].filter((row) => row.id === id)
      : table === "staff" ? staff.filter((row) => row.profile_id ===
        url.searchParams.get("profile_id")?.slice(3) && row.status === "active")
        : table === "coaching_reservations" ? reservations.filter((row) =>
          row.staff_id === staffId && row.status === "confirmed" && row.source === "ai_eigo" &&
          Date.parse(row.ends_at) > now) : [];
    return Response.json(rows);
  } };
  return { calls, options };
}

function listRequest(body = {}, bearer = "Bearer coach-a") {
  return new Request("https://bee.example/functions/v1/coach-brief-sessions", {
    method: "POST", headers: bearer ? { Authorization: bearer } : {}, body: JSON.stringify(body)
  });
}

test("assigned Coach sees only a bounded, minimal confirmed AI-EIGO session", async () => {
  const { calls, options } = server();
  const response = await handleCoachBriefSessions(listRequest(), options);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { sessions: [{ reservation_id: reservationId,
    starts_at: session.starts_at, ends_at: session.ends_at, timezone: "Asia/Tokyo",
    program_id: "kids", status: "confirmed", source: "ai_eigo" }] });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(calls[0].url.pathname, "/auth/v1/user");
  assert.equal(calls[0].init.headers.Authorization, "Bearer coach-a");
  assert.equal(calls.at(-1).url.searchParams.get("staff_id"), `eq.${staffA}`);
  assert.equal(JSON.stringify(body).includes("never-return"), false);
});

test("wrong Coach and reassigned former Coach do not see a launcher", async () => {
  for (const options of [server({ user: profileB }), server({ staff: [
    { id: staffA, organization_id: organization, profile_id: profileB, status: "active" }
  ] }), server({ reservations: [{ ...session, staff_id: staffB }] })]) {
    const response = await handleCoachBriefSessions(listRequest(), options.options);
    assert.deepEqual(await response.json(), { sessions: [] });
  }
});

test("cancelled, non-AI-EIGO, and ended sessions are omitted", async () => {
  const fixtures = [{ ...session, status: "cancelled" }, { ...session, source: "internal_staff" },
    { ...session, ends_at: "2026-10-14T07:59:00Z" }];
  const h = server({ reservations: fixtures });
  const response = await handleCoachBriefSessions(listRequest(), h.options);
  assert.deepEqual(await response.json(), { sessions: [] });
  assert.deepEqual(visibleCoachBriefSessions(fixtures.map((row) => ({ ...row,
    reservation_id: row.id })), now), []);
});

test("read-only session API rejects caller selectors, missing JWT, inactive profile, and database failure", async () => {
  const h = server();
  assert.equal((await handleCoachBriefSessions(listRequest({ staff_id: staffA }), h.options)).status, 403);
  assert.equal(h.calls.length, 0);
  assert.equal((await handleCoachBriefSessions(listRequest({}, null), h.options)).status, 403);
  assert.equal((await handleCoachBriefSessions(listRequest(), server({ profileStatus: "inactive" }).options)).status, 403);
  assert.equal((await handleCoachBriefSessions(listRequest(), server({ failTable: "staff" }).options)).status, 502);
});

test("browser issue call sends only reservation_id and keeps the opaque ticket in memory", async () => {
  const calls = [];
  const supabase = { functions: { invoke: async (name, input) => {
    calls.push({ name, input });
    return { data: { ticket: "opaque-test-ticket", expires_at: "2026-10-14T08:02:00Z" }, error: null };
  } } };
  assert.deepEqual(await issueCoachBriefTicket(supabase, reservationId, now),
    { kind: "issued", ticket: "opaque-test-ticket" });
  assert.deepEqual(calls, [{ name: "coach-brief-ticket-issue",
    input: { body: { reservation_id: reservationId } } }]);
  const listing = { functions: { invoke: async (name, input) => {
    assert.equal(name, "coach-brief-sessions");
    assert.deepEqual(input, { body: {} });
    return { data: { sessions: [{ ...session, reservation_id: reservationId }] }, error: null };
  } } };
  const listed = await fetchCoachBriefSessions(listing, now);
  assert.equal(listed.length, 1);
  assert.equal(JSON.stringify(listed).includes("never-return"), false);
});

test("403 is generic; network and malformed ticket responses are retryable", async () => {
  const forbidden = { functions: { invoke: async () => ({ data: null,
    error: { context: { status: 403 } } }) } };
  assert.deepEqual(await issueCoachBriefTicket(forbidden, reservationId, now), { kind: "unavailable" });
  const network = { functions: { invoke: async () => { throw new Error("internal host detail"); } } };
  assert.deepEqual(await issueCoachBriefTicket(network, reservationId, now), { kind: "retryable" });
  const missing = { functions: { invoke: async () => ({ data: { ticket: "opaque-test-ticket",
    expires_at: "invalid" }, error: null }) } };
  assert.deepEqual(await issueCoachBriefTicket(missing, reservationId, now), { kind: "retryable" });
});

test("handoff uses an immediate form POST and never puts the ticket in the URL", async () => {
  let submitted = null;
  const doc = { body: { appendChild(node) { doc.form = node; } }, createElement(tag) {
    return { tag, style: {}, children: [], appendChild(node) { this.children.push(node); },
      submit() { submitted = { method: this.method, action: this.action, field: this.children[0] }; },
      remove() { this.removed = true; } };
  } };
  postCoachBriefHandoff(doc, "https://ai-eigo.com/coach/brief/entry", "opaque-test-ticket",
    "bee-coach-brief-d70b7160-5719-4868-abbd-3a16b82d781f");
  assert.equal(submitted.method, "POST");
  assert.equal(submitted.action, "https://ai-eigo.com/coach/brief/entry");
  assert.equal(doc.form.target, "bee-coach-brief-d70b7160-5719-4868-abbd-3a16b82d781f");
  assert.deepEqual({ name: submitted.field.name, type: submitted.field.type,
    value: submitted.field.value }, { name: "ticket", type: "hidden", value: "opaque-test-ticket" });
  assert.equal(submitted.action.includes("opaque-test-ticket"), false);
  await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(doc.form.removed, true);
});

test("AI-EIGO destination must be an explicit safe base URL", () => {
  assert.equal(coachBriefEntryUrl("https://ai-eigo.com"), "https://ai-eigo.com/coach/brief/entry");
  assert.equal(coachBriefEntryUrl("http://localhost:3017"), "http://localhost:3017/coach/brief/entry");
  for (const value of ["http://ai-eigo.com", "https://user:pass@ai-eigo.com", "https://ai-eigo.com/path",
    "https://ai-eigo.com/?ticket=x", "javascript:alert(1)"])
    assert.equal(coachBriefEntryUrl(value), null);
});

test("ticket issuance gets narrow browser CORS without changing its authorization handler", async () => {
  const origin = "https://office.beeschool.jp";
  let calls = 0;
  const preflight = await withCoachBriefBrowserCors(new Request("https://bee.example/issue", {
    method: "OPTIONS", headers: { Origin: origin }
  }), () => { calls += 1; return Response.json({ ticket: "should-not-issue" }); });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), origin);
  assert.equal(calls, 0);
  const response = await withCoachBriefBrowserCors(new Request("https://bee.example/issue", {
    method: "POST", headers: { Origin: origin }
  }), () => { calls += 1; return Response.json({ error: "Not authorized." }, { status: 403 }); });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  assert.equal(calls, 1);
  const rejected = await withCoachBriefBrowserCors(new Request("https://bee.example/issue", {
    method: "OPTIONS", headers: { Origin: "https://wrong.example" }
  }), () => { calls += 1; return Response.json({}); });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(calls, 1);
});

test("client launcher source contains no secret, storage, ticket URL, or logging path", () => {
  const source = readFileSync(new URL("../components/CoachBriefSessions.js", import.meta.url), "utf8") +
    readFileSync(new URL("../lib/coach-brief-launcher.js", import.meta.url), "utf8");
  for (const forbidden of ["AI_EIGO_COACHING_BRIDGE_SECRET", "BEE_COACH_BRIEF_TICKET_SECRET",
    "SUPABASE_SECRET_KEYS", "service_role", "localStorage", "sessionStorage", "console.log"])
    assert.equal(source.includes(forbidden), false);
  assert.equal(source.includes("<CoachBriefSessions />"), false);
  const dashboard = readFileSync(new URL("../app/(app)/dashboard/page.js", import.meta.url), "utf8");
  assert.equal(dashboard.includes("<CoachBriefSessions />"), true);
});
