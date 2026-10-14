const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function coachBriefEntryUrl(raw = process.env.NEXT_PUBLIC_AI_EIGO_BASE_URL) {
  try {
    const url = new URL(raw);
    const local = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if ((url.protocol !== "https:" && !local) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) return null;
    return `${url.origin}/coach/brief/entry`;
  } catch { return null; }
}

export function visibleCoachBriefSessions(rows, now = Date.now()) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => UUID.test(row?.reservation_id) && row.source === "ai_eigo" &&
    row.status === "confirmed" && Number.isFinite(Date.parse(row.starts_at)) &&
    Number.isFinite(Date.parse(row.ends_at)) && Date.parse(row.ends_at) > now)
    .sort((left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at) ||
      left.reservation_id.localeCompare(right.reservation_id)).slice(0, 20)
    .map((row) => ({ reservation_id: row.reservation_id, starts_at: row.starts_at,
      ends_at: row.ends_at, timezone: row.timezone, program_id: row.program_id,
      status: row.status, source: row.source }));
}

export async function fetchCoachBriefSessions(supabase, now = Date.now()) {
  const { data, error } = await supabase.functions.invoke("coach-brief-sessions", { body: {} });
  if (error || !Array.isArray(data?.sessions)) throw new Error("Coaching sessions could not be loaded.");
  return visibleCoachBriefSessions(data.sessions, now);
}

export async function issueCoachBriefTicket(supabase, reservationId, now = Date.now()) {
  if (!UUID.test(reservationId)) return { kind: "unavailable" };
  try {
    const { data, error } = await supabase.functions.invoke("coach-brief-ticket-issue", {
      body: { reservation_id: reservationId }
    });
    if (error) return { kind: [401, 403].includes(error.context?.status) ? "unavailable" : "retryable" };
    if (typeof data?.ticket !== "string" || !data.ticket || data.ticket.length > 2048 ||
      typeof data.expires_at !== "string" || !Number.isFinite(Date.parse(data.expires_at)) ||
      Date.parse(data.expires_at) <= now)
      return { kind: "retryable" };
    return { kind: "issued", ticket: data.ticket };
  } catch { return { kind: "retryable" }; }
}

export function postCoachBriefHandoff(doc, entryUrl, ticket, targetName) {
  if (!entryUrl || typeof ticket !== "string" || !ticket || ticket.length > 2048 ||
    !/^bee-coach-brief-[0-9a-f-]{36}$/.test(targetName || ""))
    throw new Error("Coach Brief handoff unavailable");
  const form = doc.createElement("form");
  form.method = "POST";
  form.action = entryUrl;
  form.target = targetName;
  form.style.display = "none";
  const field = doc.createElement("input");
  field.type = "hidden";
  field.name = "ticket";
  field.value = ticket;
  form.appendChild(field);
  doc.body.appendChild(form);
  try { form.submit(); } finally { setTimeout(() => form.remove(), 0); }
}
