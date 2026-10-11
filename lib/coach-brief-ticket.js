// Bee verifies the human on issuance and the AI-EIGO service on redemption.
// The ticket is a short-lived bearer proof; current reservation state is always re-read.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUDIENCE = "ai-eigo-coach-brief";
const TTL_MS = 2 * 60 * 1000;
const RESERVATION_FIELDS = "id,staff_id,learner_ref,organization_id,school_id,program_id,starts_at,ends_at,time_zone,status,source";
const STAFF_FIELDS = "id,organization_id,profile_id,status";
const PROFILE_FIELDS = "id,status";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function reply(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

function denied() {
  return reply({ error: "Not authorized." }, 403);
}

function bearer(request) {
  return /^Bearer ([^\s]+)$/.exec(request.headers.get("Authorization") || "")?.[1] || null;
}

function config(getEnv, needsBridgeSecret) {
  const rawUrl = getEnv("SUPABASE_URL");
  const ticketSecret = getEnv("BEE_COACH_BRIEF_TICKET_SECRET");
  const bridgeSecret = needsBridgeSecret ? getEnv("AI_EIGO_COACHING_BRIDGE_SECRET") : null;
  let databaseKey;
  try {
    databaseKey = JSON.parse(getEnv("SUPABASE_SECRET_KEYS") || "null")?.default;
  } catch {
    databaseKey = null;
  }
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" ||
      typeof databaseKey !== "string" || !databaseKey.startsWith("sb_secret_") ||
      typeof ticketSecret !== "string" || encoder.encode(ticketSecret).length < 32 ||
      (needsBridgeSecret && (typeof bridgeSecret !== "string" || !bridgeSecret || /\s/.test(bridgeSecret)))) {
      return null;
    }
    return { origin: url.origin, databaseKey, ticketSecret, bridgeSecret };
  } catch {
    return null;
  }
}

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return base64url(bytes) === value ? bytes : null;
  } catch {
    return null;
  }
}

async function signingKey(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function sign(claims, secret) {
  const payload = base64url(encoder.encode(JSON.stringify(claims)));
  const message = `v1.${payload}`;
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(secret), encoder.encode(message)));
  return `${message}.${base64url(signature)}`;
}

async function verifyTicket(ticket, secret, now) {
  if (typeof ticket !== "string" || ticket.length > 2048) return null;
  const parts = ticket.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const payload = fromBase64url(parts[1]);
  const signature = fromBase64url(parts[2]);
  if (!payload || !signature || signature.length !== 32) return null;
  const valid = await crypto.subtle.verify("HMAC", await signingKey(secret), signature,
    encoder.encode(`v1.${parts[1]}`));
  if (!valid) return null;
  let claims;
  try {
    claims = JSON.parse(decoder.decode(payload));
  } catch {
    return null;
  }
  if (!claims || Array.isArray(claims) ||
    Object.keys(claims).sort().join(",") !== "aud,exp,iat,profile_id,reservation_id,staff_id" ||
    claims.aud !== AUDIENCE || !UUID.test(claims.reservation_id) ||
    !UUID.test(claims.staff_id) || !UUID.test(claims.profile_id) ||
    !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) ||
    claims.exp - claims.iat !== TTL_MS || claims.iat > now + 5000 || claims.exp <= now) {
    return null;
  }
  return claims;
}

async function equalSecret(left, right) {
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right))
  ]);
  const first = new Uint8Array(a);
  const second = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) difference |= first[index] ^ second[index];
  return difference === 0;
}

