"use client";

import { useEffect, useMemo, useState } from "react";
import {
  fetchMonthlyCalendarReminderStatus,
  previewStudentTemplateCommunication,
  saveMonthlyCalendarReminderSettings
} from "@/lib/data";
import { formatPersonName } from "@/lib/format";
import { getSupabaseBrowserClient } from "@/lib/supabase";

const templateKey = "monthly_calendar_reminder";

export function AutomatedCommunications({ profile, session }) {
  const organizations = useMemo(() => (profile?.organization_memberships || [])
    .filter((membership) => membership.role === "super_admin" || membership.role === "franchise_owner")
    .map((membership) => ({ id: membership.organization_id, name: membership.organizations?.name || "Organization" })), [profile]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const organizationId = selectedOrganizationId || organizations[0]?.id || "";
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState({ enabled: false, day: "", time: "" });
  const [studentSearch, setStudentSearch] = useState("");
  const [students, setStudents] = useState([]);
  const [studentId, setStudentId] = useState("");
  const [preview, setPreview] = useState(null);
  const [state, setState] = useState({ busy: false, error: "", notice: "" });

  useEffect(() => {
    if (!organizationId || !session) return;
    let active = true;
    fetchMonthlyCalendarReminderStatus(getSupabaseBrowserClient(), organizationId).then(({ data, error }) => {
      if (!active) return;
      setStatus(data || null);
      setForm({
        enabled: Boolean(data?.enabled),
        day: data?.scheduled_day ? String(data.scheduled_day) : "",
        time: data?.scheduled_time?.slice(0, 5) || ""
      });
      setState((current) => ({ ...current, error: error?.message || "" }));
    });
    return () => { active = false; };
  }, [organizationId, session]);

  useEffect(() => {
    if (!organizationId || !session) return;
    let active = true;
    const timer = setTimeout(async () => {
      const supabase = getSupabaseBrowserClient();
      let query = supabase.from("students")
        .select("id,first_name,last_name,preferred_name,legacy_japanese_name")
        .eq("organization_id", organizationId)
        .eq("status", "active")
        .order("last_name", { ascending: true })
        .limit(20);
      if (studentSearch.trim()) {
        const term = `%${studentSearch.trim()}%`;
        query = query.or(`first_name.ilike.${term},last_name.ilike.${term},preferred_name.ilike.${term},legacy_japanese_name.ilike.${term}`);
      }
      const { data, error } = await query;
      if (!active) return;
      setStudents(data || []);
      if (error) setState((current) => ({ ...current, error: error.message }));
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [organizationId, session, studentSearch]);

  async function save(event) {
    event.preventDefault();
    setState({ busy: true, error: "", notice: "" });
    const { error } = await saveMonthlyCalendarReminderSettings(
      getSupabaseBrowserClient(), organizationId, form
    );
    if (error) {
      setState({ busy: false, error: error.message, notice: "" });
      return;
    }
    const result = await fetchMonthlyCalendarReminderStatus(getSupabaseBrowserClient(), organizationId);
    setStatus(result.data || null);
    setState({ busy: false, error: result.error?.message || "", notice: "Automation settings saved." });
  }

  async function showPreview() {
    setPreview(null);
    setState((current) => ({ ...current, busy: true, error: "" }));
    const { data, error } = await previewStudentTemplateCommunication(
      getSupabaseBrowserClient(), templateKey, studentId
    );
    setPreview(error ? null : data);
    setState((current) => ({ ...current, busy: false, error: error?.message || "" }));
  }

  async function refreshResults() {
    setState((current) => ({ ...current, busy: true, error: "" }));
    const { data, error } = await fetchMonthlyCalendarReminderStatus(
      getSupabaseBrowserClient(), organizationId
    );
    if (!error) setStatus(data || null);
    setState((current) => ({ ...current, busy: false, error: error?.message || "" }));
  }

  return (
    <section aria-label="Automated Communications" className="data-surface communication-center-section">
      <div className="communication-center-heading">
        <div><p className="eyebrow">Communication Center</p><h2>Automated Communications</h2></div>
      </div>
      <h3>Monthly Calendar Reminder</h3>
      {!organizations.length ? <p>Automation settings are available to organization administrators.</p> : null}
      {organizations.length ? <>
        {organizations.length > 1 ? <label className="student-form"><span>Organization</span>
          <select value={organizationId} onChange={(event) => {
            setSelectedOrganizationId(event.target.value);
            setStatus(null);
            setStudentId("");
            setPreview(null);
          }}>
            {organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
          </select>
        </label> : null}
        {state.error ? <p className="inline-alert" role="alert">{state.error}</p> : null}
        {state.notice ? <p className="inline-success">{state.notice}</p> : null}
        <p>Status: <strong>{status?.enabled ? "Enabled" : "Disabled"}</strong></p>
        <p>Template used: <strong>Monthly Calendar Reminder</strong> ({templateKey})</p>
        <p>Scheduled day/time: {status?.scheduled_day && status?.scheduled_time
          ? `Day ${status.scheduled_day} at ${status.scheduled_time.slice(0, 5)} Japan time`
          : "Pending"}</p>
        <p>Last execution: {status?.last_execution_at ? `${new Date(status.last_execution_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} JST` : "Never"}</p>
        <p>Current run: {status?.run_month || "None"} · Recipients: {status?.recipient_count || 0} · Sent: {status?.sent_count || 0} · Failed: {status?.failed_count || 0} · Skipped: {status?.skipped_count || 0} · Needs review: {status?.review_count || 0}</p>
        <button className="secondary-button" disabled={state.busy} onClick={refreshResults} type="button">Refresh results</button>
        <p>Failed deliveries require administrator review. They are never retried automatically.</p>
        <form className="student-form" onSubmit={save}>
          <div className="form-grid">
            <label><span>Day of month (1–28)</span><input min="1" max="28" type="number" value={form.day} onChange={(event) => setForm({ ...form, day: event.target.value })} /></label>
            <label><span>Time (Japan)</span><input type="time" value={form.time} onChange={(event) => setForm({ ...form, time: event.target.value })} /></label>
          </div>
          <label className="communication-variable-choice"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} /><span>Enable monthly automation</span></label>
          <p>Before enabling, edit the template above: replace [Calendar URL] with the official calendar link and set the template to Active. A separate cron trigger must also be configured.</p>
          <button className="primary-button" disabled={state.busy || !organizationId} type="submit">Save settings</button>
        </form>
        <div className="student-form">
          <h4>Preview for an active student</h4>
          <label><span>Find student</span><input type="search" value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} /></label>
          <label><span>Student</span><select value={studentId} onChange={(event) => { setStudentId(event.target.value); setPreview(null); }}>
            <option value="">Choose a student</option>
            {students.map((student) => <option key={student.id} value={student.id}>{formatPersonName(student)}</option>)}
          </select></label>
          <button className="secondary-button" disabled={!studentId || state.busy} onClick={showPreview} type="button">Preview</button>
          {preview ? <div className="communication-preview" aria-label="Calendar email preview">
            <p><strong>To:</strong> {preview.recipient}</p>
            <p><strong>Subject:</strong> {preview.subject}</p>
            <pre className="communication-preview-body">{preview.body}</pre>
          </div> : null}
        </div>
      </> : null}
    </section>
  );
}
