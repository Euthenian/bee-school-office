// A read-only, bounded view of the current Coach's own AI-EIGO sessions.
// The human JWT supplies identity; no staff or reservation selector is accepted.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_STAFF_ROWS = 20;
const MAX_SESSIONS = 20;

function reply(body, status) {
  return new Response(JSON.stringify(body), { status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

function settings(getEnv) {
  try {
    const url = new URL(getEnv("SUPABASE_URL"));
    const key = JSON.parse(getEnv("SUPABASE_SECRET_KEYS") || "null")?.default;
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" ||
      typeof key !== "string" || !key.startsWith("sb_secret_")) return null;
    return { origin: url.origin, key };
  } catch { return null; }
}

async function rows(fetchImpl, config, table, filters, select, limit) {
  const url = new URL(`/rest/v1/${table}`, config.origin);
  for (const [name, value] of Object.entries(filters)) url.searchParams.set(name, value);
  url.searchParams.set("select", select);
  url.searchParams.set("limit", String(limit));
  const response = await fetchImpl(url.toString(), {
    headers: { apikey: config.key }, signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) return null;
  const data = await response.json();
  return Array.isArray(data) && data.length <= limit ? data : null;
}

export async function handleCoachBriefSessions(request, { getEnv, fetchImpl = fetch, now = Date.now }) {
  if (request.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  const config = settings(getEnv);
  if (!config) return reply({ error: "Coach sessions are unavailable." }, 503);
  const jwt = /^Bearer ([^\s]+)$/.exec(request.headers.get("Authorization") || "")?.[1];
  if (!jwt) return reply({ error: "Not authorized." }, 403);
  try {
    const input = await request.json();
    if (!input || Array.isArray(input) || typeof input !== "object" || Object.keys(input).length)
      return reply({ error: "Not authorized." }, 403);
    const auth = await fetchImpl(`${config.origin}/auth/v1/user`, {
      headers: { apikey: config.key, Authorization: `Bearer ${jwt}` },
      signal: AbortSignal.timeout(10000)
    });
    if (!auth.ok) return reply({ error: "Not authorized." }, 403);
    const identity = await auth.json();
    const profileId = identity?.id;
    if (!UUID.test(profileId)) return reply({ error: "Not authorized." }, 403);
    const profiles = await rows(fetchImpl, config, "profiles", { id: `eq.${profileId}` }, "id,status", 2);
    if (!profiles || profiles.length !== 1 || profiles[0].id !== profileId || profiles[0].status !== "active")
      return reply({ error: "Not authorized." }, 403);
    const staff = await rows(fetchImpl, config, "staff", { profile_id: `eq.${profileId}`, status: "eq.active" },
      "id,organization_id,profile_id,status", MAX_STAFF_ROWS + 1);
    if (!staff || staff.length > MAX_STAFF_ROWS || staff.some((row) => !UUID.test(row.id) ||
      !UUID.test(row.organization_id) || row.profile_id !== profileId || row.status !== "active"))
      return reply({ error: "Coach sessions are unavailable." }, 502);

    const instant = new Date(now()).toISOString();
    const groups = await Promise.all(staff.map(async (member) => ({ member, reservations: await rows(fetchImpl,
      config, "coaching_reservations", { staff_id: `eq.${member.id}`, status: "eq.confirmed",
        source: "eq.ai_eigo", ends_at: `gt.${instant}`, order: "starts_at.asc" },
      "id,staff_id,organization_id,program_id,starts_at,ends_at,time_zone,status,source", MAX_SESSIONS) })));
    if (groups.some(({ reservations }) => !reservations))
      return reply({ error: "Coach sessions are unavailable." }, 502);
    const sessions = groups.flatMap(({ member, reservations }) => reservations.filter((row) =>
      UUID.test(row.id) && row.staff_id === member.id && row.organization_id === member.organization_id &&
      row.status === "confirmed" && row.source === "ai_eigo" &&
      typeof row.program_id === "string" && row.program_id.length > 0 &&
      typeof row.time_zone === "string" && row.time_zone.length > 0 &&
      Number.isFinite(Date.parse(row.starts_at)) && Number.isFinite(Date.parse(row.ends_at)) &&
      Date.parse(row.ends_at) > now()).map((row) => ({
      reservation_id: row.id, starts_at: row.starts_at, ends_at: row.ends_at,
      timezone: row.time_zone, program_id: row.program_id, status: row.status, source: row.source
    })));
    sessions.sort((left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at) ||
      left.reservation_id.localeCompare(right.reservation_id));
    return reply({ sessions: sessions.slice(0, MAX_SESSIONS) }, 200);
  } catch {
    return reply({ error: "Coach sessions are unavailable." }, 502);
  }
}
