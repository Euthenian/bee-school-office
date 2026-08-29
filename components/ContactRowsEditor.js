"use client";

import { addContactRow, contactLabels, markPrimaryContact, removeContactRow, updateContactRow } from "@/lib/contacts";

export function ContactRowsEditor({ rows, onChange }) {
  return (
    <div className="contact-editor">
      <ContactTypeRows
        addLabel="+ Add email"
        allRows={rows}
        fieldLabel="Email"
        onChange={onChange}
        rows={rows.emails}
        type="email"
      />
      <ContactTypeRows
        addLabel="+ Add phone"
        allRows={rows}
        fieldLabel="Phone"
        onChange={onChange}
        rows={rows.phones}
        type="phone"
      />
    </div>
  );
}

function ContactTypeRows({ addLabel, allRows, fieldLabel, onChange, rows, type }) {
  return (
    <div className="contact-type-editor">
      {rows.map((row) => (
        <div className="contact-row" key={row.id}>
          <span className="contact-row-kind">{fieldLabel}</span>
          <input
            aria-label={`${fieldLabel} value`}
            onChange={(event) => onChange(updateContactRow(allRows, type, row.id, "value", event.target.value))}
            type={type === "email" ? "email" : "tel"}
            value={row.value}
          />
          <select
            aria-label={`${fieldLabel} label`}
            onChange={(event) => onChange(updateContactRow(allRows, type, row.id, "label", event.target.value))}
            value={row.label}
          >
            {contactLabels.map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
          <label className="primary-check">
            <input
              checked={row.is_primary}
              onChange={() => onChange(markPrimaryContact(allRows, type, row.id))}
              type="checkbox"
            />
            Primary
          </label>
          <button
            className="ghost-button contact-remove-button"
            disabled={rows.length === 1}
            onClick={() => onChange(removeContactRow(allRows, type, row.id))}
            type="button"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        className="ghost-button contact-add-button"
        onClick={() => onChange(addContactRow(allRows, type))}
        type="button"
      >
        {addLabel}
      </button>
    </div>
  );
}