async function oneRow(fetchImpl, settings, table, field, value, select) {
  const url = new URL(`/rest/v1/${table}`, settings.origin);
  url.searchParams.set(field, `eq.${value}`);
  url.searchParams.set("select", select);
  url.searchParams.set("limit", "2");
  const response = await fetchImpl(url.toString(), {
    headers: { apikey: settings.databaseKey }, signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) return null;
  const rows = await response.json();
  return Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
}

function validReservation(row, id) {
  const start = Date.parse(row?.starts_at);
  const end = Date.parse(row?.ends_at);
  return row?.id === id && UUID.test(row?.staff_id) && UUID.test(row?.organization_id) &&
    UUID.test(row?.school_id) && typeof row?.program_id === "string" && !!row.program_id.trim() &&
    typeof row?.learner_ref === "string" && !!row.learner_ref.trim() &&
    typeof row?.time_zone === "string" && !!row.time_zone.trim() &&
    Number.isFinite(start) && Number.isFinite(end) && end - start === 30 * 60 * 1000 &&
    row.status === "confirmed" && row.source === "ai_eigo";
}

async function authorizedReservation(fetchImpl, settings, reservationId, profileId, expectedStaffId) {
  const reservation = await oneRow(fetchImpl, settings, "coaching_reservations", "id",
    reservationId, RESERVATION_FIELDS);
  if (!validReservation(reservation, reservationId) ||
    (expectedStaffId && reservation.staff_id !== expectedStaffId)) return null;
  const staff = await oneRow(fetchImpl, settings, "staff", "id", reservation.staff_id, STAFF_FIELDS);
  if (staff?.id !== reservation.staff_id || staff.organization_id !== reservation.organization_id ||
    staff.profile_id !== profileId || staff.status !== "active") return null;
  const profile = await oneRow(fetchImpl, settings, "profiles", "id", profileId, PROFILE_FIELDS);
  if (profile?.id !== profileId || profile.status !== "active") return null;
  return reservation;
}

async function beeAuthUser(fetchImpl, settings, jwt) {
  const response = await fetchImpl(`${settings.origin}/auth/v1/user`, {
    headers: { apikey: settings.databaseKey, Authorization: `Bearer ${jwt}` },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) return null;
  const user = await response.json();
  return UUID.test(user?.id) ? user.id : null;
}

async function readOnlyBody(request, key) {
  const body = await request.json();
  return body && !Array.isArray(body) && Object.keys(body).length === 1 &&
    Object.hasOwn(body, key) ? body[key] : null;
}

export async function handleIssueCoachBriefTicket(request, { getEnv, fetchImpl = fetch, now = Date.now }) {
  if (request.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  const settings = config(getEnv, false);
  if (!settings) return reply({ error: "Coach authorization is not configured." }, 503);
  const jwt = bearer(request);
  if (!jwt) return denied();
  try {
    const reservationId = await readOnlyBody(request, "reservation_id");
    if (typeof reservationId !== "string" || !UUID.test(reservationId)) return denied();
    const profileId = await beeAuthUser(fetchImpl, settings, jwt);
    if (!profileId) return denied();
    const reservation = await authorizedReservation(fetchImpl, settings, reservationId, profileId);
    if (!reservation) return denied();
    const issuedAt = now();
    const ticket = await sign({ aud: AUDIENCE, reservation_id: reservation.id,
      staff_id: reservation.staff_id, profile_id: profileId, iat: issuedAt,
      exp: issuedAt + TTL_MS }, settings.ticketSecret);
    return reply({ ticket, expires_at: new Date(issuedAt + TTL_MS).toISOString() }, 200);
  } catch {
    return denied();
  }
}

export async function handleVerifyCoachBriefTicket(request, { getEnv, fetchImpl = fetch, now = Date.now }) {
  if (request.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  const settings = config(getEnv, true);
  if (!settings) return reply({ error: "Coach authorization is not configured." }, 503);
  const serviceSecret = bearer(request);
  if (!serviceSecret || !(await equalSecret(serviceSecret, settings.bridgeSecret))) return denied();
  try {
    const ticket = await readOnlyBody(request, "ticket");
    const claims = await verifyTicket(ticket, settings.ticketSecret, now());
    if (!claims) return denied();
    const reservation = await authorizedReservation(fetchImpl, settings, claims.reservation_id,
      claims.profile_id, claims.staff_id);
    if (!reservation) return denied();
    return reply({ authorized: true, reservation_id: reservation.id, staff_id: reservation.staff_id,
      learner_ref: reservation.learner_ref, organization_id: reservation.organization_id,
      school_id: reservation.school_id, program_id: reservation.program_id,
      starts_at: reservation.starts_at, ends_at: reservation.ends_at,
      timezone: reservation.time_zone, status: reservation.status, source: reservation.source }, 200);
  } catch {
    return denied();
  }
}
