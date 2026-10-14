"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { EmptyState } from "@/components/EmptyState";
import { DataSurface, ResponsiveTable, SurfaceHeader } from "@/components/Surface";
import { coachBriefEntryUrl, fetchCoachBriefSessions, issueCoachBriefTicket,
  postCoachBriefHandoff } from "@/lib/coach-brief-launcher";
import { getSupabaseBrowserClient } from "@/lib/supabase";

function sessionLabel(session) {
  try {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short",
      timeZone: session.timezone }).format(new Date(session.starts_at));
  } catch { return "Session time unavailable"; }
}

export function CoachBriefSessions() {
  const { session } = useAuth();
  const userId = session?.user?.id;
  const [refreshKey, setRefreshKey] = useState(0);
  const [state, setState] = useState({ userId: null, loading: true, sessions: [], error: "", notice: "", opening: "" });
  useEffect(() => {
    let active = true;
    const supabase = getSupabaseBrowserClient();
    if (supabase && userId) fetchCoachBriefSessions(supabase).then((sessions) => {
      if (active) setState((current) => ({ ...current, userId, loading: false, sessions, error: "" }));
    }).catch(() => {
      if (active) setState((current) => ({ ...current, userId, loading: false, sessions: [],
        error: "Coaching sessions could not be loaded. Please retry." }));
    });
    return () => { active = false; };
  }, [userId, refreshKey]);

  const loading = state.loading || state.userId !== userId;
  const sessions = state.userId === userId ? state.sessions : [];
  function refresh() {
    setState((current) => ({ ...current, loading: true, error: "", notice: "" }));
    setRefreshKey((current) => current + 1);
  }

  async function openBrief(reservationId) {
    if (state.opening) return;
    const entryUrl = coachBriefEntryUrl();
    const supabase = getSupabaseBrowserClient();
    if (!entryUrl || !supabase) {
      setState((current) => ({ ...current, error: "Coach Brief could not be opened. Please retry." }));
      return;
    }
    // Reserve the tab during the click so popup blockers do not intercept the later POST.
    const handoffWindow = window.open("about:blank", "_blank");
    if (!handoffWindow) {
      setState((current) => ({ ...current, error: "Coach Brief could not be opened. Please retry." }));
      return;
    }
    const targetName = `bee-coach-brief-${window.crypto.randomUUID()}`;
    handoffWindow.name = targetName;
    handoffWindow.opener = null;
    setState((current) => ({ ...current, opening: reservationId, error: "", notice: "" }));
    const result = await issueCoachBriefTicket(supabase, reservationId);
    if (result.kind !== "issued") {
      handoffWindow.close();
      setState((current) => ({ ...current, opening: "", notice: "", error: result.kind === "unavailable"
        ? "Coach Brief is not available for this session."
        : "Coach Brief could not be opened. Please retry." }));
      return;
    }
    try {
      postCoachBriefHandoff(document, entryUrl, result.ticket, targetName);
      setState((current) => ({ ...current,
        notice: "Coach Brief is opening in a new tab. If it does not load, please retry." }));
      window.setTimeout(() => setState((current) => ({ ...current, opening: "" })), 3000);
    } catch {
      handoffWindow.close();
      setState((current) => ({ ...current, opening: "", notice: "",
        error: "Coach Brief could not be opened. Please retry." }));
    }
  }

  return <DataSurface aria-labelledby="coach-brief-sessions-heading">
    <SurfaceHeader><div>
      <p className="eyebrow">Your Coaching</p>
      <h2 id="coach-brief-sessions-heading">Upcoming Coaching sessions</h2>
    </div></SurfaceHeader>
    {state.error ? <p className="inline-alert" role="alert">{state.error}</p> : null}
    {state.notice ? <p role="status">{state.notice}</p> : null}
    {loading ? <div className="table-placeholder">Loading Coaching sessions...</div>
      : sessions.length ? <ResponsiveTable><table>
        <thead><tr><th>Session</th><th>Program</th><th>Coach Brief</th></tr></thead>
        <tbody>{sessions.map((item) => <tr key={item.reservation_id}>
          <td>{sessionLabel(item)}</td>
          <td>{item.program_id === "kids" ? "Kids Coaching" : "Coaching"}</td>
          <td><button className="primary-button" disabled={Boolean(state.opening)}
            onClick={() => openBrief(item.reservation_id)} type="button">
            {state.opening === item.reservation_id ? "Opening Coach Brief..." : "Open Coach Brief"}
          </button></td>
        </tr>)}</tbody>
      </table></ResponsiveTable>
      : <EmptyState title="No upcoming Coaching sessions" description="Assigned AI-EIGO Coaching sessions will appear here." />}
    {!loading ? <button className="secondary-button" onClick={refresh} type="button">Refresh sessions</button> : null}
  </DataSurface>;
}
