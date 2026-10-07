"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { fetchCommunicationTemplates, fetchStudents, previewStudentTemplateCommunication, sendStudentTemplateCommunication } from "@/lib/data";
import { formatPersonName } from "@/lib/format";
import { getSupabaseBrowserClient } from "@/lib/supabase";

const supportedVariables = new Set(["student_name", "student_email", "recipient_name", "school_name"]);

export function StudentTemplateComposer({ studentId, onCancel, onSent }) {
  const { session } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [templateKey, setTemplateKey] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState(studentId || "");
  const [studentSearch, setStudentSearch] = useState("");
  const [studentOptions, setStudentOptions] = useState([]);
  const [preview, setPreview] = useState(null);
  const [state, setState] = useState({ error: "", loading: true, sending: false });

  useEffect(() => {
    let active = true;
    async function load() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session) return;
      const { data, error } = await fetchCommunicationTemplates(supabase);
      if (!active) return;
      const selectable = (data || []).filter((template) =>
        template.status === "active" &&
        (template.variable_keys || []).every((key) => supportedVariables.has(key))
      );
      setTemplates(selectable);
      setTemplateKey(selectable[0]?.template_key || "");
      setState({ error: error?.message || "", loading: false, sending: false });
    }
    load();
    return () => { active = false; };
  }, [session]);

  useEffect(() => {
    if (studentId || !session) return;
    let active = true;
    const timer = setTimeout(async () => {
      const { data, error } = await fetchStudents(getSupabaseBrowserClient(), studentSearch);
      if (!active) return;
      setStudentOptions(data || []);
      if (error) setState((current) => ({ ...current, error: error.message }));
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [session, studentId, studentSearch]);

  async function handlePreview() {
    setPreview(null);
    setState((current) => ({ ...current, error: "", loading: true }));
    const { data, error } = await previewStudentTemplateCommunication(
      getSupabaseBrowserClient(), templateKey, selectedStudentId
    );
    setState((current) => ({ ...current, error: error?.message || "", loading: false }));
    if (!error) setPreview(data);
  }

  async function handleSend() {
    if (!preview) return;
    setState((current) => ({ ...current, error: "", sending: true }));
    // Only IDs cross this boundary. The RPC resolves recipient and content again.
    const { data, error } = await sendStudentTemplateCommunication(
      getSupabaseBrowserClient(), templateKey, selectedStudentId
    );
    if (error) {
      setState((current) => ({ ...current, error: error.message, sending: false }));
      setPreview(null);
      return;
    }
    onSent?.(data);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-labelledby="student-template-composer-title" aria-modal="true" className="communication-modal" role="dialog">
        <header className="communication-modal-header">
          <div>
            <p className="eyebrow">Communication</p>
            <h2 id="student-template-composer-title">Send email</h2>
          </div>
          <button className="ghost-button" onClick={onCancel} type="button">Cancel</button>
        </header>
        {state.error ? <p className="inline-alert" role="alert">{state.error}</p> : null}
        <div className="student-form">
          <label>
            <span>Template</span>
            <select disabled={state.loading || state.sending} onChange={(event) => {
              setTemplateKey(event.target.value);
              setPreview(null);
            }} value={templateKey}>
              {templates.map((template) => <option key={template.id} value={template.template_key}>{template.name}</option>)}
            </select>
          </label>
          {!studentId ? <>
            <label><span>Find student</span><input onChange={(event) => setStudentSearch(event.target.value)} placeholder="Search by name" type="search" value={studentSearch} /></label>
            <label><span>Student</span><select onChange={(event) => { setSelectedStudentId(event.target.value); setPreview(null); }} value={selectedStudentId}>
              <option value="">Choose a student</option>
              {studentOptions.map((student) => <option key={student.id} value={student.id}>{formatPersonName(student)}</option>)}
            </select></label>
          </> : null}
          {!state.loading && !templates.length ? <p>No active student email templates are available.</p> : null}
          {preview ? (
            <div className="communication-preview" aria-label="Email preview">
              <p><strong>To:</strong> {preview.recipient}</p>
              <p><strong>Subject:</strong> {preview.subject}</p>
              <p><strong>Message:</strong></p>
              <pre className="communication-preview-body">{preview.body}</pre>
            </div>
          ) : null}
          <div className="form-actions communication-form-actions">
            <button className="secondary-button" onClick={onCancel} type="button">Cancel</button>
            <button className="secondary-button" disabled={!templateKey || !selectedStudentId || state.loading || state.sending} onClick={handlePreview} type="button">
              {state.loading ? "Loading..." : "Preview"}
            </button>
            <button className="primary-button" disabled={!preview || state.sending || state.loading} onClick={handleSend} type="button">
              {state.sending ? "Queuing..." : "Send"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
