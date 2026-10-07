"use client";

import { useEffect, useState } from "react";
import { fetchCommunicationTemplates, saveCommunicationTemplate } from "@/lib/data";
import { getSupabaseBrowserClient } from "@/lib/supabase";

const variables = ["student_name", "student_email", "recipient_name", "school_name"];
const blank = { id: null, template_key: "", name: "", subject_template: "", body_template: "", variable_keys: [], status: "inactive" };

export function CommunicationTemplateManager({ canEdit, session }) {
  const [templates, setTemplates] = useState([]);
  const [draft, setDraft] = useState(null);
  const [state, setState] = useState({ error: "", loading: true, notice: "", saving: false });

  async function load() {
    const { data, error } = await fetchCommunicationTemplates(getSupabaseBrowserClient());
    setTemplates(data || []);
    setState((current) => ({ ...current, error: error?.message || "", loading: false }));
  }

  useEffect(() => {
    if (!session) return;
    let active = true;
    async function fetchInitialTemplates() {
      const { data, error } = await fetchCommunicationTemplates(getSupabaseBrowserClient());
      if (!active) return;
      setTemplates(data || []);
      setState((current) => ({ ...current, error: error?.message || "", loading: false }));
    }
    fetchInitialTemplates();
    return () => { active = false; };
  }, [session]);

  async function save(event) {
    event.preventDefault();
    setState((current) => ({ ...current, saving: true, error: "", notice: "" }));
    const { error } = await saveCommunicationTemplate(getSupabaseBrowserClient(), draft);
    if (error) {
      setState((current) => ({ ...current, saving: false, error: error.message }));
      return;
    }
    setDraft(null);
    await load();
    setState((current) => ({ ...current, saving: false, notice: "Template saved." }));
  }

  return (
    <section aria-label="Templates" className="data-surface communication-center-section">
      <div className="communication-center-heading">
        <div><p className="eyebrow">Communication Center</p><h2>Templates</h2></div>
        {canEdit ? <button className="secondary-button" onClick={() => setDraft({ ...blank })} type="button">New template</button> : null}
      </div>
      {state.error ? <p className="inline-alert" role="alert">{state.error}</p> : null}
      {state.notice ? <p className="inline-success">{state.notice}</p> : null}
      {state.loading ? <p>Loading templates...</p> : null}
      <div className="communication-template-list">
        {templates.map((template) => (
          <div className="communication-template-row" key={template.id}>
            <div><strong>{template.name}</strong><span>{template.template_key} · {template.status}</span>
              {!(template.variable_keys || []).every((key) => variables.includes(key)) ? <small>Uses trial variables outside the student email editor</small> : null}
            </div>
            {canEdit && (template.variable_keys || []).every((key) => variables.includes(key)) ? <button className="secondary-button" onClick={() => setDraft({ ...template })} type="button">Edit</button> : null}
          </div>
        ))}
      </div>
      {draft && canEdit ? (
        <form className="student-form communication-template-form" onSubmit={save}>
          <h3>{draft.id ? "Edit template" : "New template"}</h3>
          <div className="form-grid single-column">
            <label><span>Key</span><input disabled={Boolean(draft.id)} onChange={(event) => setDraft({ ...draft, template_key: event.target.value })} required value={draft.template_key} /></label>
            <label><span>Name</span><input onChange={(event) => setDraft({ ...draft, name: event.target.value })} required value={draft.name} /></label>
            <label><span>Subject</span><input onChange={(event) => setDraft({ ...draft, subject_template: event.target.value })} required value={draft.subject_template || ""} /></label>
            <label><span>Body</span><textarea onChange={(event) => setDraft({ ...draft, body_template: event.target.value })} required rows={8} value={draft.body_template || ""} /></label>
            <fieldset><legend>Allowed variables</legend>
              {variables.map((variable) => (
                <label className="communication-variable-choice" key={variable}>
                  <input checked={draft.variable_keys.includes(variable)} onChange={(event) => setDraft({ ...draft, variable_keys: event.target.checked ? [...draft.variable_keys, variable] : draft.variable_keys.filter((key) => key !== variable) })} type="checkbox" />
                  <span>{`{{${variable}}}`}</span>
                </label>
              ))}
            </fieldset>
            <label><span>Status</span><select onChange={(event) => setDraft({ ...draft, status: event.target.value })} value={draft.status}>
              <option value="inactive">Inactive</option><option value="active">Active</option>
            </select></label>
          </div>
          <div className="form-actions"><button className="secondary-button" onClick={() => setDraft(null)} type="button">Cancel</button><button className="primary-button" disabled={state.saving} type="submit">{state.saving ? "Saving..." : "Save template"}</button></div>
        </form>
      ) : null}
    </section>
  );
}
