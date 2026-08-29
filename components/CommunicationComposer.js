"use client";

import { useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { communicationMessageTypes, buildCommunicationDraft } from "@/lib/communication-templates";
import { queueCommunication } from "@/lib/data";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export function CommunicationComposer({ context, onCancel, onSent }) {
  const { session } = useAuth();
  const templateContext = useMemo(() => context?.templateContext || {}, [context]);
  const initialDraft = useMemo(
    () => buildCommunicationDraft(context?.defaultMessageType || "general_message", templateContext),
    [context?.defaultMessageType, templateContext]
  );
  const [form, setForm] = useState(() => ({
    body: initialDraft.body,
    messageType: initialDraft.communicationType,
    recipient: context?.defaultRecipient || "",
    subject: initialDraft.subject,
    templateKey: initialDraft.templateKey
  }));
  const [state, setState] = useState({ error: "", sending: false });

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateMessageType(value) {
    const draft = buildCommunicationDraft(value, templateContext);
    setForm((current) => ({
      ...current,
      body: draft.body,
      messageType: draft.communicationType,
      subject: draft.subject,
      templateKey: draft.templateKey
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setState({ error: "", sending: true });

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setState({ error: "You must be signed in before sending email.", sending: false });
      return;
    }

    const { data, error } = await queueCommunication(supabase, {
      channel: "email",
      communicationType: form.messageType,
      organizationId: context.organizationId,
      prospectId: context.prospectId,
      recipient: form.recipient,
      schoolId: context.schoolId,
      studentId: context.studentId,
      subject: form.subject,
      body: form.body,
      templateKey: form.templateKey,
      trialLessonId: context.trialLessonId
    });

    if (error) {
      setState({ error: error.message, sending: false });
      return;
    }

    onSent?.(data);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-labelledby="communication-composer-title" aria-modal="true" className="communication-modal" role="dialog">
        <header className="communication-modal-header">
          <div>
            <p className="eyebrow">Communication</p>
            <h2 id="communication-composer-title">Send email</h2>
          </div>
          <button className="ghost-button" onClick={onCancel} type="button">
            Cancel
          </button>
        </header>

        <form className="student-form" onSubmit={handleSubmit}>
          {state.error ? <p className="inline-alert">{state.error}</p> : null}

          <div className="form-grid single-column communication-form-grid">
            <label>
              <span>Recipient</span>
              <input
                onChange={(event) => updateField("recipient", event.target.value)}
                required
                type="email"
                value={form.recipient}
              />
            </label>

            <label>
              <span>Message type</span>
              <select onChange={(event) => updateMessageType(event.target.value)} value={form.messageType}>
                {communicationMessageTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Subject</span>
              <input onChange={(event) => updateField("subject", event.target.value)} required type="text" value={form.subject} />
            </label>

            <label>
              <span>Message body</span>
              <textarea onChange={(event) => updateField("body", event.target.value)} required value={form.body} />
            </label>
          </div>

          <div className="form-actions communication-form-actions">
            <button className="secondary-button" onClick={onCancel} type="button">
              Cancel
            </button>
            <button className="primary-button" disabled={state.sending} type="submit">
              {state.sending ? "Sending..." : "Send"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
