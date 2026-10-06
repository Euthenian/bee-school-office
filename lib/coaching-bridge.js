import { fetchInternalCoachingSlots } from "./coaching-availability-data.js";

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROGRAM_PATTERN = /^[a-z][a-z0-9_]*$/;

function localDay(value) {
  const match = DATE_PATTERN.exec(value || "");
  if (!match) return null;
  const year = Number(match[1]);
  if (year < 1000) return null;
  const date = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value ? date : null;
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

async function equalSecret(a, b) {
  const encoder = new TextEncoder();
  const [first, second] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b))
  ]);
  const left = new Uint8Array(first);
  const right = new Uint8Array(second);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function handleTrustedCoachingSlots(request, { getEnv, fetchImpl = fetch }) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const url = getEnv("SUPABASE_URL");
  const bridgeSecret = getEnv("AI_EIGO_COACHING_BRIDGE_SECRET");
  let databaseKey;
  try {
    const keys = JSON.parse(getEnv("SUPABASE_SECRET_KEYS") || "null");
    databaseKey = keys?.default;
  } catch {
    databaseKey = null;
  }
  if (!url || !bridgeSecret || /\s/.test(bridgeSecret) ||
    typeof databaseKey !== "string" || !databaseKey.startsWith("sb_secret_")) {
    return json({ error: "Availability service is not configured." }, 503);
  }
  let supabaseOrigin;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("Invalid URL");
    supabaseOrigin = parsed.origin;
  } catch {
    return json({ error: "Availability service is not configured." }, 503);
  }
  const bearer = /^Bearer ([^\s]+)$/.exec(request.headers.get("Authorization") || "");
  if (!bearer || !(await equalSecret(bearer[1], bridgeSecret))) {
    return json({ error: "Unauthorized." }, 401);
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  const schoolId = input?.school_id;
  const programId = input?.program_id;
  const startDate = input?.start_date;
  const endDate = input?.end_date;
  const start = localDay(startDate);
  const end = localDay(endDate);
  if (typeof schoolId !== "string" || !UUID_PATTERN.test(schoolId) ||
    typeof programId !== "string" || !PROGRAM_PATTERN.test(programId) ||
    !start || !end || end < start || (end - start) / 86400000 > 30) {
    return json({ error: "Invalid school, program, or date range." }, 400);
  }

  let upstreamStatus = 0;
  const supabase = {
    async rpc(name, args) {
      const response = await fetchImpl(`${supabaseOrigin}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: databaseKey
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(10000)
      });
      upstreamStatus = response.status;
      const data = await response.json();
      return response.ok ? { data, error: null } : { data: null, error: data };
    }
  };

  try {
    const result = await fetchInternalCoachingSlots(supabase, {
      schoolId, programId, startDate, endDate
    });
    if (result.error) {
      return upstreamStatus === 400
        ? json({ error: "Invalid school, program, or date range." }, 400)
        : json({ error: "Availability could not be calculated." }, 502);
    }
    let finalSlots = result.data;
    if (finalSlots.length) {
      const approved = new Set();
      for (let offset = 0; offset < finalSlots.length; offset += 1000) {
        const batch = finalSlots.slice(offset, offset + 1000);
        const checked = await supabase.rpc("filter_internal_coaching_bookable_slot_indexes", {
          p_school_id: schoolId,
          p_program_id: programId,
          p_start_date: startDate,
          p_end_date: endDate,
          p_candidates: batch.map((slot) => ({
            staff_id: slot.staffId, local_date: slot.date, start_time: slot.startTime
          }))
        });
        if (checked.error || !Array.isArray(checked.data) ||
          checked.data.some((index) => !Number.isInteger(index) || index < 0 || index >= batch.length)) {
          return json({ error: "Availability could not be confirmed." }, 502);
        }
        for (const index of checked.data) approved.add(offset + index);
      }
      finalSlots = finalSlots.filter((_, index) => approved.has(index));
    }
    return json({ slots: finalSlots.map((slot) => ({
      school_id: slot.schoolId,
      program_id: slot.programId,
      staff_id: slot.staffId,
      local_date: slot.date,
      start_time: slot.startTime,
      end_time: slot.endTime,
      timezone: slot.timeZone
    })) }, 200);
  } catch {
    return json({ error: "Availability could not be calculated." }, 502);
  }
}
